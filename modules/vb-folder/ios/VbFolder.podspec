Pod::Spec.new do |s|
  s.name           = 'VbFolder'
  s.version        = '1.0.0'
  s.summary        = 'Keeps a picked notes folder open across launches'
  s.description    = 'Security-scoped bookmarks and iCloud downloads for the VBNotes notes folder'
  s.license        = 'MIT'
  s.author         = 'Lavneet Sharma'
  s.homepage       = 'https://github.com/lavneet/vbnotes'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
