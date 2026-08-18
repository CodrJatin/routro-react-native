import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { persistCrash } from '../diagnostics/crashReport';
import { recordLog } from '../diagnostics/logBuffer';
import { colorsFor, radius, spacing, typography } from '../theme/tokens';

/**
 * The last thing standing between a render error and a blank screen.
 *
 * Without one of these a throw anywhere in the tree unmounts the whole app:
 * white in a release build, with no message, no way back, and nothing written
 * down. Reinstalling is the only move the user has left, and it takes their
 * session with it.
 *
 * Deliberately built out of nothing but `react-native` and the raw token
 * module. It reads no context, calls no store, touches no provider -- because
 * the error it is catching may well have come from one of those, and a
 * fallback that needs the thing that just broke is not a fallback. That rules
 * out `useTheme`, so the light/dark choice comes from `useColorScheme`
 * directly; it means ignoring the user's explicit theme preference (which
 * lives in a store) in favour of the system one, which is the right trade for
 * a screen nobody should be looking at for long.
 *
 * The font families in `typography` are a soft dependency and safe to keep:
 * an unloaded font renders as the system face rather than throwing, and this
 * screen can be reached before `useFonts` has resolved.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const colors = colorsFor(scheme === 'light' ? 'light' : 'dark');

  // Into the diagnostics ring, so a crash is still in the report the user
  // copies after tapping Try again -- by which point this screen, and the
  // message on it, are gone. In an effect rather than during render because a
  // render can be discarded and replayed, and a crash recorded twice reads as
  // two crashes.
  useEffect(() => {
    recordLog('error', ['[crash] render failed:', error]);
    // Not fatal: React caught this and the user has a Try again button. Still
    // worth uploading -- a render error that sends someone to this screen is a
    // bug whether or not the process survived it.
    persistCrash(error, { isFatal: false });
  }, [error]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Something broke</Text>
        <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>
          Routro hit an error it couldn&apos;t recover from on its own. Your journeys and friends
          are unaffected — trying again usually clears it.
        </Text>

        {/* The message, not the stack: a stack is noise to the person reading
            it and is minified in release anyway. The message is the one part
            that survives minification intact and is worth quoting back when
            someone reports this. Scrollable because it can be long. */}
        <ScrollView
          style={[styles.detail, { backgroundColor: colors.surface, borderColor: colors.border }]}
          contentContainerStyle={styles.detailContent}
        >
          <Text style={[styles.detailText, { color: colors.onSurfaceVariant }]}>
            {error?.message || 'No error message was reported.'}
          </Text>
        </ScrollView>

        {/* expo-router's own retry: it remounts the segment rather than
            reloading the process, so a transient failure costs nothing. A
            genuinely broken state simply throws again and lands back here,
            which is a better outcome than a button that isn't offered. */}
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary },
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    gap: spacing.md,
  },
  title: {
    ...typography.headlineMd,
  },
  body: {
    ...typography.bodyMd,
  },
  detail: {
    maxHeight: 160,
    borderWidth: 1,
    borderRadius: radius.none,
  },
  detailContent: {
    padding: spacing.sm,
  },
  detailText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.none,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    ...typography.labelCaps,
  },
});
