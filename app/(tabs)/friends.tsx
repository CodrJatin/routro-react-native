import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, type Profile } from '../../src/auth/AuthProvider';
import { Avatar } from '../../src/components/Avatar';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';
import { useFriendshipsContext } from '../../src/friends/FriendshipsProvider';
import { findNearestStation } from '../../src/friends/nearestStation';
import { otherParty } from '../../src/friends/useFriendships';
import { useLocationStore, type PresenceStatus } from '../../src/realtime/locationStore';
import { colors } from '../../src/theme/colors';
import { shared } from '../../src/theme/sharedStyles';

export default function FriendsScreen() {
  const { isConfigured, session } = useAuth();

  if (!isConfigured) {
    return (
      <PlaceholderScreen
        title="Friends"
        note="Backend not configured yet. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then run supabase/migrations/0001_init.sql on your project."
      />
    );
  }

  if (!session) {
    return <PlaceholderScreen title="Friends" note="Sign in to manage friends." />;
  }

  return <FriendsContent selfUserId={session.user.id} />;
}

function FriendsContent({ selfUserId }: { selfUserId: string }) {
  const { rows, isLoading, refetch, sendRequest, acceptRequest, removeFriendship } =
    useFriendshipsContext();
  const [handle, setHandle] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const accepted = rows.filter((r) => r.status === 'accepted');
  const incoming = rows.filter((r) => r.status === 'pending' && r.addressee_id === selfUserId);
  const outgoing = rows.filter((r) => r.status === 'pending' && r.requester_id === selfUserId);

  async function handleSend() {
    if (!handle.trim()) return;
    setIsSending(true);
    setSendError(null);
    const result = await sendRequest(handle);
    setIsSending(false);
    if (result.error) {
      setSendError(result.error);
    } else {
      setHandle('');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      >
        <Text style={styles.title}>Friends</Text>

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Add by email or ID"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            value={handle}
            onChangeText={setHandle}
          />
          <Pressable style={styles.addButton} onPress={handleSend} disabled={isSending}>
            {isSending ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Ionicons name="person-add" size={18} color={colors.background} />
            )}
          </Pressable>
        </View>
        {sendError && <Text style={styles.errorText}>{sendError}</Text>}

        {incoming.length > 0 && (
          <Section title="Requests">
            {incoming.map((row) => (
              <RequestCard
                key={row.id}
                profile={otherParty(row, selfUserId)}
                onAccept={() => acceptRequest(row.id)}
                onDecline={() => removeFriendship(row.id)}
              />
            ))}
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title="Sent">
            {outgoing.map((row) => (
              <SentCard
                key={row.id}
                profile={otherParty(row, selfUserId)}
                onCancel={() => removeFriendship(row.id)}
              />
            ))}
          </Section>
        )}

        <Section title={`Your Friends (${accepted.length})`}>
          {accepted.length === 0 && (
            <Text style={styles.emptyText}>No friends yet -- add one by email or ID above.</Text>
          )}
          {accepted.map((row) => (
            <FriendCard key={row.id} profile={otherParty(row, selfUserId)} />
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

function RequestCard({
  profile,
  onAccept,
  onDecline,
}: {
  profile: Profile;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.card}>
      <Avatar label={profile.display_name ?? profile.email} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{profile.display_name ?? profile.email}</Text>
        <Text style={styles.cardSubtext}>wants to be friends</Text>
      </View>
      <Pressable style={styles.iconButtonAccept} onPress={onAccept}>
        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
      </Pressable>
      <Pressable style={styles.iconButtonDecline} onPress={onDecline}>
        <Ionicons name="close" size={16} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function SentCard({ profile, onCancel }: { profile: Profile; onCancel: () => void }) {
  return (
    <View style={styles.card}>
      <Avatar label={profile.display_name ?? profile.email} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{profile.display_name ?? profile.email}</Text>
        <Text style={styles.cardSubtext}>Request pending</Text>
      </View>
      <Pressable style={styles.iconButtonDecline} onPress={onCancel}>
        <Ionicons name="close" size={16} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function statusColor(status: PresenceStatus): string {
  if (status === 'broadcasting') return colors.success;
  if (status === 'online') return colors.accent;
  return colors.textSecondary;
}

function statusLabel(status: PresenceStatus): string {
  if (status === 'broadcasting') return 'Sharing location';
  if (status === 'online') return 'Online';
  return 'Offline';
}

function FriendCard({ profile }: { profile: Profile }) {
  const router = useRouter();
  const presence = useLocationStore((state) => state.friendPresence[profile.id] ?? 'offline');
  const location = useLocationStore((state) => state.friendLocations[profile.id]);
  const nearest = location ? findNearestStation(location.lat, location.lon) : null;

  return (
    <View style={styles.card}>
      <Avatar label={profile.display_name ?? profile.email} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{profile.display_name ?? profile.email}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(presence) }]} />
          <Text style={styles.cardSubtext}>{statusLabel(presence)}</Text>
        </View>
        {location && nearest && (
          <Text style={styles.cardSubtext}>
            Near {nearest.name} ({formatDistance(nearest.distanceMeters)}) -- {formatRelativeTime(location.ts)}
          </Text>
        )}
      </View>
      {location && (
        <Pressable
          style={styles.focusButton}
          onPress={() =>
            router.push({ pathname: '/(tabs)/map', params: { focusUserId: profile.id } })
          }
        >
          <Ionicons name="locate" size={16} color={colors.textPrimary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addInput: {
    ...shared.textInput,
    flex: 1,
    fontSize: 14,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    marginTop: -12,
  },
  section: {
    gap: 8,
  },
  sectionLabel: shared.sectionLabel,
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  cardSubtext: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  iconButtonAccept: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDecline: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
