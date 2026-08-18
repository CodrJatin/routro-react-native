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
import { CopyDiagnostics } from '../../src/diagnostics/CopyDiagnostics';
import { SegmentedToggle } from '../../src/components/SegmentedToggle';
import { JourneySimulatorPanel } from '../../src/dev/JourneySimulatorPanel';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { MockFriendPanel } from '../../src/dev/MockFriendPanel';
import { GhostModeSettings } from '../../src/sharing/GhostModeSettings';
import { NotificationSettings } from '../../src/journey/NotificationSettings';
import { MapSettings } from '../../src/map/MapSettings';
import { useTheme, type ThemePreference } from '../../src/theme/ThemeProvider';
import { useSharedStyles } from '../../src/theme/sharedStyles';
import type { ColorTokens } from '../../src/theme/tokens';
import { AnimatedPressable } from '../../src/components/AnimatedPressable';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];



export default function SettingsScreen() {
  const { isConfigured, profile, signOut, updateProfile } = useAuth();
  const { colors, radius, preference, setPreference } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(() => createStyles(colors, radius.none, shared), [colors, radius, shared]);

  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // No hardcoded fallback version. A literal here is a second copy of app.json's
  // `version` that nothing keeps in step, so it goes stale at the next release
  // and then confidently reports a number this build is not -- which is worse
  // than admitting the manifest could not be read. Matches what the diagnostics
  // report says for the same missing value.
  const appVersion = Constants.expoConfig?.version ?? 'unknown';

  // The OS shows its own "Copied" toast on clipboard writes (Android 13+'s
  // system clipboard notification); no app-level feedback needed on top of it.
  async function handleCopyUserId() {
    if (!profile) return;
    await Clipboard.setStringAsync(profile.public_uid);
  }

  function startEditing() {
    setNameInput(profile?.display_name ?? '');
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
                <AnimatedPressable
                  hitSlop={8}
                  onPress={startEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile"
                >
                  <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                </AnimatedPressable>
              </Animated.View>
            )}

            <Avatar
              label={profile.display_name ?? profile.email}
              imageUrl={profile.avatar_url}
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
            <AnimatedPressable
              style={styles.uidRow}
              onPress={handleCopyUserId}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Copy user ID"
            >
              <Text style={styles.profileUid}>ID: {profile.public_uid}</Text>
              <Ionicons name="copy-outline" size={13} color={colors.textSecondary} />
            </AnimatedPressable>

            {isEditing && (
              <Animated.View
                style={styles.editActions}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(140)}
              >
                {saveError && <Text style={styles.errorText}>{saveError}</Text>}
                <View style={styles.editButtonRow}>
                  <AnimatedPressable style={styles.cancelButton} onPress={cancelEditing} disabled={isSaving}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </AnimatedPressable>
                  <AnimatedPressable style={styles.saveButton} onPress={saveEditing} disabled={isSaving}>
                    {isSaving ? (
                      <ActivityIndicator color={colors.onPrimary} size="small" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save</Text>
                    )}
                  </AnimatedPressable>
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
                <AnimatedPressable
                  style={styles.signOutButton}
                  onPress={handleSignOut}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <Ionicons name="log-out-outline" size={18} color={colors.danger} />
                  )}
                  <Text style={styles.signOutText}>
                    {isSigningOut ? 'Signing Out' : 'Sign Out'}
                  </Text>
                </AnimatedPressable>
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
          <Text style={styles.sectionLabel}>Sharing</Text>
          <GhostModeSettings />
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
            <Pressable style={styles.row} onPress={() => Linking.openURL('https://routro.vercel.app')}>
              <View style={styles.rowIconLabel}>
                <Ionicons name="globe-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.rowText}>Visit Website</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            {/* Under the version, because the two are read together: a report
                is only useful alongside the build it came from. */}
            <CopyDiagnostics />
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

        {/* MOCK FRIEND -- temporary dev fixture, delete with
            src/dev/mockFriend.ts */}
        {__DEV__ && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Mock Friend</Text>
            <MockFriendPanel />
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
    signOutText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
