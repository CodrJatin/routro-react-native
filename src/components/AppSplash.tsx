import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RoutroMark } from './RoutroMark';
import { useTheme } from '../theme/ThemeProvider';

/**
 * What the app shows while it is still deciding what to show.
 *
 * Every gate in the root layout used to `return null` here, which paints as a
 * bare window in `app.json`'s `backgroundColor` -- no logo, no spinner, nothing
 * to distinguish "still working" from "hung". This app has no
 * expo-splash-screen to hold the gap either, so those frames were the user's
 * entire experience of a cold start, and of the stretch right after sign-in
 * where the map tab and its ~350KB of bundled graph/track JSON are being pulled
 * in for the first time.
 *
 * The spinner is deliberately React Native's stock `ActivityIndicator` rather
 * than a Reanimated one: it animates on the native side, so it keeps turning
 * through exactly the JS-thread stalls this screen exists to cover. A
 * JS-driven spinner would freeze during the mount it is meant to reassure
 * through, which is worse than showing nothing at all.
 */
export function AppSplash({ message }: { message?: string }) {
  const { colors, typography } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.stack}>
        <RoutroMark size={52} />
        <ActivityIndicator color={colors.textSecondary} />
        {message ? (
          <Text style={[typography.bodyMd, styles.message, { color: colors.textSecondary }]}>
            {message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    alignItems: 'center',
    gap: 20,
  },
  message: {
    textAlign: 'center',
  },
});
