import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface Props<T extends string> {
  options: SegmentedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

const PADDING = 4;
const GAP = 4;

/** Segmented control with a sliding highlight -- the active pill animates to
 * its new position instead of the background snapping between options. */
export function SegmentedToggle<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);
  const [containerWidth, setContainerWidth] = useState(0);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const translateX = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: activeIndex,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, translateX]);

  const count = options.length;
  const segmentWidth = count > 0 ? (containerWidth - PADDING * 2 - GAP * (count - 1)) / count : 0;
  const step = segmentWidth + GAP;

  function handleLayout(event: LayoutChangeEvent) {
    setContainerWidth(event.nativeEvent.layout.width);
  }

  return (
    <Animated.View style={styles.row} onLayout={handleLayout}>
      {containerWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              transform: [
                {
                  translateX: translateX.interpolate({
                    inputRange: options.map((_, i) => i),
                    outputRange: options.map((_, i) => i * step),
                  }),
                },
              ],
            },
          ]}
        />
      )}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            {option.icon && (
              <Ionicons name={option.icon} size={16} color={active ? colors.onPrimary : colors.textSecondary} />
            )}
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.border,
      padding: PADDING,
      gap: GAP,
    },
    thumb: {
      position: 'absolute',
      top: PADDING,
      bottom: PADDING,
      left: PADDING,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
    },
    segmentPressed: {
      opacity: 0.7,
    },
    segmentText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.onPrimary,
    },
  });
}
