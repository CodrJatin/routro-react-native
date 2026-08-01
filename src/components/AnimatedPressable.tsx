import React, { useState } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle, PressableStateCallbackType } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressableComponent = Animated.createAnimatedComponent(Pressable);

export function AnimatedPressable({
  style,
  disabled,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...props
}: PressableProps) {
  const scale = useSharedValue(1);
  const [isPressed, setIsPressed] = useState(false);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = (e: any) => {
    setIsPressed(true);
    if (!disabled) {
      scale.value = withTiming(0.97, { duration: 100 });
    }
    if (onPressIn) onPressIn(e);
  };

  const handlePressOut = (e: any) => {
    setIsPressed(false);
    if (!disabled) {
      scale.value = withTiming(1, { duration: 150 });
    }
    if (onPressOut) onPressOut(e);
  };

  const handlePress = (e: any) => {
    if (disabled) return;
    if (onPress) onPress(e);
  };

  const resolvedStyle = typeof style === 'function' ? style({ pressed: isPressed }) : style;

  return (
    <AnimatedPressableComponent
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={disabled}
      style={[resolvedStyle, animatedStyle] as StyleProp<ViewStyle>}
      {...props}
    >
      {typeof children === 'function' ? children({ pressed: isPressed }) : children}
    </AnimatedPressableComponent>
  );
}
