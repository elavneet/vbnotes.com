// expo-share-intent adds the share extension for iPhone and iPad ("1,2") whatever the app says.
// When the app is iPhone only (ios.supportsTablet: false), every target is set to iPhone, so the
// extension's device family matches its app.
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withIphoneOnlyExtensions(config) {
  return withXcodeProject(config, (c) => {
    if (c.ios?.supportsTablet) return c;
    const configs = c.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configs)) {
      if (entry?.buildSettings?.TARGETED_DEVICE_FAMILY) entry.buildSettings.TARGETED_DEVICE_FAMILY = '"1"';
    }
    return c;
  });
};
