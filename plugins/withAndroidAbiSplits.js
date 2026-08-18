const { withAppBuildGradle } = require('@expo/config-plugins');

// Per-ABI APKs, plus a universal one as the fallback.
//
// The release APK carries native code for every architecture at once --
// MapLibre's renderer, Hermes, Reanimated and the Expo modules all ship .so
// files -- which is most of why a universal build is as large as it is. A
// device only ever loads one architecture's worth, so splitting the build
// hands the majority of that back to anyone who downloads the right file.
//
// This lives in a config plugin rather than in `android/app/build.gradle`
// because `/android` is gitignored: it is prebuild output, and an edit made
// there is lost the next time the folder is regenerated. The site's download
// section reads the ABI out of each asset's filename, so losing this quietly
// would leave the page offering builds that no longer exist.
//
// `x86` is deliberately absent. It is 32-bit Intel, which no phone ships and
// which even emulators stopped defaulting to years ago; x86_64 covers the
// emulator case. Anything genuinely unusual takes the universal APK.
const ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86_64'];

const SPLITS_BLOCK = `
    // Injected by plugins/withAndroidAbiSplits.js -- edit it there, not here.
    splits {
        abi {
            enable true
            reset()
            include ${ABIS.map((abi) => `"${abi}"`).join(', ')}
            universalApk true
        }
    }
`;

function withAndroidAbiSplits(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'withAndroidAbiSplits only knows how to patch a Groovy build.gradle, ' +
          `got ${config.modResults.language}.`
      );
    }

    const contents = config.modResults.contents;

    // Already there -- prebuild regenerates the file each run, so this only
    // trips if the template itself starts shipping a splits block.
    if (/^\s*splits\s*\{/m.test(contents)) {
      return config;
    }

    // The `android {` block opener, anchored to the start of a line so it
    // cannot match the `androidComponents`/`android.buildFeatures` mentions
    // that appear elsewhere in the file.
    const anchor = /^android\s*\{\s*$/m;
    if (!anchor.test(contents)) {
      throw new Error(
        'withAndroidAbiSplits could not find the `android {` block in app/build.gradle.'
      );
    }

    config.modResults.contents = contents.replace(anchor, (match) => match + SPLITS_BLOCK);
    return config;
  });
}

module.exports = withAndroidAbiSplits;
module.exports.ABIS = ABIS;
