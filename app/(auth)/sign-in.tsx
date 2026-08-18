import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { RoutroMark } from '../../src/components/RoutroMark';
import { SchematicBackdrop } from '../../src/components/SchematicBackdrop';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';
import { AnimatedPressable } from '../../src/components/AnimatedPressable';

export default function SignInScreen() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGoogleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) setError(result.error);
    } catch (err) {
      console.warn('[sign-in] unexpected error', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <SchematicBackdrop colors={colors} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <RoutroMark size={52} />
            <ShuttleLine colors={colors} />
            <Text style={styles.eyebrow}>DELHI METRO · LIVE</Text>
            <Text style={styles.title}>Routro</Text>
            <Text style={styles.tagline}>Plan the ride.{'\n'}Find your people.</Text>
          </View>

          <View style={styles.actions}>
            {error && (
              <Animated.View entering={FadeIn.duration(160)} style={styles.errorStrip}>
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            )}

            {/* Google is deliberately the only sign-in method: email/password would
             * need a custom SMTP setup to get past Supabase's confirmation-email
             * rate limits. */}
            <AnimatedPressable
              style={styles.googleButton}
              onPress={handleGoogleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color={colors.onPrimary} />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </>
              )}
            </AnimatedPressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Terminus-to-terminus shuttle: the car runs back and forth between the end
 * stops, so the screen has a pulse before you touch it. Replaces the static
 * three-station mark that used to stand in for a logo. */
function ShuttleLine({ colors }: { colors: ColorTokens }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [progress, prefersReducedMotion]);

  const travel = Math.max(trackWidth - CAR_WIDTH, 0);
  const carStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * travel }] }), [travel]);

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={shuttleStyles.track} onLayout={handleLayout}>
      <View style={[shuttleStyles.rail, { backgroundColor: colors.outlineVariant }]} />
      <View style={shuttleStyles.stops} pointerEvents="none">
        <View style={[shuttleStyles.stop, { backgroundColor: colors.outline }]} />
        <View style={[shuttleStyles.stop, { backgroundColor: colors.outline }]} />
        <View style={[shuttleStyles.stop, { backgroundColor: colors.outline }]} />
      </View>
      <Animated.View style={[shuttleStyles.car, { backgroundColor: colors.textPrimary }, carStyle]} />
    </View>
  );
}

const CAR_WIDTH = 26;

const shuttleStyles = StyleSheet.create({
  track: {
    height: 18,
    justifyContent: 'center',
  },
  rail: {
    height: 1,
  },
  stops: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stop: {
    width: 2,
    height: 10,
  },
  car: {
    position: 'absolute',
    left: 0,
    width: CAR_WIDTH,
    height: 4,
  },
});

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    safeArea: {
      flex: 1,
    },
    // Bottom-weighted: the schematic gets the open space up top, the wordmark
    // and the button stay in thumb reach.
    content: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: 28,
      paddingBottom: 24,
      gap: 48,
    },
    hero: {
      gap: 14,
    },
    eyebrow: {
      ...typography.labelCaps,
      color: colors.textSecondary,
      letterSpacing: 2,
    },
    title: {
      ...typography.displayLg,
      color: colors.textPrimary,
    },
    tagline: {
      ...typography.bodyLg,
      color: colors.textSecondary,
    },
    actions: {
      gap: 14,
    },
    errorStrip: {
      backgroundColor: colors.surfaceContainer,
      borderLeftWidth: 2,
      borderLeftColor: colors.danger,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    errorText: {
      ...typography.bodyMd,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 17,
    },
    googleButtonPressed: {
      opacity: 0.85,
    },
    googleButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
      fontFamily: 'Outfit_600SemiBold',
      letterSpacing: 0.2,
    },
  });
}
