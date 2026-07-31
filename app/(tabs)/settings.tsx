import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { Avatar } from '../../src/components/Avatar';
import { SegmentedToggle } from '../../src/components/SegmentedToggle';
import { JourneySimulatorPanel } from '../../src/dev/JourneySimulatorPanel';
import { NotificationSettings } from '../../src/journey/NotificationSettings';
import { MapSettings } from '../../src/map/MapSettings';
import { useTheme, type ThemePreference } from '../../src/theme/ThemeProvider';
import { useSharedStyles } from '../../src/theme/sharedStyles';
import type { ColorTokens } from '../../src/theme/tokens';
import { AnimatedTextInput, useFocusAnimation } from '../../src/theme/useFocusAnimation';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

const GITHUB_URL = 'https://github.com/codrjatin/metrosync-react-native';

export default function SettingsScreen() {
  const { isConfigured, profile, signOut, updateProfile } = useAuth();
  const { colors, radius, preference, setPreference } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(() => createStyles(colors, radius.none, shared), [colors, radius, shared]);
  const avatarFocus = useFocusAnimation();

  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  // The OS shows its own "Copied" toast on clipboard writes (Android 13+'s
  // system clipboard notification); no app-level feedback needed on top of it.
  async function handleCopyUserId() {
    if (!profile) return;
    await Clipboard.setStringAsync(profile.public_uid);
  }

  function startEditing() {
    setNameInput(profile?.display_name ?? '');
    setAvatarUrlInput(profile?.avatar_url ?? '');
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setSaveError(null);
  }

  async function saveEditing() {
    setIsSaving(true);
    setSaveError(null);
    const result = await updateProfile({
      display_name: nameInput.trim() || null,
      avatar_url: avatarUrlInput.trim() || null,
    });
    setIsSaving(false);
    if (result.error) {
      setSaveError(result.error);
    } else {
      setIsEditing(false);
    }
  }

  /** The press state only lasts as long as the finger is down, but signing out
   * is a network round trip -- without an in-flight state the button springs
   * back to "Sign Out" and looks like nothing happened. */
  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {!isConfigured && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Backend not configured yet. Add EXPO_PUBLIC_SUPABASE_URL and
              EXPO_PUBLIC_SUPABASE_ANON_KEY to .env to enable accounts and friends.
            </Text>
          </View>
        )}

        {isConfigured && profile && (
          <Animated.View style={styles.profileCard} layout={LinearTransition.duration(220)}>
            {!isEditing && (
              <Animated.View style={styles.editButton} entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
                <Pressable
                  hitSlop={8}
                  onPress={startEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile"
                >
                  <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                </Pressable>
              </Animated.View>
            )}

            <Avatar
              label={profile.display_name ?? profile.email}
              imageUrl={isEditing ? avatarUrlInput.trim() || null : profile.avatar_url}
              size={88}
            />

            {isEditing ? (
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={profile.email}
                placeholderTextColor={colors.textSecondary}
                textAlign="center"
                autoFocus
              />
            ) : (
              <Text style={styles.profileName}>{profile.display_name ?? profile.email}</Text>
            )}
            <Text style={styles.profileEmail}>{profile.email}</Text>
            <Pressable
              style={({ pressed }) => [styles.uidRow, pressed && styles.uidRowPressed]}
              onPress={handleCopyUserId}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Copy user ID"
            >
              <Text style={styles.profileUid}>ID: {profile.public_uid}</Text>
              <Ionicons name="copy-outline" size={13} color={colors.textSecondary} />
            </Pressable>

            {isEditing && (
              <Animated.View
                style={styles.editActions}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(140)}
              >
                <Text style={styles.sectionLabel}>Avatar URL</Text>
                <AnimatedTextInput
                  style={[
                    styles.avatarUrlInput,
                    { borderColor: avatarFocus.borderColor, borderWidth: avatarFocus.borderWidth },
                  ]}
                  value={avatarUrlInput}
                  onChangeText={setAvatarUrlInput}
                  placeholder="https://example.com/photo.jpg"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onFocus={avatarFocus.onFocus}
                  onBlur={avatarFocus.onBlur}
                />
                {saveError && <Text style={styles.errorText}>{saveError}</Text>}
                <View style={styles.editButtonRow}>
                  <Pressable style={styles.cancelButton} onPress={cancelEditing} disabled={isSaving}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.saveButton} onPress={saveEditing} disabled={isSaving}>
                    {isSaving ? (
                      <ActivityIndicator color={colors.onPrimary} size="small" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save</Text>
                    )}
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Hidden while editing: Cancel and Save are the actions in that
                state, and a third destructive button beside them is one misread
                tap away from throwing the edit out with the session. */}
            {!isEditing && (
              <Animated.View
                style={styles.signOutSlot}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(140)}
              >
                <Pressable
                  style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
                  onPress={handleSignOut}
                  disabled={isSigningOut}
                >
                  {/* Children as a function: the icon and label are tinted
                   * per-press too, so the outline button inverts as a whole
                   * rather than just swapping its background out from under a
                   * red label. */}
                  {({ pressed }) => (
                    <>
                      {isSigningOut ? (
                        <ActivityIndicator color={colors.danger} size="small" />
                      ) : (
                        <Ionicons
                          name="log-out-outline"
                          size={18}
                          color={pressed ? colors.onError : colors.danger}
                        />
                      )}
                      <Text style={[styles.signOutText, pressed && styles.signOutTextPressed]}>
                        {isSigningOut ? 'Signing Out' : 'Sign Out'}
                      </Text>
                    </>
                  )}
                </Pressable>
              </Animated.View>
            )}
          </Animated.View>
        )}

        <View style={styles.groupedSection}>
          <Text style={styles.sectionLabel}>Preferences</Text>

          <View style={styles.subSection}>
            <Text style={styles.subSectionLabel}>Appearance</Text>
            <SegmentedToggle options={THEME_OPTIONS} value={preference} onChange={setPreference} />
          </View>

          <View style={styles.subSection}>
            <Text style={styles.subSectionLabel}>Map</Text>
            <MapSettings />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Notifications</Text>
          <NotificationSettings />
        </View>

        {/* Last: version and source link are reference material, not something
            anyone came to this screen to change. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>App Info</Text>
          <View style={styles.infoCard}>
            <View style={styles.row}>
              <Text style={styles.rowText}>Version</Text>
              <Text style={styles.rowValue}>{appVersion}</Text>
            </View>
            <Pressable style={styles.row} onPress={() => Linking.openURL(GITHUB_URL)}>
              <View style={styles.rowIconLabel}>
                <Ionicons name="logo-github" size={16} color={colors.textPrimary} />
                <Text style={styles.rowText}>Source on GitHub</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* Below even App Info: nobody ships with this, and in a dev build it
            is still the least important thing on the screen. */}
        {__DEV__ && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Journey Simulator</Text>
            <JourneySimulatorPanel />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number, shared: ReturnType<typeof useSharedStyles>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    content: {
      padding: 20,
      gap: 20,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: '700',
    },
    notice: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 14,
    },
    noticeText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    profileCard: {
      position: 'relative',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 24,
      alignItems: 'center',
      gap: 4,
    },
    editButton: {
      position: 'absolute',
      top: 16,
      right: 16,
      zIndex: 1,
    },
    profileName: {
      color: colors.textPrimary,
      fontSize: 19,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 12,
    },
    nameInput: {
      color: colors.textPrimary,
      fontSize: 19,
      fontWeight: '700',
      textAlign: 'center',
      alignSelf: 'stretch',
      borderBottomWidth: 1,
      borderBottomColor: colors.accent,
      paddingVertical: 2,
      marginTop: 12,
    },
    profileEmail: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
    },
    profileUid: {
      color: colors.textSecondary,
      fontSize: 12,
      textAlign: 'center',
    },
    uidRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    uidRowPressed: {
      opacity: 0.6,
    },
    editActions: {
      alignSelf: 'stretch',
      gap: 8,
      marginTop: 8,
    },
    avatarUrlInput: {
      ...shared.textInput,
      fontSize: 13,
      height: 40,
      paddingVertical: 0,
      textAlignVertical: 'center',
    },
    editButtonRow: {
      flexDirection: 'row',
      gap: 8,
    },
    cancelButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 10,
    },
    cancelButtonText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
    saveButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 10,
    },
    saveButtonText: {
      color: colors.onPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    errorText: {
      color: colors.danger,
      fontSize: 12,
    },
    section: {
      gap: 8,
    },
    // One heading over several controls, so the gap between them has to be
    // wider than the gap between a control and its own label -- otherwise the
    // grouping reads as four unrelated rows.
    groupedSection: {
      gap: 16,
    },
    subSection: {
      gap: 8,
    },
    sectionLabel: shared.sectionLabel,
    // Sentence case against the section heading's caps, so the hierarchy is
    // legible without indentation.
    subSectionLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    infoCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowIconLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowText: {
      color: colors.textPrimary,
      fontSize: 14,
    },
    rowValue: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    // Inside the profile card now, so it has to stretch to the card's width
    // rather than shrink to its own content. The top margin separates it from
    // the ID row above without widening the card's own padding.
    signOutSlot: {
      alignSelf: 'stretch',
      marginTop: 16,
    },
    signOutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radiusNone,
      paddingVertical: 12,
    },
    // Pressing fills the outline in: the same shape language as the rest of
    // the app, and a destructive action deserves a press state you can't miss.
    signOutButtonPressed: {
      backgroundColor: colors.danger,
    },
    signOutText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '700',
    },
    signOutTextPressed: {
      color: colors.onError,
    },
  });
}
