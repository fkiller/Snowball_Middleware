const { withAppDelegate, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// A physical remote check must also start when Metro is unreachable. Keep this
// explicitly in Debug: neither this build option nor bundled JS opens Release.
module.exports = function withEmbeddedDebug(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.NSLocalNetworkUsageDescription ??= 'Snowball connects to the PC you select on your private network.';
    return mod;
  });
  config = withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw Error('Embedded Debug requires the supported Swift Expo template');
    const marker = '// Snowball embedded Debug bundle';
    if (!mod.modResults.contents.includes(marker)) {
      const anchor = '#if DEBUG\n    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")';
      if (!mod.modResults.contents.includes(anchor)) throw Error('Unsupported Expo bundle URL template');
      mod.modResults.contents = mod.modResults.contents.replace(anchor,
        '#if DEBUG\n    ' + marker + '\n    if let embedded = Bundle.main.url(forResource: "main", withExtension: "jsbundle") {\n      return embedded\n    }\n    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")');
    }
    return mod;
  });
  return withXcodeProject(config, mod => {
    const phases = Object.values(mod.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {}).filter(phase =>
      phase && typeof phase === 'object' && phase.name?.replaceAll('"', '') === 'Bundle React Native code and images');
    if (phases.length !== 1) throw Error('Unsupported Expo bundling phase');
    const phase = phases[0], script = JSON.parse(phase.shellScript);
    const marker = '# Snowball embedded Debug bundle';
    if (!script.includes(marker)) {
      const lines = script.split('\n');
      const indexes = lines.flatMap((line, index) => line.includes('react-native-xcode.sh') ? [index] : []);
      if (indexes.length !== 1) throw Error('Unsupported React Native bundling script');
      lines.splice(indexes[0], 0, marker,
        'if [[ "$CONFIGURATION" = *Debug* ]]; then',
        '  if [[ "$SNOWBALL_EMBEDDED_IOS_DEBUG" = "1" ]]; then',
        '    unset SKIP_BUNDLING',
        '    export FORCE_BUNDLING=1',
        '  else',
        '    # A later Metro build must not reuse a stale embedded bundle.',
        '    rm -f -- "$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/main.jsbundle"',
        '  fi',
        'fi', '');
      phase.shellScript = JSON.stringify(lines.join('\n'));
    }
    return mod;
  });
};
