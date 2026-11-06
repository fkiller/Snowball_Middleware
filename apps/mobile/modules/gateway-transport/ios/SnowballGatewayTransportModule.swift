import ExpoModulesCore
import UIKit
import AVFoundation

private protocol CancellableTransportRequest {
  func cancel()
}

extension PinnedGatewayRequest: CancellableTransportRequest {}
extension MultiEndpointPinnedRequest: CancellableTransportRequest {}

@MainActor
private final class QRScannerViewController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "dev.snowball.mobile.qr-scanner")
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var onResult: ((Result<String, GatewayTransportError>) -> Void)?
  private var finished = false

  init(onResult: @escaping (Result<String, GatewayTransportError>) -> Void) {
    self.onResult = onResult
    super.init(nibName: nil, bundle: nil)
    self.modalPresentationStyle = .pageSheet
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.04, green: 0.06, blue: 0.09, alpha: 1.0)

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)
    self.previewLayer = preview

    let headerBar = UIView()
    headerBar.translatesAutoresizingMaskIntoConstraints = false
    headerBar.backgroundColor = UIColor(red: 0.04, green: 0.06, blue: 0.09, alpha: 0.88)
    view.addSubview(headerBar)

    let titleLabel = UILabel()
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.text = "PC 연결 QR 코드 스캔"
    titleLabel.textColor = .white
    titleLabel.font = .systemFont(ofSize: 17, weight: .bold)
    headerBar.addSubview(titleLabel)

    let closeButton = UIButton(type: .system)
    closeButton.translatesAutoresizingMaskIntoConstraints = false
    closeButton.setTitle("취소", for: .normal)
    closeButton.setTitleColor(UIColor(red: 0.47, green: 0.75, blue: 1.0, alpha: 1.0), for: .normal)
    closeButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
    closeButton.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
    headerBar.addSubview(closeButton)

    let guideFrame = UIView()
    guideFrame.translatesAutoresizingMaskIntoConstraints = false
    guideFrame.layer.borderColor = UIColor(red: 0.47, green: 0.75, blue: 1.0, alpha: 0.9).cgColor
    guideFrame.layer.borderWidth = 3
    guideFrame.layer.cornerRadius = 18
    guideFrame.backgroundColor = .clear
    view.addSubview(guideFrame)

    let hintLabel = UILabel()
    hintLabel.translatesAutoresizingMaskIntoConstraints = false
    hintLabel.text = "PC의 Snowball 화면에서 [📱 휴대폰 연결]을 눌러\n표시된 QR 코드를 사각형 안에 맞춰 주세요."
    hintLabel.textColor = .white
    hintLabel.numberOfLines = 0
    hintLabel.textAlignment = .center
    hintLabel.font = .systemFont(ofSize: 14, weight: .medium)
    hintLabel.backgroundColor = UIColor(red: 0.04, green: 0.06, blue: 0.09, alpha: 0.82)
    hintLabel.layer.cornerRadius = 10
    hintLabel.clipsToBounds = true
    view.addSubview(hintLabel)

    NSLayoutConstraint.activate([
      headerBar.topAnchor.constraint(equalTo: view.topAnchor),
      headerBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      headerBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      headerBar.heightAnchor.constraint(equalToConstant: 64),

      titleLabel.centerXAnchor.constraint(equalTo: headerBar.centerXAnchor),
      titleLabel.centerYAnchor.constraint(equalTo: headerBar.centerYAnchor, constant: 6),

      closeButton.trailingAnchor.constraint(equalTo: headerBar.trailingAnchor, constant: -20),
      closeButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),

      guideFrame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      guideFrame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
      guideFrame.widthAnchor.constraint(equalToConstant: 240),
      guideFrame.heightAnchor.constraint(equalToConstant: 240),

      hintLabel.topAnchor.constraint(equalTo: guideFrame.bottomAnchor, constant: 24),
      hintLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
      hintLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
      hintLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 52)
    ])

    configureCamera()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    finish(with: .failure(.cancelled))
  }

  private func configureCamera() {
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    if status == .notDetermined {
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self = self else { return }
          if granted { self.startCaptureSession() }
          else { self.finish(with: .failure(.forbidden)) }
        }
      }
      return
    }
    guard status == .authorized else {
      finish(with: .failure(.forbidden))
      return
    }
    startCaptureSession()
  }

  private func startCaptureSession() {
    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
      finish(with: .failure(.unavailable))
      return
    }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      finish(with: .failure(.unavailable))
      return
    }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)
    if output.availableMetadataObjectTypes.contains(.qr) {
      output.metadataObjectTypes = [.qr]
    }
    let captureSession = session
    sessionQueue.async { captureSession.startRunning() }
  }

  @objc private func handleCancel() {
    finish(with: .failure(.cancelled))
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard !finished else { return }
    for obj in metadataObjects {
      if let readable = obj as? AVMetadataMachineReadableCodeObject,
         readable.type == .qr,
         let value = readable.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
         value.hasPrefix("SBP1.") {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        finish(with: .success(value))
        return
      }
    }
  }

  private func finish(with result: Result<String, GatewayTransportError>) {
    guard !finished else { return }
    finished = true
    let callback = onResult
    onResult = nil
    let captureSession = session
    sessionQueue.async {
      if captureSession.isRunning { captureSession.stopRunning() }
    }
    if presentingViewController != nil {
      dismiss(animated: true) { callback?(result) }
    } else {
      callback?(result)
    }
  }
}

