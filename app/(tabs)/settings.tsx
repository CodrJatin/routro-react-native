import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { Avatar } from '../../src/components/Avatar';
import { colors } from '../../src/theme/colors';
import { shared } from '../../src/theme/sharedStyles';

export default function SettingsScreen() {
  const { isConfigured, profile, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.content}>
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
          <View style={styles.profileCard}>
            <Avatar label={profile.display_name ?? profile.email} size={52} />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{profile.display_name ?? profile.email}</Text>
              <Text style={styles.profileEmail}>{profile.email}</Text>
              <Text style={styles.profileUid}>ID: {profile.public_uid}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Appearance</Text>
          <View style={styles.row}>
            <Text style={styles.rowText}>Theme</Text>
            <Text style={styles.rowValue}>Dark (default)</Text>
          </View>
        </View>

        {isConfigured && profile && (
          <Pressable style={styles.signOutButton} onPress={signOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
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
    borderRadius: 10,
    padding: 14,
  },
  noticeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
  },
  profileInfo: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  profileEmail: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  profileUid: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  section: {
    gap: 8,
  },
  sectionLabel: shared.sectionLabel,
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  rowValue: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 'auto',
  },
  signOutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
