require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'BarnabiCardExpand'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = ''
  s.homepage       = 'https://github.com/barnabi/card-expand'
  # Match the host app's Podfile deployment target. All SwiftUI APIs used by
  # this module are available on iOS 15.1:
  #   - matchedGeometryEffect (iOS 14+)
  #   - .spring(response:dampingFraction:) (iOS 14+)
  #   - AsyncImage (iOS 15+)
  #   - preferredColorScheme(_:) (iOS 14+)
  # Lowering to 15.1 avoids a Pods warning about incompatible deployment
  # targets that would require an override in Podfile.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
