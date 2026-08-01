import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
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
import { MetroSyncMark } from '../../src/components/MetroSyncMark';
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
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result.error) setError(result.error);
  }

  return (
    <View style={styles.root}>
      <SchematicBackdrop colors={colors} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <MetroSyncMark size={44} />
            <ShuttleLine colors={colors} />
            <Text style={styles.eyebrow}>DELHI METRO · LIVE</Text>
            <Text style={styles.title}>MetroSync</Text>
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

/** Two trunk lines, two cross lines and a 45-degree connector, drawn at the
 * threshold of visibility: the geometry of a transit diagram used as page
 * texture rather than as an illustration. Sits outside the safe area so it
 * runs edge to edge. */
function SchematicBackdrop({ colors }: { colors: ColorTokens }) {
  const { width, height } = useWindowDimensions();

  const x1 = Math.round(width * 0.24);
  const x2 = Math.round(width * 0.74);
  const y1 = Math.round(height * 0.14);
  const y2 = Math.round(height * 0.62);
  const diagonal = Math.round(Math.hypot(width, height));

  const line: ViewStyle = { position: 'absolute', backgroundColor: colors.outlineVariant };

  return (
    <View style={backdropStyles.container} pointerEvents="none">
      <View style={[line, { left: -24, right: -24, top: y1, height: 1 }]} />
      <View style={[line, { left: -24, right: -24, top: y2, height: 1 }]} />
      <View style={[line, { top: -24, bottom: -24, left: x1, width: 1 }]} />
      <View style={[line, { top: -24, bottom: -24, left: x2, width: 1 }]} />
      <View
        style={[
          line,
          {
            width: diagonal,
            height: 1,
            left: Math.round((width - diagonal) / 2),
            top: Math.round(height * 0.4),
            transform: [{ rotate: '-52deg' }],
          },
        ]}
      />

      {/* Interchange boxes sit exactly on the crossings, filled with the canvas
       * colour so the lines appear to pass behind them. */}
      {[
        [x1, y1],
        [x2, y1],
        [x1, y2],
        [x2, y2],
      ].map(([x, y]) => (
        <View
          key={`${x}-${y}`}
          style={[
            backdropStyles.interchange,
            {
              left: x - INTERCHANGE / 2,
              top: y - INTERCHANGE / 2,
              borderColor: colors.outline,
              backgroundColor: colors.canvas,
            },
          ]}
        />
      ))}
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

const INTERCHANGE = 10;
const CAR_WIDTH = 26;

const backdropStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.6,
  },
  interchange: {
    position: 'absolute',
    width: INTERCHANGE,
    height: INTERCHANGE,
    borderWidth: 1,
  },
});

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
