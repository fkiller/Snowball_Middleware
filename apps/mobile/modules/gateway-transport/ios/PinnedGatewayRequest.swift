import Foundation
import Network
import Security
import CryptoKit

// A leaf fingerprint is supplied out of band from the trusted local PC.
// Never learn a pin from the network, fall back to ordinary HTTPS, or reuse a
// preflight connection as evidence for a different authenticated request.
enum GatewayTransportError: String, Error {
  case invalidInput = "invalid_input"
  case identityUnverified = "gateway_identity_unverified"
  case redirectDenied = "redirect_denied"
  case invalidResponse = "invalid_response"
  case unauthorized, forbidden
  case rateLimited = "rate_limited"
  case unavailable, cancelled, timeout
  case hostUnresolved = "host_unresolved"
  case hostUnreachable = "host_unreachable"
  case connectionFailed = "connection_failed"
}

struct GatewayBinding {
  let endpoint: URL
  let fingerprint: String
  let token: String

  init(origin: String, fingerprint: String, token: String) throws {
    guard let parts = URLComponents(string: origin), let host = parts.host,
          parts.scheme == "https", parts.port == nil, parts.user == nil, parts.password == nil,
          parts.query == nil, parts.fragment == nil,
          origin == "https://\(host)" || origin == "https://\(host)/",
          host.count <= 253, host.hasSuffix(".ts.net"), host.split(separator: ".", omittingEmptySubsequences: false).count >= 4,
          host.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ label in
            label.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\z", options: .regularExpression) != nil
          }), let endpoint = URL(string: "https://\(host)/remote/v1/sessions") else {
      throw GatewayTransportError.invalidInput
    }
    try self.init(endpoint: endpoint, fingerprint: fingerprint, token: token)
  }

  // Internal initializer also permits a disposable loopback TLS fixture in the
  // native tests. The Expo bridge only uses the exact Tailscale origin above.
  init(endpoint: URL, fingerprint: String, token: String) throws {
    guard fingerprint.range(of: "^[a-fA-F0-9]{64}\\z", options: .regularExpression) != nil,
          token.range(of: "^[A-Za-z0-9_-]{43}\\z", options: .regularExpression) != nil,
          endpoint.scheme == "https", endpoint.host != nil else { throw GatewayTransportError.invalidInput }
    self.endpoint = endpoint
    self.fingerprint = fingerprint.lowercased()
    self.token = token
  }
}

final class PinnedGatewayRequest: @unchecked Sendable {
  static let maximumBytes = 64 * 1024
  private static let maximumHeaderBytes = 16 * 1024
  private static let crlf = Data([13, 10])
  private static let headerDelimiter = Data([13, 10, 13, 10])

  private let binding: GatewayBinding
  private let queue = DispatchQueue(label: "dev.snowball.gateway.pinned-request")
  private var activeSelf: PinnedGatewayRequest?
  private var connection: NWConnection?
  private var timeoutTimer: DispatchSourceTimer?
  private var completion: ((Result<Data, GatewayTransportError>) -> Void)?
  private var rawBuffer = Data()
  private var decodedBody = Data()
  private var headersParsed = false
  private var isChunked = false
  private var expectedContentLength: Int?
  private var authenticated = false
  private var tlsRejected = false
  private var requestSent = false
  private let cancellationLock = NSLock()
  private var cancelled = false
  private var isCancelled: Bool {
    cancellationLock.lock(); defer { cancellationLock.unlock() }
    return cancelled
  }

  init(binding: GatewayBinding) { self.binding = binding }

