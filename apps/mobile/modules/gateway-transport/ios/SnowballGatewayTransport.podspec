Pod::Spec.new do |s|
  s.name = 'SnowballGatewayTransport'
  s.version = '0.1.0'
  s.summary = 'Development-only pinned Snowball read transport'
  s.description = s.summary
  s.license = { :type => 'Apache-2.0' }
  s.author = 'Snowball'
  s.homepage = 'https://github.com/fkiller/Snowball_Middleware'
  s.source = { :git => 'https://github.com/fkiller/Snowball_Middleware.git' }
  s.platform = :ios, '16.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end
