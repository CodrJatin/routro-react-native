import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import {
  useDialogStore,
  type DialogButton,
  type DialogOptions,
  type DialogTone,
} from './dialogStore';

const ENTER_MS = 170;
const EXIT_MS = 130;

/**
 * Renders whatever `showDialog` has queued.
 *
 * Mounted once, at the root, above the navigator: a dialog raised while a
 * screen is being replaced must outlive the screen that raised it, and several
 * of these come from stores rather than from any screen at all.
 *
 * The platform `Alert` this replaces looked like neither theme and like nothing
 * else in the app -- rounded, system-typeset, and in light mode while the rest
 * of the app was dark. Everything here is drawn from the same tokens as the
 * cards it appears over.
 */
export function DialogHost() {
  const front = useDialogStore((state) => state.queue[0]);

  // Keyed on the dialog's id so each queued dialog gets a fresh card -- and
  // therefore a fresh entry animation -- rather than the second one silently
  // reusing the first one's already-settled shared values.
  return front ? (
    <DialogCard
      key={front.id}
      options={front.options}
      onSettle={(value) => useDialogStore.getState().resolveFront(front.id, value)}
    />
  ) : null;
}

function DialogCard({
  options,
  onSettle,
}: {
  options: DialogOptions<unknown>;
  onSettle: (value: unknown) => void;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius, typography),
    [colors, radius, typography],
  );

  const progress = useSharedValue(0);
  // Kept mounted through the exit animation. Unmounting on press would drop the
  // card the instant it was answered, which is the snap this component exists
  // to remove.
  const [isVisible, setIsVisible] = useState(true);
  const isLeaving = useRef(false);
  const hasFinished = useRef(false);
  const finishGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  function finish(value: unknown) {
    if (hasFinished.current) return;
    hasFinished.current = true;
    if (finishGuard.current) clearTimeout(finishGuard.current);
    setIsVisible(false);
    onSettle(value);
  }

  useEffect(() => {
    progress.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.quad) });
  }, [progress]);

  function close(value: unknown, onPress?: () => void) {
    // Two taps landing either side of the exit animation would otherwise run
    // two callbacks and settle the promise twice.
    if (isLeaving.current) return;
    isLeaving.current = true;

    // Before the animation, not after: a caller that opens a second dialog from
    // its callback (a failure alert following a confirm) should have it queued
    // and ready rather than waiting on this one's fade.
    onPress?.();

    progress.value = withTiming(
      0,
      { duration: EXIT_MS, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(finish)(value);
      },
    );
    // Reanimated skips the callback if the view is torn down mid-animation
    // (a screen swap, the app backgrounding), which would leave the promise
    // hanging forever and the caller's spinner with it.
    finishGuard.current = setTimeout(() => finish(value), EXIT_MS + 120);
  }

  useEffect(() => () => {
    if (finishGuard.current) clearTimeout(finishGuard.current);
  }, []);

  const buttons: DialogButton<unknown>[] =
    options.buttons && options.buttons.length > 0
      ? options.buttons
      : [{ text: 'OK', value: options.dismissValue }];

  const isDismissable = options.dismissable !== false;

  function handleDismiss() {
    if (!isDismissable) return;
    // Routed through the cancel button when there is one, so its `onPress` runs
    // -- escaping a dialog and pressing its own "Not now" are the same answer,
    // and callers should not have to handle them separately.
    const cancel = buttons.find((button) => button.style === 'cancel');
    close(cancel ? cancel.value : options.dismissValue, cancel?.onPress);
  }

  // Android's hardware back closes a Modal through onRequestClose, but a dialog
  // marked undismissable must not be closed by it *and* must not let the press
  // fall through to the navigator behind, which would pop the screen out from
  // under the dialog.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDismissable) handleDismiss();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDismissable]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      // A short rise rather than a scale pop: the app's shape language is
      // square and unrounded, and a scaling rectangle reads as a system alert.
      { translateY: (1 - progress.value) * 12 },
    ],
  }));

  // Side by side while both labels are short, stacked once they are not --
  // three buttons, or wording long enough to wrap, and a row of squeezed
  // two-line buttons is worse than a column of clear ones.
  const isStacked = buttons.length > 2 || buttons.some((button) => button.text.length > 14);

  /** The last non-cancel button: what the dialog is actually asking for, and
   * the only filled thing on the card. -1 when every button is a cancel. */
  const primaryIndex = buttons.reduce(
    (last, button, index) => (button.style === 'cancel' ? last : index),
    -1,
  );

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          {/* The scrim itself is the dismiss target, so a tap anywhere outside
              the card answers the dialog the same way back does. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleDismiss}
            accessible={false}
            // Nothing to announce: the card below carries the dialog's content,
            // and a full-screen button over it would be read first.
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>

        <Animated.View
          style={[styles.card, cardStyle]}
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <View style={[styles.toneRule, toneRuleStyle(options.tone, colors)]} />

          <View style={styles.body}>
            <Text style={styles.title}>{options.title}</Text>
            {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
          </View>

          <View style={[styles.buttons, isStacked && styles.buttonsStacked]}>
            {buttons.map((button, index) => {
              const isCancel = button.style === 'cancel';
              const isDestructive = button.style === 'destructive';
              const isPrimary = index === primaryIndex;

              return (
                <AnimatedPressable
                  key={`${button.text}-${index}`}
                  style={[
                    styles.button,
                    isStacked && styles.buttonStacked,
                    isPrimary && !isDestructive && styles.buttonPrimary,
                    isDestructive && styles.buttonDestructive,
                  ]}
                  onPress={() => close(button.value, button.onPress)}
                  accessibilityRole="button"
                  accessibilityLabel={button.text}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel && styles.buttonTextQuiet,
                      isPrimary && !isDestructive && styles.buttonTextOnPrimary,
                      isDestructive && styles.buttonTextDestructive,
                    ]}
                    numberOfLines={1}
                  >
                    {button.text.toUpperCase()}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function toneRuleStyle(tone: DialogTone | undefined, colors: ColorTokens) {
  return {
    backgroundColor:
      tone === 'danger' ? colors.error : tone === 'success' ? colors.success : colors.textPrimary,
  };
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    scrim: {
      // Dark in both themes. The scrim's job is to put the app behind glass,
      // and a light one over a light screen does not read as behind anything.
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radius.none,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    toneRule: {
      height: 3,
    },
    body: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 18,
      gap: 8,
    },
    title: {
      ...typography.headlineMd,
      fontSize: 19,
      lineHeight: 25,
      color: colors.textPrimary,
    },
    message: {
      ...typography.bodyMd,
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    buttons: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    buttonsStacked: {
      // Same order as the row form -- cancel first, the asked-for action last --
      // which stacked also puts the primary closest to the thumb.
      flexDirection: 'column',
    },
    button: {
      flex: 1,
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.none,
    },
    buttonStacked: {
      flex: 0,
      width: '100%',
    },
    buttonPrimary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    buttonDestructive: {
      borderColor: colors.error,
    },
    buttonText: {
      ...typography.labelCaps,
      fontSize: 11,
      color: colors.textPrimary,
    },
    buttonTextQuiet: {
      color: colors.textSecondary,
    },
    buttonTextOnPrimary: {
      color: colors.onPrimary,
    },
    buttonTextDestructive: {
      color: colors.error,
    },
  });
}