  func start(completion: @escaping (Result<Data, GatewayTransportError>) -> Void) {
    queue.async {
      self.activeSelf = self
      self.completion = completion
      guard !self.isCancelled else { self.finish(.failure(.cancelled)); return }
      guard let host = self.binding.endpoint.host,
            let portValue = UInt16(exactly: self.binding.endpoint.port ?? 443),
            let port = NWEndpoint.Port(rawValue: portValue) else {
        self.finish(.failure(.invalidInput))
        return
      }

      let timer = DispatchSource.makeTimerSource(queue: self.queue)
      timer.schedule(deadline: .now() + .seconds(12))
      timer.setEventHandler { [weak self] in self?.finish(.failure(.timeout)) }
      timer.resume()
      self.timeoutTimer = timer

      let tlsOptions = NWProtocolTLS.Options()
      let secOptions = tlsOptions.securityProtocolOptions
      sec_protocol_options_set_min_tls_protocol_version(secOptions, .TLSv12)
      sec_protocol_options_set_tls_server_name(secOptions, host)
      sec_protocol_options_set_verify_block(secOptions, { [weak self] _, secTrust, complete in
        guard let self = self else { complete(false); return }
        guard self.completion != nil, !self.isCancelled else {
          complete(false)
          self.finish(.failure(.cancelled))
          return
        }
        let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
        guard SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString)) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first,
              SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map({ String(format: "%02x", $0) }).joined() == self.binding.fingerprint,
              self.validDates(leaf),
              SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil) else {
          self.tlsRejected = true
          complete(false)
          self.finish(.failure(.identityUnverified))
          return
        }
        self.authenticated = true
        complete(true)
      }, self.queue)

      let parameters = NWParameters(tls: tlsOptions, tcp: NWProtocolTCP.Options())
      let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: parameters)
      self.connection = connection

      connection.stateUpdateHandler = { [weak self] state in
        guard let self = self, self.completion != nil else { return }
        if self.isCancelled { self.finish(.failure(.cancelled)); return }
        switch state {
        case .ready:
          guard self.authenticated, !self.requestSent else {
            if !self.authenticated { self.finish(.failure(.identityUnverified)) }
            return
          }
          self.requestSent = true
          self.sendRequest(host: host, portValue: portValue)
        case .failed(let error):
          self.finish(.failure(self.mapError(error)))
        case .cancelled:
          if self.isCancelled { self.finish(.failure(.cancelled)) }
        default:
          break
        }
      }
      connection.start(queue: self.queue)
    }
  }

  func cancel() {
    cancellationLock.lock(); cancelled = true; cancellationLock.unlock()
    queue.async { self.finish(.failure(.cancelled)) }
  }

  private func sendRequest(host: String, portValue: UInt16) {
    guard let connection = connection else { return }
    let path = binding.endpoint.path.isEmpty ? "/remote/v1/sessions" : binding.endpoint.path
    let hostHeader = (binding.endpoint.port == nil || portValue == 443) ? host : "\(host):\(portValue)"
    let rawRequest = [
      "GET \(path) HTTP/1.1",
      "Host: \(hostHeader)",
      "Accept: application/json",
      "Authorization: Bearer \(binding.token)",
      "Connection: close",
      "",
      ""
    ].joined(separator: "\r\n")
    connection.send(content: Data(rawRequest.utf8), completion: .contentProcessed { [weak self] error in
      guard let self = self, self.completion != nil else { return }
      if let error = error {
        self.finish(.failure(self.mapError(error)))
        return
      }
      self.receiveNext()
    })
  }

  private func receiveNext() {
    guard let connection = connection, completion != nil else { return }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] chunk, _, isComplete, error in
      guard let self = self, self.completion != nil else { return }
      if self.isCancelled { self.finish(.failure(.cancelled)); return }
      if let chunk = chunk, !chunk.isEmpty {
        self.rawBuffer.append(chunk)
        if !self.processBufferedData(isComplete: isComplete) { return }
      }
      if self.completion == nil { return }
      if let error = error {
        self.finish(.failure(self.mapError(error)))
        return
      }
      if isComplete {
        _ = self.processBufferedData(isComplete: true)
        if self.completion != nil {
          self.finish(.failure(self.authenticated ? .invalidResponse : .identityUnverified))
        }
        return
      }
      self.receiveNext()
    }
  }

  private func processBufferedData(isComplete: Bool) -> Bool {
    if !headersParsed {
      guard let delimiter = rawBuffer.range(of: Self.headerDelimiter) else {
        if rawBuffer.count > Self.maximumHeaderBytes || isComplete {
          finish(.failure(.invalidResponse))
          return false
        }
        return true
      }
      let headerData = rawBuffer.subdata(in: 0..<delimiter.lowerBound)
      rawBuffer.removeSubrange(0..<delimiter.upperBound)
      guard let headerText = String(data: headerData, encoding: .isoLatin1) else {
        finish(.failure(.invalidResponse))
        return false
      }
      let lines = headerText.components(separatedBy: "\r\n")
      guard let statusLine = lines.first else {
        finish(.failure(.invalidResponse))
        return false
      }
      let statusParts = statusLine.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
      guard statusParts.count >= 2,
            (statusParts[0] == "HTTP/1.1" || statusParts[0] == "HTTP/1.0"),
            let statusCode = Int(statusParts[1]) else {
        finish(.failure(.invalidResponse))
        return false
      }
      if (300...399).contains(statusCode) {
        finish(.failure(.redirectDenied))
        return false
      }
      guard statusCode == 200 else {
        let error: GatewayTransportError
        switch statusCode {
        case 401: error = .unauthorized
        case 403: error = .forbidden
        case 429: error = .rateLimited
        case 503: error = .unavailable
        default: error = .invalidResponse
        }
        finish(.failure(error))
        return false
      }
      var mimeType: String?
      for line in lines.dropFirst() where !line.isEmpty {
        guard let colon = line.firstIndex(of: ":") else {
          finish(.failure(.invalidResponse))
          return false
        }
        let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
        let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        switch name {
        case "content-type":
          mimeType = value.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased()
        case "content-length":
          guard expectedContentLength == nil, let length = Int(value), length >= 0, length <= Self.maximumBytes else {
            finish(.failure(.invalidResponse))
            return false
          }
          expectedContentLength = length
        case "transfer-encoding":
          if value.lowercased().contains("chunked") { isChunked = true }
        default:
          break
        }
      }
      guard mimeType == "application/json" else {
        finish(.failure(.invalidResponse))
        return false
      }
      headersParsed = true
    }

    if isChunked {
      while true {
        guard let lineEnd = rawBuffer.range(of: Self.crlf) else {
          if rawBuffer.count > 64 || isComplete {
            finish(.failure(.invalidResponse))
            return false
          }
          return true
        }
        let sizeData = rawBuffer.subdata(in: 0..<lineEnd.lowerBound)
        guard let sizeLine = String(data: sizeData, encoding: .ascii) else {
          finish(.failure(.invalidResponse))
          return false
        }
        let sizeToken = sizeLine.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !sizeToken.isEmpty, let chunkSize = Int(sizeToken, radix: 16), chunkSize >= 0 else {
          finish(.failure(.invalidResponse))
          return false
        }
        if decodedBody.count + chunkSize > Self.maximumBytes {
          finish(.failure(.invalidResponse))
          return false
        }
        let chunkStart = lineEnd.upperBound
        let chunkEnd = chunkStart + chunkSize
        let frameEnd = chunkEnd + 2
        guard rawBuffer.count >= frameEnd else {
          if isComplete {
            finish(.failure(.invalidResponse))
            return false
          }
          return true
        }
        guard rawBuffer.subdata(in: chunkEnd..<frameEnd) == Self.crlf else {
          finish(.failure(.invalidResponse))
          return false
        }
        if chunkSize == 0 {
          finish(.success(decodedBody))
          return false
        }
        decodedBody.append(rawBuffer.subdata(in: chunkStart..<chunkEnd))
        rawBuffer.removeSubrange(0..<frameEnd)
      }
    } else {
      if rawBuffer.count > Self.maximumBytes {
        finish(.failure(.invalidResponse))
        return false
      }
      if let expected = expectedContentLength {
        if rawBuffer.count > expected {
          finish(.failure(.invalidResponse))
          return false
        }
        if rawBuffer.count == expected {
          finish(.success(rawBuffer))
          return false
        }
        if isComplete {
          finish(.failure(.invalidResponse))
          return false
        }
        return true
      }
      if isComplete {
        finish(.success(rawBuffer))
        return false
      }
      return true
    }
  }

  private func mapError(_ error: NWError) -> GatewayTransportError {
    if isCancelled { return .cancelled }
    if tlsRejected { return .identityUnverified }
    switch error {
    case .dns:
      return .hostUnresolved
    case .tls:
      return authenticated ? .connectionFailed : .identityUnverified
    case .posix(let code):
      switch code {
      case .ETIMEDOUT: return .timeout
      case .ECANCELED: return .cancelled
      case .ECONNREFUSED, .ENETUNREACH, .EHOSTUNREACH, .ENETDOWN, .EHOSTDOWN, .ECONNRESET, .ENOTCONN:
        return .hostUnreachable
      default:
        return .connectionFailed
      }
    default:
      return .connectionFailed
    }
  }

  private func finish(_ result: Result<Data, GatewayTransportError>) {
    guard let completion = completion else { return }
    self.completion = nil
    timeoutTimer?.cancel()
    timeoutTimer = nil
    connection?.cancel()
    connection = nil
    rawBuffer.removeAll()
    decodedBody.removeAll()
    activeSelf = nil
    completion(result)
  }

  private func validDates(_ certificate: SecCertificate) -> Bool {
    // A pinned leaf used as a trust anchor is not reliably expiry-checked by
    // SecTrust. Use Apple's certificate date APIs as an additional check.
    guard #available(iOS 18.0, macOS 15.0, *),
          let before = SecCertificateCopyNotValidBeforeDate(certificate),
          let after = SecCertificateCopyNotValidAfterDate(certificate) else { return false }
    let now = CFAbsoluteTimeGetCurrent()
    return CFDateGetAbsoluteTime(before) <= now && now < CFDateGetAbsoluteTime(after)
  }
}
