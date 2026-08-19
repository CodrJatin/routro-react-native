import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Landing route for the `routro://auth/callback` OAuth redirect. Android
 * delivers that link as a real intent, so expo-router navigates here while
 * AuthProvider is still installing the session. Wait for the session to appear
 * rather than redirecting on mount -- `/` lives behind the auth guard and does
 * not exist yet at that point.
 *
 * The destination names its group on purpose. Two routes claim `/` --
 * `(onboarding)/index` and `(tabs)/index` -- and a bare `href="/"` resolves to
 * the `(onboarding)` one, which `Stack.Protected` has filtered out of the
 * navigator by the time anyone has a session. That navigation then goes
 * nowhere at all: no error, no fallback, just this route left mounted
 * rendering `null` over the root Stack's background, which is what the "blank
 * screen after signing in" bug actually was. Every other imperative
 * navigation in this app already spells out `/(tabs)`; this one is the same
 * rule, not a special case. */
export default function AuthCallback() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (session) return <Redirect href="/(tabs)" />;
  if (timedOut) return <Redirect href="/sign-in" />;

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ActivityIndicator color={colors.textPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
