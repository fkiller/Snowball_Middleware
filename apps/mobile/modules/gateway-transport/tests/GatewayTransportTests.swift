import XCTest
import Security
@testable import GatewayTransport

final class GatewayTransportTests: XCTestCase {
  private func fixture(_ name: String) throws -> [String: String] {
    let file = try XCTUnwrap(ProcessInfo.processInfo.environment["SNOWBALL_IOS_TLS_FIXTURES"])
    let fixtures = try JSONDecoder().decode([String: [String: String]].self, from: Data(contentsOf: URL(fileURLWithPath: file)))
    return try XCTUnwrap(fixtures[name])
  }

  private func request(_ name: String, pin: String? = nil, cancel: Bool = false) throws -> Result<Data, GatewayTransportError> {
    let item = try fixture(name)
    let binding = try GatewayBinding(endpoint: XCTUnwrap(URL(string: XCTUnwrap(item["url"]))),
                                     fingerprint: pin ?? XCTUnwrap(item["pin"]), token: String(repeating: "a", count: 43))
    let request = PinnedGatewayRequest(binding: binding)
    let completed = expectation(description: "bounded TLS request")
    var result: Result<Data, GatewayTransportError>?
    request.start { value in result = value; completed.fulfill() }
    if cancel { request.cancel() }
    wait(for: [completed], timeout: 20)
    return try XCTUnwrap(result)
  }

  func testExactOriginAndPinValidation() throws {
    let valid = "https://pc.tailnet.ts.net", pin = String(repeating: "a", count: 64), token = String(repeating: "a", count: 43)
    XCTAssertNoThrow(try GatewayBinding(origin: valid, fingerprint: pin, token: token))
    for origin in [valid + ":443", valid + "/a/..", valid + "?x", valid + "#x", valid + "\\", "https://PC.tailnet.ts.net",
                   "http://pc.tailnet.ts.net", "https://pc.ts.net", "https://pc..tailnet.ts.net", "https://user@pc.tailnet.ts.net", " " + valid] {
      XCTAssertThrowsError(try GatewayBinding(origin: origin, fingerprint: pin, token: token), origin)
    }
    XCTAssertThrowsError(try GatewayBinding(origin: valid, fingerprint: pin + "a", token: token))
    XCTAssertThrowsError(try GatewayBinding(origin: valid, fingerprint: pin + "\n", token: token))
    XCTAssertThrowsError(try GatewayBinding(origin: valid, fingerprint: pin, token: token + "\n"))
  }

  func testPinnedSelfSignedConnectionWithoutSystemRootInstallation() throws {
    let item = try fixture("ok")
    let der = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(item["der"])))
    XCTAssertNotNil(SecCertificateCreateWithData(nil, der as CFData), "Apple must parse the actual gateway certificate")
    let data = try request("ok").get()
    XCTAssertEqual(String(data: data, encoding: .utf8), "{\"sessions\":[]}")
  }

  func testAnotherCertificateForTheSameHostIsRejectedBeforeHTTPRequest() throws {
    let expected = try XCTUnwrap(fixture("ok")["pin"])
    XCTAssertEqual(try request("other", pin: expected).failure, .identityUnverified)
  }

  func testMatchingPinDoesNotOverrideHostnameOrExpiration() throws {
    XCTAssertEqual(try request("wrongHost").failure, .identityUnverified)
    XCTAssertEqual(try request("expired").failure, .identityUnverified)
    XCTAssertEqual(try request("future").failure, .identityUnverified)
  }

  func testRedirectsAreNeverFollowed() throws {
    XCTAssertEqual(try request("redirect").failure, .redirectDenied)
  }

  func testDeclaredAndStreamedOversizedResponsesAreRejected() throws {
    XCTAssertEqual(try request("oversized").failure, .invalidResponse)
    XCTAssertEqual(try request("chunked").failure, .invalidResponse)
  }

  func testHTTPFailureAndContentTypeAreBounded() throws {
    XCTAssertEqual(try request("unauthorized").failure, .unauthorized)
    XCTAssertEqual(try request("forbidden").failure, .forbidden)
    XCTAssertEqual(try request("rateLimited").failure, .rateLimited)
    XCTAssertEqual(try request("unavailable").failure, .unavailable)
    XCTAssertEqual(try request("html").failure, .invalidResponse)
  }

  func testCancellationCompletesWithoutAResponse() throws {
    XCTAssertEqual(try request("slow", cancel: true).failure, .cancelled)
  }

  func testCancellationBeforeStartCannotBeLost() throws {
    let item = try fixture("slow")
    let binding = try GatewayBinding(endpoint: XCTUnwrap(URL(string: XCTUnwrap(item["url"]))),
                                     fingerprint: XCTUnwrap(item["pin"]), token: String(repeating: "a", count: 43))
    let request = PinnedGatewayRequest(binding: binding)
    let completed = expectation(description: "already cancelled")
    request.cancel()
    request.start { result in XCTAssertEqual(result.failure, .cancelled); completed.fulfill() }
    wait(for: [completed], timeout: 2)
  }

  func testTrackBPairingInvitationAndDeviceSigningIdentity() throws {
    let fpBytes = Data(repeating: 0xab, count: 32)
    let fpHex = String(repeating: "ab", count: 32)
    let payload: [String: Any] = [
      "v": 1,
      "n": "Test Mac",
      "s": "pc.tailnet.ts.net",
      "f": fpBytes.base64UrlEncodedString(),
      "u": ["https://192.168.1.20:54321", "https://pc.tailnet.ts.net"],
      "i": "inv_0123456789abcdef0123456789abcdef",
      "k": String(repeating: "b", count: 43)
    ]
    let jsonData = try JSONSerialization.data(withJSONObject: payload)
    let parsed = try ParsedPairingInvitation(pairingCode: "SBP1.\(jsonData.base64UrlEncodedString())")
    XCTAssertEqual(parsed.invitationId, "inv_0123456789abcdef0123456789abcdef")
    XCTAssertEqual(parsed.fingerprint, fpHex)
    XCTAssertEqual(parsed.tlsServerName, "pc.tailnet.ts.net")
    XCTAssertEqual(parsed.endpoints.count, 2)

    let identity = DeviceSigningIdentity()
    XCTAssertTrue(identity.deviceId.hasPrefix("dev_"))
    let (bodyData, sasCode) = try identity.buildPairRequestPayload(
      invitationId: parsed.invitationId,
      invitationSecret: parsed.invitationSecret,
      fingerprint: parsed.fingerprint,
      deviceLabel: "My iPhone"
    )
    XCTAssertEqual(sasCode.count, 6)
    XCTAssertNotNil(Int(sasCode))
    let bodyObj = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
    XCTAssertEqual(bodyObj["invitationId"] as? String, parsed.invitationId)
    XCTAssertEqual(bodyObj["publicKeySpki"] as? String, identity.publicKeySpki)

    let headers = try identity.buildSignedRequestHeaders(method: "GET", path: "/remote/v1/sessions", fingerprint: parsed.fingerprint)
    XCTAssertEqual(headers["X-Snowball-Device-Id"], identity.deviceId)
    XCTAssertNotNil(headers["X-Snowball-Signature"])
  }
}

private extension Result where Failure == GatewayTransportError {
  var failure: GatewayTransportError? { if case .failure(let error) = self { return error }; return nil }
}
