import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The four intro illustrations.
 *
 * All of them are Views -- no images, no SVG, no vector library. Everything the
 * app draws is already hairlines, rings and squares, so the diagram vocabulary
 * is sitting right there, and a set of PNGs would be four assets to keep in
 * step with a palette that flips with the system theme.
 *
 * Each carries one slow loop. The rule they share is the one the connection
 * banner sets out: motion here is ambient, so nothing is quick enough to
 * demand attention and everything stops dead under `useReducedMotion`.
 */

const ART_HEIGHT = 172;
const ORIGIN_MARKER = 13;
const DESTINATION_MARKER = 11;
const STOP_SIZE = 7;

/** The plan card's rail, and where a car of `PLAN_CAR_HEIGHT` may sit on it
 * without overlapping either marker. */
const PLAN_RAIL_HEIGHT = 96;
const PLAN_CAR_HEIGHT = 16;
const CAR_TRAVEL_FROM = ORIGIN_MARKER + 3;
const CAR_TRAVEL_TO = PLAN_RAIL_HEIGHT - DESTINATION_MARKER - PLAN_CAR_HEIGHT - 3;

/** A journey drawn the way the planner draws one: a ring for where you are, a
 * square for where you're going, and the stops in between. */
export function PlanArt() {
  const { colors } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
      false,
    );
  }, [progress, prefersReducedMotion]);

  // Travels the rail between the origin ring and the destination square, in
  // points rather than percentages: an animated percentage has to be resolved
  // against the parent every frame, and the two markers it has to stop between
  // are fixed sizes anyway.
  const carStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: CAR_TRAVEL_FROM + progress.value * (CAR_TRAVEL_TO - CAR_TRAVEL_FROM) }],
  }));

  return (
    <View style={styles.frame}>
      <View style={styles.planRow}>
        <View style={styles.planRail}>
          <View style={[styles.railLine, { backgroundColor: colors.outline }]} />
          <Animated.View
            style={[styles.planCar, { backgroundColor: colors.accent }, carStyle]}
          />
          <View style={[styles.originMarker, { borderColor: colors.textPrimary }]} />
          <View style={styles.planStops}>
            <View style={[styles.stop, { backgroundColor: colors.canvas, borderColor: colors.outline }]} />
            <View style={[styles.stop, { backgroundColor: colors.canvas, borderColor: colors.outline }]} />
          </View>
          <View style={[styles.destinationMarker, { backgroundColor: colors.textPrimary }]} />
        </View>

        <View style={styles.planLabels}>
          <View style={styles.planLabelBlock}>
            <Text style={[styles.planStation, { color: colors.textPrimary }]}>RAJIV CHOWK</Text>
            <Text style={[styles.planMeta, { color: colors.textSecondary }]}>YELLOW LINE</Text>
          </View>
          <View style={styles.planLabelBlock}>
            <Text style={[styles.planStation, { color: colors.textPrimary }]}>HAUZ KHAS</Text>
            <Text style={[styles.planMeta, { color: colors.textSecondary }]}>MAGENTA LINE</Text>
          </View>
        </View>
      </View>

      <View style={styles.chipRow}>
        {['24 MIN', '₹43', '1 CHANGE'].map((chip) => (
          <View key={chip} style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.textSecondary }]}>{chip}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Three friends on the network, each breathing on its own offset so the group
 * never pulses in unison -- which reads as a loading state rather than as
 * people moving independently. */
export function FriendsArt() {
  const { colors } = useTheme();

  return (
    <View style={styles.frame}>
      <View style={styles.mapPane}>
        <View style={[styles.mapLine, { backgroundColor: colors.outlineVariant, top: '28%' }]} />
        <View style={[styles.mapLine, { backgroundColor: colors.outlineVariant, top: '68%' }]} />
        <View
          style={[styles.mapLineVertical, { backgroundColor: colors.outlineVariant, left: '32%' }]}
        />
        <View
          style={[styles.mapLineVertical, { backgroundColor: colors.outlineVariant, left: '74%' }]}
        />

        <FriendPin left="32%" top="28%" color={colors.accent} delay={0} />
        <FriendPin left="74%" top="68%" color={colors.success} delay={900} />
        <FriendPin left="32%" top="68%" color={colors.textSecondary} delay={1800} />
      </View>

      <View style={styles.chipRow}>
        <View style={[styles.chip, { borderColor: colors.border }]}>
          <Text style={[styles.chipText, { color: colors.textSecondary }]}>3 LIVE NOW</Text>
        </View>
      </View>
    </View>
  );
}

function FriendPin({
  left,
  top,
  color,
  delay,
}: {
  left: DimensionValue;
  top: DimensionValue;
  color: string;
  /** Staggered per pin. Three rings breathing in unison read as a loading
   * spinner; the same three offset read as three people moving independently,
   * which is what the card is about. */
  delay: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    pulse.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
    );
  }, [pulse, delay, prefersReducedMotion]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 1.8 }],
  }));

  return (
    <View style={[styles.pinAnchor, { left, top }]}>
      <Animated.View style={[styles.pinRing, { borderColor: color }, ringStyle]} />
      <View style={[styles.pinDot, { backgroundColor: color }]} />
    </View>
  );
}

/** The live notification, drawn as the thing it is: a card that keeps counting
 * while the phone is face down. */
