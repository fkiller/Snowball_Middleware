// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SnowballGatewayTransport",
  platforms: [.macOS(.v13), .iOS(.v16)],
  targets: [
    .target(name: "GatewayTransport", path: "ios", exclude: ["SnowballGatewayTransportModule.swift", "SnowballGatewayTransport.podspec"]),
    .testTarget(name: "GatewayTransportTests", dependencies: ["GatewayTransport"], path: "tests")
  ]
)
