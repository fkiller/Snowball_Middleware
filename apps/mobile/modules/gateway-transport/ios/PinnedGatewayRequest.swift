import Foundation
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

final class PinnedGatewayRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  static let maximumBytes = 64 * 1024
  private let binding: GatewayBinding
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private var session: URLSession?
  private var completion: ((Result<Data, GatewayTransportError>) -> Void)?
  private var data = Data()
  private var authenticated = false
  private var acceptedResponse = false
  private let cancellationLock = NSLock()
  private var cancelled = false
  private var isCancelled: Bool {
    cancellationLock.lock(); defer { cancellationLock.unlock() }
    return cancelled
  }

  init(binding: GatewayBinding) { self.binding = binding }

  func start(completion: @escaping (Result<Data, GatewayTransportError>) -> Void) {
    queue.addOperation {
      self.completion = completion
      guard !self.isCancelled else { self.finish(.failure(.cancelled)); return }
      let configuration = URLSessionConfiguration.ephemeral
      configuration.urlCache = nil
      configuration.urlCredentialStorage = nil
      configuration.httpCookieStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.timeoutIntervalForRequest = 12
      configuration.timeoutIntervalForResource = 15
      configuration.waitsForConnectivity = false
      configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: self.queue)
      self.session = session
      var request = URLRequest(url: self.binding.endpoint)
      request.httpMethod = "GET"
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("Bearer \(self.binding.token)", forHTTPHeaderField: "Authorization")
      session.dataTask(with: request).resume()
    }
  }

  func cancel() {
    cancellationLock.lock(); cancelled = true; cancellationLock.unlock()
    queue.addOperation { self.finish(.failure(.cancelled)) }
  }

  private func finish(_ result: Result<Data, GatewayTransportError>) {
    guard let completion = completion else { return }
    self.completion = nil
    session?.invalidateAndCancel()
    session = nil
    data.removeAll()
    completion(result)
  }

  private func authenticate(_ challenge: URLAuthenticationChallenge,
                            completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    let space = challenge.protectionSpace
    guard completion != nil, !isCancelled, space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          space.host == binding.endpoint.host, space.port == (binding.endpoint.port ?? 443),
          let trust = space.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first,
          SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map({ String(format: "%02x", $0) }).joined() == binding.fingerprint,
          validDates(leaf),
          SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, space.host as CFString)) == errSecSuccess,
          SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess,
          SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
          SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
          SecTrustEvaluateWithError(trust, nil) else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      finish(.failure(.identityUnverified))
      return
    }
    authenticated = true
    completionHandler(.useCredential, URLCredential(trust: trust))
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

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    authenticate(challenge, completionHandler: completionHandler)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    authenticate(challenge, completionHandler: completionHandler)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
    finish(.failure(.redirectDenied))
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard completion != nil, authenticated, response.url == binding.endpoint,
          let response = response as? HTTPURLResponse else {
      completionHandler(.cancel); finish(.failure(.identityUnverified)); return
    }
    guard response.statusCode == 200 else {
      let error: GatewayTransportError
      switch response.statusCode {
      case 401: error = .unauthorized
      case 403: error = .forbidden
      case 429: error = .rateLimited
      case 503: error = .unavailable
      default: error = .invalidResponse
      }
      completionHandler(.cancel); finish(.failure(error)); return
    }
    guard response.mimeType?.lowercased() == "application/json",
          response.expectedContentLength <= Int64(Self.maximumBytes) else {
      completionHandler(.cancel); finish(.failure(.invalidResponse)); return
    }
    acceptedResponse = true
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    guard completion != nil else { return }
    guard data.count + chunk.count <= Self.maximumBytes else { finish(.failure(.invalidResponse)); return }
    data.append(chunk)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error as? URLError {
      finish(.failure(error.code == .timedOut ? .timeout : error.code == .cancelled ? .cancelled : .connectionFailed))
    } else if error != nil { finish(.failure(.connectionFailed)) }
    else if authenticated && acceptedResponse { finish(.success(data)) }
    else { finish(.failure(.identityUnverified)) }
  }
}
