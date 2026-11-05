import ExpoModulesCore
import UIKit

public final class SnowballGatewayTransportModule: Module {
  private var requests: [String: PinnedGatewayRequest] = [:]
  private var inactiveObserver: NSObjectProtocol?
  private var generation = 0
  private var developmentTransportAvailable: Bool {
    #if DEBUG
    if #available(iOS 18.0, *) { return true }
    #endif
    return false
  }

  public func definition() -> ModuleDefinition {
    Name("SnowballGatewayTransport")
    // Release binaries refuse the operation even if a JS flag is changed.
    Constants(["developmentTransportAvailable": self.developmentTransportAvailable, "protocolVersion": 1])

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

    AsyncFunction("cancel") { (id: String) in self.requests[id]?.cancel() }.runOnQueue(.main)
  }

  private func cancelAll() {
    generation &+= 1
    for request in requests.values { request.cancel() }
  }
}
