const { withAndroidStyles } = require('@expo/config-plugins');

// AppTheme parents `Theme.AppCompat.DayNight.NoActionBar` by default, which
// renders every native Android dialog (including Alert.alert) in the old
// pre-Material look: sharp corners, all-caps buttons, no elevation. Material
// Components is already on the classpath transitively (react-native-screens
// depends on it), so switching the parent is enough to get modern Material 3
// dialog styling with no new native dependency.
const MATERIAL3_PARENT = 'Theme.Material3.DayNight.NoActionBar';

function withAndroidMaterial3Theme(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults;
    const appTheme = styles.resources.style?.find((s) => s.$.name === 'AppTheme');
    if (appTheme) {
      appTheme.$.parent = MATERIAL3_PARENT;
    }
    return config;
  });
}

module.exports = withAndroidMaterial3Theme;
