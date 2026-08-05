import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function OnboardingLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
