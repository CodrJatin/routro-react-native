import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedPressable } from '../../src/components/AnimatedPressable';
import { SchematicBackdrop } from '../../src/components/SchematicBackdrop';
import { FriendsArt, GhostArt, JourneyArt, PlanArt } from '../../src/onboarding/OnboardingArt';
import { useOnboardingStore } from '../../src/onboarding/onboardingStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';

const CAR_WIDTH = 30;
const CAR_HEIGHT = 4;
const STOP_SIZE = 9;

interface Card {
  eyebrow: string;
  title: string;
  body: string;
  art: () => React.ReactElement;
}

/**
 * Four stops, and the last one is the only one that has to land.
 *
 * The order is deliberate: what the app does, who it does it with, what it does
 * while you aren't looking, and only then what that means for your privacy. The
 * privacy card reads as a promise at the end of that sequence and as a warning
 * at the start of it, and they are the same words either way.
 */
const CARDS: Card[] = [
  {
    eyebrow: 'ROUTE · 01',
    title: 'Plan the ride',
    body: 'Every Delhi Metro line, fares and interchanges included. Times counted from where you actually are, not from the start of the trip.',
    art: PlanArt,
  },
  {
    eyebrow: 'ROUTE · 02',
    title: 'Find your people',
    body: 'Friends you add show up live on the map — which line they are on, which station they reach next, and how far off they are.',
    art: FriendsArt,
  },
  {
    eyebrow: 'ROUTE · 03',
    title: 'Pocket the phone',
    body: 'Start a journey and Routro keeps counting in a notification, then tells you when to get off. It keeps working with the screen locked.',
    art: JourneyArt,
  },
  {
    eyebrow: 'ROUTE · 04',
    title: 'Ghost Mode',
    body: "Routro shares your location with your friends while the app is open, once you've added someone. Ghost Mode cuts it both ways — they can't see you, you can't see them — and switches itself off when you close the app.",
    art: GhostArt,
  },
];

export default function OnboardingScreen() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );
  const { width } = useWindowDimensions();
  const complete = useOnboardingStore((state) => state.complete);

  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  // From momentum end rather than from every frame: this drives which stops are
  // painted as visited, and repainting four Views on every pixel of a drag
  // would be a lot of work to arrive at the same four Views.
  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  const isLast = index === CARDS.length - 1;

  function goTo(target: number) {
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
  }

  return (
    <View style={styles.root}>
      <SchematicBackdrop colors={colors} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <LineProgress index={index} count={CARDS.length} colors={colors} />
          {/* Skips to the last stop rather than out of the intro. Three cards
              of features are genuinely optional; the one explaining what the
              app does with your location is the reason this screen exists, and
              it is one more tap from there to leave. */}
          <Pressable
            onPress={() => (isLast ? complete() : goTo(CARDS.length - 1))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Skip to sign in' : 'Skip to the last step'}
            style={({ pressed }) => [styles.skip, pressed && styles.pressedText]}
          >
            <Text style={styles.skipText}>SKIP</Text>
          </Pressable>
        </View>

        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          onMomentumScrollEnd={handleMomentumEnd}
          scrollEventThrottle={16}
          style={styles.deck}
        >
          {CARDS.map((card, cardIndex) => (
            <CardPane
              key={card.eyebrow}
              card={card}
              cardIndex={cardIndex}
              scrollX={scrollX}
              width={width}
              styles={styles}
            />
          ))}
        </Animated.ScrollView>

        <View style={styles.actions}>
          <AnimatedPressable
            style={styles.primaryButton}
            onPress={() => (isLast ? complete() : goTo(index + 1))}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Get started' : 'Next'}
          >
            <Text style={styles.primaryButtonText}>{isLast ? 'Get started' : 'Next'}</Text>
            <Ionicons
              name={isLast ? 'arrow-forward' : 'chevron-forward'}
              size={17}
              color={colors.onPrimary}
            />
          </AnimatedPressable>

          <Pressable
            onPress={complete}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="I already have an account, go to sign in"
            style={({ pressed }) => [styles.loginRow, pressed && styles.pressedText]}
          >
            <Text style={styles.loginText}>
              Already have an account? <Text style={styles.loginTextStrong}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * One card, drifting at a fraction of the scroll speed.
 *
 * The parallax is what stops four pages of centred text from feeling like a
 * slideshow: the art and the words move at different rates, so a swipe reads as
 * travelling past something rather than as a cut between two stills. Small on
 * purpose -- past about a fifth of the page width it stops being depth and
 * starts being lag.
 */
function CardPane({
  card,
  cardIndex,
  scrollX,
  width,
  styles,
}: {
  card: Card;
  cardIndex: number;
  scrollX: SharedValue<number>;
  width: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const prefersReducedMotion = useReducedMotion();
  const Art = card.art;

  const range = [(cardIndex - 1) * width, cardIndex * width, (cardIndex + 1) * width];

  const artStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) return {};
    return {
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.18, 0, -width * 0.18], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    };
  }, [range, prefersReducedMotion]);

  const textStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) return {};
    return {
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.06, 0, -width * 0.06], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    };
  }, [range, prefersReducedMotion]);

  return (
    <View style={[styles.pane, { width }]}>
      <Animated.View style={artStyle}>
        <Art />
      </Animated.View>

      <Animated.View style={[styles.copy, textStyle]}>
        <Text style={styles.eyebrow}>{card.eyebrow}</Text>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.body}>{card.body}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * The progress indicator is a metro line, and advancing a card runs a train to
 * the next station.
 *
 * The same car that rides the tab bar and shuttles across the sign-in screen,
 * doing a third job here. Dots would have said the same thing in the same
 * space; this says it in the app's own handwriting, and it means the first
 * thing a new user sees moving is the thing they will see moving every time
 * they change tabs afterwards.
 *
 * Stations behind the train fill in, so the line is also a record of how far
 * through this you are.
 */
