import { Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
import { installCrashCapture } from '../src/diagnostics/crashReport';
import { installConsoleCapture } from '../src/diagnostics/logBuffer';
import { useBasemapStore } from '../src/map/basemapStore';
import { useOnboardingStore } from '../src/onboarding/onboardingStore';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { useOtaUpdates } from '../src/updates/useOtaUpdates';

/**
 * Catches render errors anywhere below this layout -- which, since this is the
 * root, is the whole app including every provider it mounts.
 *
 * expo-router discovers this by name: an `ErrorBoundary` export makes the
 * router wrap the route in its `Try` component, and it wraps the route
 * *component itself*, not merely what that component renders -- so this covers
 * `RootLayout` below as well as everything it mounts. Exported from here
 * rather than from each tab so there is one of them and no screen can be added
 * without cover.
 *
 * Note the limit, since it is easy to assume otherwise: this catches errors
 * thrown while *rendering*. A rejected promise in an event handler or an
 * effect never reaches it, which is why the async paths elsewhere in this app
 * handle their own failures rather than relying on this.
 */
/**
 * Started at module scope, before any component renders, so the warnings this
 * app emits during start-up -- the ones a launch problem would consist of --
 * are in the buffer rather than lost to a console nobody is attached to. See
 * `logBuffer.ts`.
 */
installConsoleCapture();
// After the console capture, so a crash carries the log lines leading up to it
// rather than an empty ring. Catches what the boundary below cannot: a throw
// outside rendering, and an unhandled rejection.
installCrashCapture();

export { AppErrorBoundary as ErrorBoundary };

function RootNavigator() {
  const { isConfigured, isLoading, session } = useAuth();
  const { colors, mode } = useTheme();
  const hasOnboarded = useOnboardingStore((state) => state.hasCompleted);
  const isOnboardingHydrated = useOnboardingStore((state) => state.isHydrated);

  // With no Supabase project configured yet, skip the auth gate entirely so
  // the offline map/routing tabs stay usable; Friends/Settings show their
  // own "not configured" notices instead.
  const isAuthenticated = !isConfigured || !!session;

  // Anyone already signed in has plainly been here before, so a restored
  // session outranks the flag -- an intro shown to a returning user because
  // their storage was cleared would be the app forgetting them out loud.
  const needsOnboarding = !hasOnboarded && !isAuthenticated;

  if (isConfigured && isLoading) {
    return null;
  }
  // Held until the flag has actually been read. Rendering on the default of
  // `false` would flash the intro at every returning user for the frame or two
  // before the read lands.
  if (!isOnboardingHydrated) {
    return null;
  }

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={!needsOnboarding && isAuthenticated}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!needsOnboarding && !isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  // Read here rather than in the map screen so the basemap preference has
  // landed before the map first paints -- hydrating later would render the
  // offline style and then swap the whole style out from under it.
  const hydrateBasemap = useBasemapStore((state) => state.hydrate);
  useEffect(() => {
    hydrateBasemap();
  }, [hydrateBasemap]);

  // Same reasoning, stronger: this one decides which stack renders at all, so
  // the navigator below holds its first paint until the read lands.
  const hydrateOnboarding = useOnboardingStore((state) => state.hydrate);
  useEffect(() => {
    void hydrateOnboarding();
  }, [hydrateOnboarding]);

  // Picks up over-the-air updates on the way back into the app, rather than
  // only at a cold start that may never come again. Deliberately mounted above
  // the auth gate: an update is worth having whether or not anyone is signed
  // in, and this renders nothing either way.
  useOtaUpdates();

  if (fontError) {
    // Fall through and render with system fonts rather than staying blank
    // forever -- a failed download/parse shouldn't brick the whole app.
    console.error('Failed to load custom fonts, falling back to system fonts:', fontError);
  }

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
