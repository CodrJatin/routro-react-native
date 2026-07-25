import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { SegmentedToggle, type SegmentedToggleOption } from '../../src/components/SegmentedToggle';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSharedStyles } from '../../src/theme/sharedStyles';
import type { ColorTokens } from '../../src/theme/tokens';
import { AnimatedTextInput, useFocusAnimation } from '../../src/theme/useFocusAnimation';

type Mode = 'sign-in' | 'sign-up';

const MODE_OPTIONS: SegmentedToggleOption<Mode>[] = [
  { value: 'sign-in', label: 'Sign In', icon: 'log-in-outline' },
  { value: 'sign-up', label: 'Sign Up', icon: 'person-add-outline' },
];

export default function SignInScreen() {
  const { colors, radius } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(() => createStyles(colors, radius.none, shared), [colors, radius, shared]);
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const emailFocus = useFocusAnimation();
  const passwordFocus = useFocusAnimation();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleEmailSubmit() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }
    setIsSubmitting(true);
    const result =
      mode === 'sign-in'
        ? await signInWithEmail(email.trim(), password)
        : await signUpWithEmail(email.trim(), password);
    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else if (mode === 'sign-up') {
      setNotice('Account created. Check your email to confirm, then sign in.');
      setMode('sign-in');
    }
  }

  function handleModeChange(next: Mode) {
    // Messages describe the previous attempt, so they'd be misleading once the
    // form switches purpose.
    setError(null);
    setNotice(null);
    setMode(next);
  }

  async function handleGoogleSubmit() {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result.error) setError(result.error);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title}>MetroSync</Text>
          <Text style={styles.subtitle}>
            {mode === 'sign-in' ? 'Sign in to continue' : 'Create your account'}
          </Text>

          <View style={styles.form}>
            <SegmentedToggle options={MODE_OPTIONS} value={mode} onChange={handleModeChange} />

            <AnimatedTextInput
              style={[styles.input, { borderColor: emailFocus.borderColor, borderWidth: emailFocus.borderWidth }]}
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onFocus={emailFocus.onFocus}
              onBlur={emailFocus.onBlur}
            />
            <AnimatedTextInput
              style={[styles.input, { borderColor: passwordFocus.borderColor, borderWidth: passwordFocus.borderWidth }]}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onFocus={passwordFocus.onFocus}
              onBlur={passwordFocus.onBlur}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}
            {notice && <Text style={styles.noticeText}>{notice}</Text>}

            <Pressable
              style={styles.primaryButton}
              onPress={handleEmailSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === 'sign-in' ? 'Sign In' : 'Sign Up'}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.googleButton}
              onPress={handleGoogleSubmit}
              disabled={isSubmitting}
            >
              <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number, shared: ReturnType<typeof useSharedStyles>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    flex: {
      flex: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      gap: 24,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 32,
      fontWeight: '800',
      textAlign: 'center',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 15,
      textAlign: 'center',
    },
    form: {
      gap: 12,
    },
    input: shared.textInput,
    errorText: {
      color: colors.danger,
      fontSize: 13,
    },
    noticeText: {
      color: colors.success,
      fontSize: 13,
    },
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 13,
    },
    googleButtonText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
