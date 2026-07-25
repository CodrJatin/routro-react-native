import { useRef } from 'react';
import { Animated, TextInput } from 'react-native';
import { useTheme } from './ThemeProvider';

export const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Animated border color/width for a focusable field -- replaces a static
 * always-on border with a visible transition when the field gains focus. */
export function useFocusAnimation() {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  function onFocus() {
    Animated.timing(anim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  }
  function onBlur() {
    Animated.timing(anim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  }

  const borderColor = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.accent] });
  const borderWidth = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });

  return { borderColor, borderWidth, onFocus, onBlur };
}