public final class SnowballGatewayTransportModule: Module {
  private var requests: [String: CancellableTransportRequest] = [:]
  private var inactiveObserver: NSObjectProtocol?
  private var generation = 0
  private var developmentTransportAvailable: Bool {
    #if DEBUG
    if #available(iOS 18.0, *) { return true }
    #endif
    return false
  }
  private var initialPairingCode: String {
    #if DEBUG
    return ProcessInfo.processInfo.environment["SNOWBALL_PAIRING_CODE"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    #else
    return ""
    #endif
  }

  public func definition() -> ModuleDefinition {
    Name("SnowballGatewayTransport")
    // Release binaries refuse the operation even if a JS flag is changed.
    Constants([
      "developmentTransportAvailable": self.developmentTransportAvailable,
      "protocolVersion": 1,
      "initialPairingCode": self.initialPairingCode
    ])

    OnCreate {
      self.inactiveObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in self?.cancelAll() }
    }
    OnDestroy {
      if let observer = self.inactiveObserver { NotificationCenter.default.removeObserver(observer) }
      DispatchQueue.main.async { self.cancelAll() }
    }

    AsyncFunction("listSessions") { (id: String, origin: String, fingerprint: String, token: String, promise: Promise) in
      #if DEBUG
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("cancelled", "cancelled"); return
      }
      guard id.range(of: "^[0-9-]{1,64}\\z", options: .regularExpression) != nil,
            self.requests[id] == nil, self.requests.count < 4,
            let binding = try? GatewayBinding(origin: origin, fingerprint: fingerprint, token: token) else {
        promise.reject("invalid_input", "invalid_input"); return
      }
      let request = PinnedGatewayRequest(binding: binding)
      let generation = self.generation
      self.requests[id] = request
      request.start { result in
        DispatchQueue.main.async {
          self.requests.removeValue(forKey: id)
          guard generation == self.generation, UIApplication.shared.applicationState == .active else {
            promise.reject("cancelled", "cancelled"); return
          }
          switch result {
          case .success(let data):
            guard let json = String(data: data, encoding: .utf8) else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            promise.resolve(json)
          case .failure(let error): promise.reject(error.rawValue, error.rawValue)
          }
        }
      }
      #else
      promise.reject("gateway_identity_unverified", "gateway_identity_unverified")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("requestPairing") { (id: String, pairingCode: String, deviceLabel: String, promise: Promise) in
      #if DEBUG
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("cancelled", "cancelled"); return
      }
      guard id.range(of: "^[0-9-]{1,64}\\z", options: .regularExpression) != nil,
            self.requests[id] == nil, self.requests.count < 4,
            let invitation = try? ParsedPairingInvitation(pairingCode: pairingCode) else {
        promise.reject("invalid_input", "invalid_input"); return
      }
      let identity = DeviceSigningIdentity.loadOrCreateInKeychain()
      let label = deviceLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? UIDevice.current.name : deviceLabel
      guard let (bodyData, localVerificationCode) = try? identity.buildPairRequestPayload(
        invitationId: invitation.invitationId,
        invitationSecret: invitation.invitationSecret,
        fingerprint: invitation.fingerprint,
        deviceLabel: label
      ) else {
        promise.reject("invalid_input", "invalid_input"); return
      }
      let request = MultiEndpointPinnedRequest(
        endpoints: invitation.endpoints,
        path: "/remote/v1/pair/request",
        tlsServerName: invitation.tlsServerName,
        fingerprint: invitation.fingerprint,
        method: "POST",
        headersProvider: { [:] },
        body: bodyData
      )
      let generation = self.generation
      self.requests[id] = request
      request.start { result in
        DispatchQueue.main.async {
          self.requests.removeValue(forKey: id)
          guard generation == self.generation, UIApplication.shared.applicationState == .active else {
            promise.reject("cancelled", "cancelled"); return
          }
          switch result {
          case .success(let (data, activeEndpoint)):
            guard let serverObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pairingId = serverObj["pairingId"] as? String,
                  let serverCode = serverObj["verificationCode"] as? String,
                  serverCode == localVerificationCode else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            let orderedEndpoints = [activeEndpoint] + invitation.endpoints.filter { $0 != activeEndpoint }
            let responseDict: [String: Any] = [
              "pairingId": pairingId,
              "deviceId": identity.deviceId,
              "verificationCode": localVerificationCode,
              "pcName": (serverObj["pcName"] as? String) ?? invitation.pcName,
              "tlsServerName": invitation.tlsServerName,
              "fingerprint": invitation.fingerprint,
              "endpoints": orderedEndpoints,
              "activeEndpoint": activeEndpoint
            ]
            guard let outData = try? JSONSerialization.data(withJSONObject: responseDict),
                  let outJson = String(data: outData, encoding: .utf8) else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            promise.resolve(outJson)
          case .failure(let error):
            promise.reject(error.rawValue, error.rawValue)
          }
        }
      }
      #else
      promise.reject("gateway_identity_unverified", "gateway_identity_unverified")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("checkPairingStatus") { (id: String, endpoints: [String], tlsServerName: String, fingerprint: String, promise: Promise) in
      #if DEBUG
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("cancelled", "cancelled"); return
      }
      guard id.range(of: "^[0-9-]{1,64}\\z", options: .regularExpression) != nil,
            self.requests[id] == nil, self.requests.count < 4, !endpoints.isEmpty else {
        promise.reject("invalid_input", "invalid_input"); return
      }
      let identity = DeviceSigningIdentity.loadOrCreateInKeychain()
      let request = MultiEndpointPinnedRequest(
        endpoints: endpoints,
        path: "/remote/v1/pair/status",
        tlsServerName: tlsServerName,
        fingerprint: fingerprint,
        method: "GET",
        headersProvider: {
          try identity.buildSignedRequestHeaders(method: "GET", path: "/remote/v1/pair/status", fingerprint: fingerprint)
        }
      )
      let generation = self.generation
      self.requests[id] = request
      request.start { result in
        DispatchQueue.main.async {
          self.requests.removeValue(forKey: id)
          guard generation == self.generation, UIApplication.shared.applicationState == .active else {
            promise.reject("cancelled", "cancelled"); return
          }
          switch result {
          case .success(let (data, activeEndpoint)):
            guard var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            obj["activeEndpoint"] = activeEndpoint
            guard let outData = try? JSONSerialization.data(withJSONObject: obj),
                  let outJson = String(data: outData, encoding: .utf8) else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            promise.resolve(outJson)
          case .failure(let error):
            promise.reject(error.rawValue, error.rawValue)
          }
        }
      }
      #else
      promise.reject("gateway_identity_unverified", "gateway_identity_unverified")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("listSignedSessions") { (id: String, endpoints: [String], tlsServerName: String, fingerprint: String, promise: Promise) in
      #if DEBUG
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("cancelled", "cancelled"); return
      }
      guard id.range(of: "^[0-9-]{1,64}\\z", options: .regularExpression) != nil,
            self.requests[id] == nil, self.requests.count < 4, !endpoints.isEmpty else {
        promise.reject("invalid_input", "invalid_input"); return
      }
      let identity = DeviceSigningIdentity.loadOrCreateInKeychain()
      let request = MultiEndpointPinnedRequest(
        endpoints: endpoints,
        path: "/remote/v1/sessions",
        tlsServerName: tlsServerName,
        fingerprint: fingerprint,
        method: "GET",
        headersProvider: {
          try identity.buildSignedRequestHeaders(method: "GET", path: "/remote/v1/sessions", fingerprint: fingerprint)
        }
      )
      let generation = self.generation
      self.requests[id] = request
      request.start { result in
        DispatchQueue.main.async {
          self.requests.removeValue(forKey: id)
          guard generation == self.generation, UIApplication.shared.applicationState == .active else {
            promise.reject("cancelled", "cancelled"); return
          }
          switch result {
          case .success(let (data, _)):
            guard let json = String(data: data, encoding: .utf8) else {
              promise.reject("invalid_response", "invalid_response"); return
            }
            promise.resolve(json)
          case .failure(let error):
            promise.reject(error.rawValue, error.rawValue)
          }
        }
      }
      #else
      promise.reject("gateway_identity_unverified", "gateway_identity_unverified")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("scanQrCode") { (promise: Promise) in
      #if DEBUG
      MainActor.assumeIsolated {
        guard UIApplication.shared.applicationState == .active,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              var topController = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene.windows.first?.rootViewController else {
          promise.reject("unavailable", "unavailable"); return
        }
        while let presented = topController.presentedViewController {
          topController = presented
        }
        let scanner = QRScannerViewController { result in
          switch result {
          case .success(let code):
            promise.resolve(code)
          case .failure(let error):
            promise.reject(error.rawValue, error.rawValue)
          }
        }
        topController.present(scanner, animated: true)
      }
      #else
      promise.reject("unavailable", "unavailable")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("readClipboardPairingCode") { (promise: Promise) in
      #if DEBUG
      if let envCode = ProcessInfo.processInfo.environment["SNOWBALL_PAIRING_CODE"]?.trimmingCharacters(in: .whitespacesAndNewlines),
         !envCode.isEmpty {
        promise.resolve(envCode)
        return
      }
      let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      promise.resolve(text)
      #else
      promise.resolve("")
      #endif
    }.runOnQueue(.main)

    AsyncFunction("cancel") { (id: String) in self.requests[id]?.cancel() }.runOnQueue(.main)
  }

  private func cancelAll() {
    generation &+= 1
    for request in requests.values { request.cancel() }
  }
}