function LineProgress({
  index,
  count,
  colors,
}: {
  index: number;
  count: number;
  colors: ColorTokens;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const carX = useSharedValue(0);
  const hasPositioned = useRef(false);

  const travel = Math.max(trackWidth - CAR_WIDTH, 0);
  const step = count > 1 ? travel / (count - 1) : 0;

  // Driven by the settled index rather than by scroll offset, so the train
  // arrives at a station instead of hovering between two whenever a drag is
  // released halfway. A service has either reached the next stop or is on its
  // way there.
  const target = index * step;

  useEffect(() => {
    if (trackWidth <= 0) return;
    // The first placement jumps, so the train doesn't glide in from the left
    // edge on mount -- same rule the tab bar's car follows, for the same
    // reason. Everything after that is a service running between stations.
    if (!hasPositioned.current || prefersReducedMotion) {
      hasPositioned.current = true;
      carX.value = target;
      return;
    }
    carX.value = withTiming(target, { duration: 340, easing: Easing.inOut(Easing.cubic) });
  }, [target, trackWidth, carX, prefersReducedMotion]);

  const carStyle = useAnimatedStyle(() => ({ transform: [{ translateX: carX.value }] }));

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={progressStyles.track} onLayout={handleLayout}>
      <View style={[progressStyles.rail, { backgroundColor: colors.outlineVariant }]} />

      {trackWidth > 0 &&
        Array.from({ length: count }, (_, stopIndex) => (
          <View
            key={stopIndex}
            style={[
              progressStyles.stop,
              {
                // Centred on where the car's own centre lands at this index, so
                // the train pulls up exactly at the station rather than near it.
                left: CAR_WIDTH / 2 + stopIndex * step - STOP_SIZE / 2,
                borderColor: stopIndex <= index ? colors.accent : colors.outline,
                backgroundColor: stopIndex <= index ? colors.accent : colors.canvas,
              },
            ]}
          />
        ))}

      {trackWidth > 0 && (
        <Animated.View
          style={[progressStyles.car, { backgroundColor: colors.textPrimary }, carStyle]}
        />
      )}
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    flex: 1,
    height: 18,
    justifyContent: 'center',
  },
  rail: {
    height: 1,
  },
  stop: {
    position: 'absolute',
    width: STOP_SIZE,
    height: STOP_SIZE,
    borderWidth: 1,
  },
  car: {
    position: 'absolute',
    left: 0,
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 20,
      paddingHorizontal: 28,
      paddingTop: 12,
    },
    skip: {
      paddingVertical: 4,
    },
    skipText: {
      ...typography.labelCaps,
      color: colors.textSecondary,
      letterSpacing: 1.6,
    },
    pressedText: {
      opacity: 0.55,
    },
    deck: {
      flex: 1,
    },
    // Bottom-weighted like the sign-in screen it hands over to: art takes the
    // open space, words sit in thumb reach just above the button.
    //
    // Height comes from the row's default `alignItems: 'stretch'`, never from
    // `flex: 1`. Inside a horizontal ScrollView the children are laid out in a
    // row, where flex governs the *width* -- so `flex: 1` here would throw away
    // the per-page width that makes paging work at all.
    pane: {
      justifyContent: 'flex-end',
      paddingHorizontal: 28,
      paddingBottom: 12,
      gap: 40,
    },
    copy: {
      gap: 12,
    },
    eyebrow: {
      ...typography.labelCaps,
      color: colors.textSecondary,
      letterSpacing: 2,
    },
    title: {
      ...typography.displayLg,
      fontSize: 36,
      lineHeight: 42,
      color: colors.textPrimary,
    },
    body: {
      ...typography.bodyLg,
      fontSize: 16,
      lineHeight: 25,
      color: colors.textSecondary,
    },
    actions: {
      paddingHorizontal: 28,
      paddingBottom: 20,
      paddingTop: 20,
      gap: 16,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 17,
    },
    primaryButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
      fontFamily: 'Outfit_600SemiBold',
      letterSpacing: 0.2,
    },
    loginRow: {
      alignItems: 'center',
    },
    loginText: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.textSecondary,
    },
    loginTextStrong: {
      color: colors.textPrimary,
      fontFamily: 'Outfit_600SemiBold',
      fontWeight: '600',
    },
  });
}
