import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';

/** Google is deliberately the only sign-in method: email/password would need a
 * custom SMTP setup to get past Supabase's confirmation-email rate limits. */
const FEATURES: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'git-branch-outline', label: 'Fastest routes across the metro network' },
  { icon: 'people-outline', label: 'See where your friends are, live' },
  { icon: 'bookmark-outline', label: 'Save the journeys you take often' },
];

export default function SignInScreen() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGoogleSubmit() {
    setError(null);
    setIsSubmitting(true);
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result.error) setError(result.error);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <RouteMark colors={colors} />
          <Text style={styles.title}>MetroSync</Text>
          <Text style={styles.subtitle}>Plan the ride. Find your people.</Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map((feature) => (
            <View key={feature.label} style={styles.featureRow}>
              <Ionicons name={feature.icon} size={17} color={colors.onSurfaceVariant} />
              <Text style={styles.featureText}>{feature.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          {error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.googleButton, pressed && styles.googleButtonPressed]}
            onPress={handleGoogleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.onPrimary} />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

        </View>
      </View>
    </SafeAreaView>
  );
}

/** Three stations on a line -- the app's visual signature, standing in for a logo. */
function RouteMark({ colors }: { colors: ColorTokens }) {
  return (
    <View style={markStyles.row}>
      <View style={[markStyles.stop, { borderColor: colors.onSurfaceVariant }]} />
      <View style={[markStyles.line, { backgroundColor: colors.outlineVariant }]} />
      <View style={[markStyles.stopActive, { backgroundColor: colors.textPrimary }]} />
      <View style={[markStyles.line, { backgroundColor: colors.outlineVariant }]} />
      <View style={[markStyles.stop, { borderColor: colors.onSurfaceVariant }]} />
    </View>
  );
}

const markStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stop: {
    width: 10,
    height: 10,
    borderWidth: 2,
  },
  stopActive: {
    width: 14,
    height: 14,
  },
  line: {
    width: 34,
    height: 2,
  },
});

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 40,
    },
    hero: {
      alignItems: 'center',
      gap: 16,
    },
    title: {
      ...typography.displayLg,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      ...typography.bodyMd,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    features: {
      gap: 14,
      borderLeftWidth: 2,
      borderLeftColor: colors.outlineVariant,
      paddingLeft: 16,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    featureText: {
      ...typography.bodyMd,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      flex: 1,
    },
    actions: {
      gap: 14,
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 16,
    },
    googleButtonPressed: {
      opacity: 0.85,
    },
    googleButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
      fontFamily: 'Outfit_600SemiBold',
    },
    errorText: {
      ...typography.bodyMd,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
      textAlign: 'center',
    },
  });
}
