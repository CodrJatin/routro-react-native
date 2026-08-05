// expo-router 57 vendors React Navigation rather than depending on
// @react-navigation/bottom-tabs, and doesn't re-export its types from the
// package root -- so this deep import is currently the only way to get
// BottomTabBarProps. It's type-only, so a future move breaks the build rather
// than the app.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

const CAR_WIDTH = 34;
const CAR_HEIGHT = 3;
const TRACK_TOP = 0;
// Centres the car on the track, so it sticks out above the bar's top edge.
const CAR_TOP = TRACK_TOP - (CAR_HEIGHT - 1) / 2;
const ICON_SIZE = 22;

/**
 * The tab bar's top edge doubles as a line: a hairline track spans the bar and
 * a car -- thicker than the track it rides -- sits on it, sliding to whichever
 * tab is active.
 *
 * The track is drawn as an explicit 1pt View rather than via borderTopWidth, so
 * it can sit flush with the bar's top edge with no gap above it. The car, being
 * thicker, is centred on the track and so pokes out above that edge.
 *
 * Replacing the default tab bar means owning what it gave for free, so tabPress
 * and tabLongPress are still emitted (a preventDefault listener elsewhere keeps
 * working), the selected state is exposed to screen readers, and the bottom
 * safe-area inset comes from the navigator's own `insets`.
 */
export function MetroTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [barWidth, setBarWidth] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  const tabWidth = barWidth / state.routes.length;
  const target = tabWidth > 0 ? state.index * tabWidth + (tabWidth - CAR_WIDTH) / 2 : 0;

  const carX = useSharedValue(0);
  const hasPositioned = useRef(false);

  useEffect(() => {
    if (tabWidth <= 0) return;
    // The very first placement jumps, so the car doesn't glide in from the
    // left edge when the bar mounts. Everything after that is a service
    // running between stations.
    if (!hasPositioned.current || prefersReducedMotion) {
      hasPositioned.current = true;
      carX.value = target;
      return;
    }
    carX.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.cubic) });
  }, [target, tabWidth, carX, prefersReducedMotion]);

  const carStyle = useAnimatedStyle(() => ({ transform: [{ translateX: carX.value }] }));

  function handleLayout(event: LayoutChangeEvent) {
    setBarWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} onLayout={handleLayout}>
      <View style={styles.track} />
      {barWidth > 0 && <Animated.View style={[styles.car, carStyle]} />}

      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const color = isFocused ? colors.accent : colors.textSecondary;

          function handlePress() {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          }

          function handleLongPress() {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          }

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={handlePress}
              onLongPress={handleLongPress}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
            >
              <View style={styles.iconWrap}>
                {options.tabBarIcon?.({ focused: isFocused, color, size: ICON_SIZE })}
                {/* Only ever a dot, never the number itself -- a route that
                    sets tabBarBadge is just saying "something needs
                    attention here", not asking for a printed count. */}
                {!!options.tabBarBadge && <View style={styles.badgeDot} />}
              </View>
              <Text style={[styles.label, { color }]}>{options.title ?? route.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.surface,
      // Clears the car, which straddles the very top of the bar.
      paddingTop: CAR_HEIGHT,
      overflow: 'visible',
    },
    track: {
      position: 'absolute',
      top: TRACK_TOP,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.border,
    },
    car: {
      position: 'absolute',
      top: CAR_TOP,
      left: 0,
      width: CAR_WIDTH,
      height: CAR_HEIGHT,
      backgroundColor: colors.accent,
    },
    row: {
      flexDirection: 'row',
      height: 50,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    iconWrap: {
      position: 'relative',
    },
    badgeDot: {
      position: 'absolute',
      top: -2,
      right: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    label: {
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 11,
      lineHeight: 14,
    },
  });
}
