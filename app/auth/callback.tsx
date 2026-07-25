import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Landing route for the `metrosync://auth/callback` OAuth redirect. Android
 * delivers that link as a real intent, so expo-router navigates here while
 * AuthProvider is still installing the session. Wait for the session to appear
 * rather than redirecting on mount -- `/` lives behind the auth guard and does
 * not exist yet at that point. */
export default function AuthCallback() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (session) return <Redirect href="/" />;
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