export function JourneyArt() {
  const { colors } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const fill = useSharedValue(0.15);

  useEffect(() => {
    if (prefersReducedMotion) return;
    fill.value = withRepeat(
      withSequence(
        withTiming(0.92, { duration: 4200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.92, { duration: 700 }),
        withTiming(0.15, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [fill, prefersReducedMotion]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={styles.frame}>
      <View style={[styles.notification, { borderColor: colors.outline, backgroundColor: colors.surface }]}>
        <View style={styles.notificationHead}>
          <View style={[styles.notificationBadge, { backgroundColor: colors.accent }]} />
          <Text style={[styles.notificationTitle, { color: colors.textPrimary }]}>
            Get off at Hauz Khas
          </Text>
        </View>
        <Text style={[styles.notificationBody, { color: colors.textSecondary }]}>
          Next stop but one · 6 min
        </Text>

        <View style={[styles.progressTrack, { backgroundColor: colors.outlineVariant }]}>
          <Animated.View
            style={[styles.progressFill, { backgroundColor: colors.accent }, fillStyle]}
          />
        </View>

        <View style={styles.notificationStops}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={[styles.stopTick, { backgroundColor: colors.outline }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Ghost Mode, drawn as the symmetry it is: the arrow out and the arrow back
 * are both cut, and the same mark sits over both. */
export function GhostArt() {
  const { colors } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const dim = useSharedValue(1);

  useEffect(() => {
    if (prefersReducedMotion) return;
    dim.value = withRepeat(
      withSequence(
        withTiming(0.18, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.18, { duration: 1100 }),
        withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
      false,
    );
  }, [dim, prefersReducedMotion]);

  const fadingStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <View style={styles.frame}>
      <View style={styles.ghostRow}>
        <View style={styles.ghostEnd}>
          <View style={[styles.ghostNode, { borderColor: colors.textPrimary }]}>
            <Ionicons name="person" size={17} color={colors.textPrimary} />
          </View>
          <Text style={[styles.ghostLabel, { color: colors.textSecondary }]}>YOU</Text>
        </View>

        <View style={styles.ghostMiddle}>
          <Animated.View style={[styles.ghostLinkColumn, fadingStyle]}>
            <View style={[styles.ghostLink, { backgroundColor: colors.outline }]} />
            <View style={[styles.ghostLink, { backgroundColor: colors.outline }]} />
          </Animated.View>
          <View style={[styles.ghostBadge, { borderColor: colors.outline, backgroundColor: colors.canvas }]}>
            <Ionicons name="eye-off" size={16} color={colors.textPrimary} />
          </View>
        </View>

        <View style={styles.ghostEnd}>
          <Animated.View style={fadingStyle}>
            <View style={[styles.ghostNode, { borderColor: colors.outline }]}>
              <Ionicons name="people" size={17} color={colors.textSecondary} />
            </View>
          </Animated.View>
          <Text style={[styles.ghostLabel, { color: colors.textSecondary }]}>FRIENDS</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        <View style={[styles.chip, { borderColor: colors.border }]}>
          <Text style={[styles.chipText, { color: colors.textSecondary }]}>BOTH WAYS</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: ART_HEIGHT,
    justifyContent: 'center',
    gap: 16,
  },

  // -- Plan --------------------------------------------------------------
  planRow: {
    flexDirection: 'row',
    gap: 16,
  },
  planRail: {
    width: ORIGIN_MARKER,
    height: PLAN_RAIL_HEIGHT,
    alignItems: 'center',
  },
  railLine: {
    position: 'absolute',
    top: ORIGIN_MARKER / 2,
    bottom: DESTINATION_MARKER / 2,
    width: 1,
  },
  planCar: {
    position: 'absolute',
    top: 0,
    width: 3,
    height: PLAN_CAR_HEIGHT,
  },
  originMarker: {
    width: ORIGIN_MARKER,
    height: ORIGIN_MARKER,
    borderRadius: ORIGIN_MARKER / 2,
    borderWidth: 2,
  },
  planStops: {
    flex: 1,
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  stop: {
    width: STOP_SIZE,
    height: STOP_SIZE,
    borderWidth: 1,
  },
  destinationMarker: {
    width: DESTINATION_MARKER,
    height: DESTINATION_MARKER,
  },
  planLabels: {
    flex: 1,
    height: PLAN_RAIL_HEIGHT,
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  planLabelBlock: {
    gap: 3,
  },
  planStation: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 15,
    lineHeight: 18,
  },
  planMeta: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  // -- Chips (shared) ----------------------------------------------------
  chipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
  },

  // -- Friends -----------------------------------------------------------
  mapPane: {
    height: 118,
    position: 'relative',
  },
  mapLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  mapLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  pinAnchor: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    // Half the dot, so the anchor's centre lands on the crossing rather than
    // its top-left corner.
    marginLeft: -5,
    marginTop: -5,
  },
  pinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pinRing: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },

  // -- Journey -----------------------------------------------------------
  notification: {
    borderWidth: 1,
    padding: 14,
    gap: 9,
  },
  notificationHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  notificationBadge: {
    width: 3,
    height: 15,
  },
  notificationTitle: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 15,
  },
  notificationBody: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
  },
  progressTrack: {
    height: 2,
    marginTop: 2,
  },
  progressFill: {
    height: 2,
  },
  notificationStops: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stopTick: {
    width: 1,
    height: 5,
  },

  // -- Ghost -------------------------------------------------------------
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ghostEnd: {
    alignItems: 'center',
    gap: 8,
    width: 76,
  },
  ghostNode: {
    width: 46,
    height: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostLabel: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  ghostMiddle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifts the connector onto the nodes' centre line rather than the column's,
    // which the labels below drag downward.
    marginBottom: 17,
  },
  ghostLinkColumn: {
    position: 'absolute',
    left: 0,
    right: 0,
    gap: 7,
  },
  ghostLink: {
    height: 1,
  },
  ghostBadge: {
    width: 30,
    height: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
