import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useLocationStore } from '../realtime/locationStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

/**
 * How long the connection must stay down before this appears at all.
 *
 * The single most important number here. Most drops are momentary -- a gap
 * between two carriages of signal, a handover between towers -- and the first
 * retry is only three seconds behind them, so the overwhelming majority are
 * fixed before anyone could act on being told. Showing a banner for those
 * meant the map flashed a warning at the user several times a journey, every
 * one of which was over by the time they looked up. Nothing was wrong except
 * the reporting of it.
 *
 * Slightly longer than the first retry delay, deliberately: a drop the first
 * attempt recovers from is never mentioned at all.
 */
const APPEAR_AFTER_MS = 4500;

/** One breath of the dot, in each direction. Slow on purpose -- this is
 * ambient status, and anything quick enough to catch the eye is asking for
 * attention the user cannot do anything with. */
const PULSE_MS = 1300;

const DOT_SIZE = 7;

/**
 * Says the live connection is down and being worked on.
 *
 * Deliberately understated, and it is worth being explicit about why, because
 * the first version of this was not. It used a spinner, counted the retry
 * attempts ("reconnecting (2 of 3)") and appeared the instant anything
 * dropped. All three were wrong in the same direction: a spinner is the
 * vocabulary of a blocked action the user is waiting on, a rising count reads
 * as failures stacking up, and appearing immediately meant showing both of
 * those for outages that lasted two seconds. Together they made an app that
 * was quietly recovering look like an app that was falling over.
 *
 * What the user actually needs from this is one bit of information -- friend
 * positions may be behind -- plus the assurance that it is being handled and
 * they need do nothing. Hence a slow pulse rather than a spinner, no numbers,
 * and silence unless the problem outlives the first retry. Retrying never
 * stops (see `RECONNECT_DELAYS_MS` in `locationChannel.ts`), so there is also
 * no failed end-state to warn about -- this simply goes away when the
 * connection returns.
 */
export function ConnectionBanner() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius), [colors, radius]);

  const connectionState = useLocationStore((state) => state.connectionState);
  const isDown = connectionState === 'reconnecting';

  // Two stages, not one: `isDown` is the truth, `isVisible` is whether it has
  // been true long enough to be worth saying. Collapsing them is what made
  // this flash.
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    if (!isDown) {
      setIsVisible(false);
      return;
    }
    const timer = setTimeout(() => setIsVisible(true), APPEAR_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isDown]);

  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: isVisible ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [isVisible, fade]);

  useEffect(() => {
    if (!isVisible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    // Stopped rather than left running behind an opacity of zero -- an
    // animation nobody can see is still a frame callback several times a
    // second, for the whole of an outage that may last a tunnel.
    return () => loop.stop();
  }, [isVisible, pulse]);

  // Unmounted entirely once hidden, so a dropped connection costs nothing at
  // all in the normal case. `isVisible` gates the fade-out too, which is why
  // this checks the animated value rather than the flag.
  if (!isVisible) return null;

  return (
    <Animated.View style={[styles.banner, { opacity: fade }]} pointerEvents="none">
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      <Text style={styles.text}>Reconnecting — friend locations may be behind</Text>
    </Animated.View>
  );
}

function createStyles(colors: ColorTokens, radius: { none: number; badge: number }) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.none,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      // Same muted tone as the text rather than an alert colour. This is a
      // status, not a fault, and amber or red would claim otherwise.
      backgroundColor: colors.onSurfaceVariant,
    },
    text: {
      flex: 1,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
  });
}
