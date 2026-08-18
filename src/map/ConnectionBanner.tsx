import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { locationChannelManager } from '../realtime/locationChannel';
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
 * How long the retry button keeps spinning at minimum.
 *
 * `retryNow` resolves once the rejoin has been *made*, which is almost
 * immediate -- the answer arrives later, on the channel's subscribe callback.
 * Without a floor the spinner would appear and vanish within a frame or two,
 * which reads as the tap not having registered. Long enough to be seen,
 * short enough not to hold a button hostage that is already tappable again.
 */
const MIN_SPINNER_MS = 700;

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
  const isOnline = useLocationStore((state) => state.isOnline);
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

  // Tracked so the minimum-duration timer below cannot set state after the
  // banner has gone -- which is the *expected* ending here, since a successful
  // retry unmounts this component while its own spinner is still running.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    // The manager collapses overlapping attempts on its own, so this guard is
    // only about the button: a second tap should do nothing visible rather
    // than restart the spinner on an attempt already under way.
    if (isRetrying) return;
    setIsRetrying(true);
    const startedAt = Date.now();
    try {
      await locationChannelManager.retryNow();
    } finally {
      const remaining = Math.max(0, MIN_SPINNER_MS - (Date.now() - startedAt));
      setTimeout(() => {
        if (isMounted.current) setIsRetrying(false);
      }, remaining);
    }
  }, [isRetrying]);

  // Unmounted entirely once hidden, so a dropped connection costs nothing at
  // all in the normal case.
  if (!isVisible) return null;

  return (
    // Not `pointerEvents="none"` any more, unlike every other overlay on this
    // map: there is something to press now. The parent is `box-none`, so
    // touches outside the banner still reach the map underneath.
    <Animated.View style={[styles.banner, { opacity: fade }]}>
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      {/* The two cases read the same from inside the reconnect ladder and mean
          completely different things to the person holding the phone. One is
          "wait, this is being handled"; the other is "the device has no
          internet", which the app cannot fix and the user usually can. Saying
          "Reconnecting" to someone with wifi switched off was the app blaming
          itself for their setting. */}
      <Text style={styles.text}>
        {isOnline
          ? 'Reconnecting — friend locations may be behind'
          : 'No internet connection — friend locations are paused'}
      </Text>
      {/* Offered only when there is something for it to do. The automatic
          retries are already running, and this only brings the next one
          forward -- which earns its place when the user knows something the
          app does not, but is a button that cannot possibly work while the
          device itself is offline. The network watcher retries on its own the
          instant the radio returns, so nothing is lost by withholding it. */}
      {isOnline && (
        <Pressable
          onPress={handleRetry}
          disabled={isRetrying}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retry connection now"
          accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
          style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
          ) : (
            <Ionicons name="refresh" size={14} color={colors.onSurfaceVariant} />
          )}
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
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
    retry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      // Fixed width so swapping the icon for the spinner -- which is the wider
      // of the two -- does not shove the label sideways mid-press.
      minWidth: 62,
      justifyContent: 'flex-end',
    },
    retryPressed: {
      opacity: 0.6,
    },
    retryText: {
      fontSize: 12,
      // The one thing here that is meant to look tappable, so it carries the
      // full-strength text colour against the banner's muted one.
      color: colors.textPrimary,
      fontWeight: '600',
    },
  });
}
