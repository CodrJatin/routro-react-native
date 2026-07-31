import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, type Profile } from '../../src/auth/AuthProvider';
import { Avatar } from '../../src/components/Avatar';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';
import { getCompiledGraph } from '../../src/engine/graph';
import type { RawLines } from '../../src/engine/types';
import { useFriendshipsContext } from '../../src/friends/FriendshipsProvider';
import { InviteSheet } from '../../src/friends/InviteSheet';
import { inferCurrentLine } from '../../src/friends/currentLine';
import { estimateFriendEta } from '../../src/friends/friendEta';
import { findNearestStation, type NearestStation } from '../../src/friends/nearestStation';
import { otherParty } from '../../src/friends/useFriendships';
import { useSelfPositionStore } from '../../src/location/selfPosition';
import { useSeedSelfPosition } from '../../src/location/useSeedSelfPosition';
import { useFriendStatuses, useLocationStore, type FriendLocation, type FriendStatus } from '../../src/realtime/locationStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSharedStyles } from '../../src/theme/sharedStyles';
import type { ColorTokens, TypeStyle } from '../../src/theme/tokens';
import { AnimatedTextInput, useFocusAnimation } from '../../src/theme/useFocusAnimation';

/** Beyond this, the nearest station is no longer a meaningful "current line"
 * -- e.g. a friend who isn't near the metro at all. Roughly the outer edge
 * of typical inter-station spacing, so it doesn't hide legitimate matches. */
const NEARBY_LINE_MAX_METERS = 1500;

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
  const { profile } = useAuth();
  const { colors, radius, typography } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(
    () => createStyles(colors, radius.none, radius.badge, typography, shared),
    [colors, radius, typography, shared],
  );
  const lines = useMemo(() => getCompiledGraph().lines, []);
  const {
    rows,
    isRefreshing,
    error: listError,
    refetch,
    sendRequest,
    acceptRequest,
    removeFriendship,
  } = useFriendshipsContext();
  const [handle, setHandle] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const handleFocus = useFocusAnimation();
  const router = useRouter();

  // The user's own position, for the "how far is this friend from me"
  // estimate -- read from the shared store rather than this screen keeping
  // its own copy. A private last-known read here meant this tab and the map
  // could hold different answers at the same moment and place the user at
  // different stations on one journey, which is the exact thing
  // selfPosition.ts exists to prevent. Seeding stays watcher-free: the map
  // owns the app's only live GPS watcher.
  useSeedSelfPosition();
  const selfPosition = useSelfPositionStore((state) => state.position);

  // Read fresh on every render rather than ticked via a local setInterval --
  // useFriendStatuses() below already re-renders this component on the one
  // shared clock tick, so this stays reasonably fresh for the "updated Xs
  // ago" text without a second, duplicated timer.
  const now = Date.now();

  const friendLocations = useLocationStore((state) => state.friendLocations);
  const statuses = useFriendStatuses();

  const accepted = rows.filter((r) => r.status === 'accepted');
  const incoming = rows.filter((r) => r.status === 'pending' && r.addressee_id === selfUserId);
  const outgoing = rows.filter((r) => r.status === 'pending' && r.requester_id === selfUserId);

  // Active/Inactive comes from the single shared status selector (see
  // locationStore.ts) rather than raw presence or a local staleness guess --
  // this is what keeps the map and this list from ever disagreeing about the
  // same friend again. 'live'/'stale' both count as Active (presence flips
  // to 'broadcasting' before the first GPS fix arrives, so location can
  // briefly be null right after a friend turns broadcasting on -- that's
  // still Active, just shown as "waiting for location").
  const active: { profile: Profile; location: FriendLocation | null }[] = [];
  const inactive: { profile: Profile; location: FriendLocation | null; status: FriendStatus }[] = [];
  for (const row of accepted) {
    const profile = otherParty(row, selfUserId);
    const location = friendLocations[profile.id] ?? null;
    const status = statuses[profile.id] ?? 'offline';
    if (status === 'live' || status === 'stale') {
      active.push({ profile, location });
    } else {
      inactive.push({ profile, location, status });
    }
  }

  const isEmpty = accepted.length === 0 && incoming.length === 0 && outgoing.length === 0;

  function handleChangeText(text: string) {
    setHandle(text);
    // The error refers to whatever was submitted, not what's in the box now
    // -- once the user edits it, an unrelated stale error shouldn't linger.
    if (sendError) setSendError(null);
  }

  function clearHandle() {
    setHandle('');
    setSendError(null);
  }

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

  async function handleAccept(friendshipId: string) {
    setActionError(null);
    const result = await acceptRequest(friendshipId);
    if (result.error) setActionError(result.error);
  }

  async function handleRemove(friendshipId: string) {
    setActionError(null);
    const result = await removeFriendship(friendshipId);
    if (result.error) setActionError(result.error);
  }

  /** Hands the map a friend to focus. The map clears the param once it has
   * flown there, so coming back to this tab later doesn't re-trigger it. */
  function showFriendOnMap(friendUserId: string) {
    router.navigate({ pathname: '/(tabs)', params: { focusUserId: friendUserId } });
  }

  function removeFriend(profile: Profile) {
    const row = accepted.find((r) => otherParty(r, selfUserId).id === profile.id);
    if (row) void handleRemove(row.id);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refetch} />}
      >
        <Text style={styles.title}>Friends</Text>

        <View style={styles.addRow}>
          <View style={styles.addInputWrapper}>
            <AnimatedTextInput
              style={[
                styles.addInput,
                { borderColor: handleFocus.borderColor, borderWidth: handleFocus.borderWidth },
              ]}
              placeholder="Add by email or ID"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              value={handle}
              onChangeText={handleChangeText}
              onFocus={handleFocus.onFocus}
              onBlur={handleFocus.onBlur}
            />
            {handle.length > 0 && (
              <Pressable
                style={styles.clearButton}
                onPress={clearHandle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear input"
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <Pressable style={styles.addButton} onPress={handleSend} disabled={isSending}>
            {isSending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Ionicons name="person-add" size={18} color={colors.onPrimary} />
            )}
          </Pressable>
        </View>
        {sendError && <Text style={styles.errorText}>{sendError}</Text>}
        {actionError && <Text style={styles.errorText}>{actionError}</Text>}
        {listError && <Text style={styles.errorText}>{listError}</Text>}

        {/* The other direction: rather than needing their handle, hand them
            yours as a link or a code and let them come to you. Gated on the
            profile because the invite is built from its public_uid, which
            arrives a moment after the session does. */}
        {profile && (
          <Pressable
            style={({ pressed }) => [styles.inviteButton, pressed && styles.inviteButtonPressed]}
            onPress={() => setIsInviteOpen(true)}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.inviteButtonText}>Invite by link or QR</Text>
          </Pressable>
        )}

        {isEmpty && (
          <Animated.View
            style={styles.emptyState}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(220)}
          >
            <Ionicons name="people-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptyNote}>
              Add someone by their email or ID above, or send them your invite link, to start
              sharing live locations.
            </Text>
          </Animated.View>
        )}

        {(incoming.length > 0 || outgoing.length > 0) && (
          <Section title={`Pending (${incoming.length + outgoing.length})`} styles={styles}>
            {incoming.map((row) => (
              <PendingRow
                key={row.id}
                profile={otherParty(row, selfUserId)}
                subtitle="Wants to be friends"
                styles={styles}
                colors={colors}
                actions={
                  <>
                    <Pressable style={styles.iconButtonAccept} onPress={() => handleAccept(row.id)}>
                      <Ionicons name="checkmark" size={16} color={colors.onSuccess} />
                    </Pressable>
                    <Pressable style={styles.iconButtonDecline} onPress={() => handleRemove(row.id)}>
                      <Ionicons name="close" size={16} color={colors.textPrimary} />
                    </Pressable>
                  </>
                }
              />
            ))}
            {outgoing.map((row) => (
              <PendingRow
                key={row.id}
                profile={otherParty(row, selfUserId)}
                subtitle="Request sent"
                styles={styles}
                colors={colors}
                actions={
                  <Pressable style={styles.iconButtonDecline} onPress={() => handleRemove(row.id)}>
                    <Ionicons name="close" size={16} color={colors.textPrimary} />
                  </Pressable>
                }
              />
            ))}
          </Section>
        )}

        {active.length > 0 && (
          <Section title={`Active Friends (${active.length})`} styles={styles}>
            {active.map(({ profile, location }) => (
              <ActiveFriendCard
                key={profile.id}
                profile={profile}
                location={location}
                lines={lines}
                now={now}
                styles={styles}
                colors={colors}
                onRemove={() => removeFriend(profile)}
                selfPosition={selfPosition}
                onShowOnMap={() => showFriendOnMap(profile.id)}
              />
            ))}
          </Section>
        )}

        {inactive.length > 0 && (
          <Section title={`Inactive (${inactive.length})`} styles={styles} tone="muted">
            {inactive.map(({ profile, location, status }) => (
              <InactiveFriendRow
                key={profile.id}
                profile={profile}
                location={location}
                status={status}
                now={now}
                styles={styles}
                colors={colors}
                onRemove={() => removeFriend(profile)}
              />
            ))}
          </Section>
        )}
      </ScrollView>

      {profile && (
        <InviteSheet
          visible={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          publicUid={profile.public_uid}
          displayName={profile.display_name}
        />
      )}
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
  styles,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof createStyles>;
  tone?: 'muted';
}) {
  return (
    <Animated.View
      style={styles.section}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <Text style={[styles.sectionLabel, tone === 'muted' && styles.sectionLabelMuted]}>{title}</Text>
      {children}
    </Animated.View>
  );
}

function PendingRow({
  profile,
  subtitle,
  actions,
  styles,
  colors,
}: {
  profile: Profile;
  subtitle: string;
  actions: React.ReactNode;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  return (
    <Animated.View
      style={styles.pendingCard}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <Avatar label={profile.display_name ?? profile.email} imageUrl={profile.avatar_url} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{profile.display_name ?? profile.email}</Text>
        <Text style={styles.cardSubtext}>{subtitle}</Text>
      </View>
      <View style={styles.pendingActions}>{actions}</View>
    </Animated.View>
  );
}

function lineFor(lineId: string | undefined, lines: RawLines) {
  if (!lineId) return null;
  const line = lines[lineId];
  return line ? { name: line.name, color: line.color } : null;
}

function formatRelativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
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

function FriendMenuButton({
  onRemove,
  accessibilityLabel,
  colors,
  styles,
}: {
  onRemove: () => void;
  accessibilityLabel: string;
  colors: ColorTokens;
  styles: ReturnType<typeof createStyles>;
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const buttonRef = useRef<View>(null);

  const handleOpen = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      const windowWidth = Dimensions.get('window').width;
      setPos({
        top: y + height + 4,
        right: Math.max(16, windowWidth - (x + width)),
      });
      setVisible(true);
    });
  };

  return (
    <>
      <View ref={buttonRef} collapsable={false}>
        <Pressable
          hitSlop={8}
          style={styles.menuButton}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Modal transparent visible={visible} animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVisible(false)}>
          <View style={[styles.popoverMenu, { top: pos.top, right: pos.right }]}>
            <Pressable
              style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
              onPress={() => {
                setVisible(false);
                onRemove();
              }}
            >
              <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
              <Text style={styles.popoverItemText}>Remove friend</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function ActiveFriendCard({
  profile,
  location,
  lines,
  now,
  styles,
  colors,
  onRemove,
  onShowOnMap,
  selfPosition,
}: {
  profile: Profile;
  location: FriendLocation | null;
  lines: RawLines;
  now: number;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
  onRemove: () => void;
  onShowOnMap: () => void;
  selfPosition: { lat: number; lon: number } | null;
}) {
  const nearest: NearestStation | null = useMemo(
    () => (location ? findNearestStation(location.lat, location.lon) : null),
    [location],
  );
  // Only attribute a "current line" when the nearest station is actually
  // close -- otherwise (friend isn't near the metro at all) the closest
  // entry in the station list is meaningless and just confusing to show.
  const isNearStation = !!nearest && nearest.distanceMeters <= NEARBY_LINE_MAX_METERS;

  // Which line, inferred from the direction they're actually travelling
  // rather than whichever line happens to sit first in the station's list --
  // at a three-line interchange that was a coin flip.
  const inferredLineId = useMemo(() => {
    if (!isNearStation || !nearest || !location) return null;
    const movement = location.previous
      ? {
          fromLat: location.previous.lat,
          fromLon: location.previous.lon,
          toLat: location.lat,
          toLon: location.lon,
        }
      : null;
    return inferCurrentLine(nearest, movement);
  }, [isNearStation, nearest, location]);

  const line = inferredLineId ? lineFor(inferredLineId, lines) : null;
  const accentColor = line?.color ?? colors.outline;

  const eta = useMemo(() => {
    if (!location || !selfPosition) return null;
    return estimateFriendEta(
      selfPosition.lat,
      selfPosition.lon,
      location.lat,
      location.lon,
    );
  }, [location, selfPosition]);

  const subtext = !location
    ? 'Waiting for location…'
    : nearest
      ? `${formatDistance(nearest.distanceMeters)} from ${nearest.name} · updated ${formatRelativeTime(location.receivedAt, now)}`
      : `Updated ${formatRelativeTime(location.receivedAt, now)}`;

  return (
    <Animated.View
      style={[styles.activeCard, { borderLeftColor: accentColor }]}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <View style={styles.activeCardHeader}>
        <Avatar label={profile.display_name ?? profile.email} imageUrl={profile.avatar_url} size={36} />
        <Text style={[styles.cardName, styles.cardNameInRow]} numberOfLines={2}>
          {profile.display_name ?? profile.email}
        </Text>
        <FriendMenuButton
          onRemove={onRemove}
          accessibilityLabel={`Options for ${profile.display_name ?? profile.email}`}
          colors={colors}
          styles={styles}
        />
      </View>

      <View style={styles.activeCardMetaRow}>
        <View style={styles.liveDot} />
        <Text style={styles.liveLabel}>LIVE</Text>
        {line && (
          <View style={styles.lineBadge}>
            <Ionicons name="train" size={11} color={colors.textPrimary} />
            <Text style={styles.lineBadgeText} numberOfLines={1}>
              {line.name.toUpperCase()}
            </Text>
          </View>
        )}
        {/* How far away they are in metro terms -- the question the app is
            actually for, and more useful than a straight-line distance. */}
        {eta && (
          <View style={styles.etaBadge}>
            <Ionicons name="walk" size={11} color={colors.accent} />
            <Text style={styles.etaBadgeText} numberOfLines={1}>
              {eta.stops === 0 ? 'SAME STATION' : `${eta.stops} STOPS · ${eta.minutes} MIN`}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.cardSubtext}>{subtext}</Text>

      {/* Only offered once we actually hold a position -- otherwise there is
          nowhere for the map to fly to and the tap would do nothing. */}
      {location && (
        <Pressable
          style={({ pressed }) => [styles.showOnMapButton, pressed && styles.showOnMapPressed]}
          onPress={onShowOnMap}
          accessibilityRole="button"
          accessibilityLabel={`Show ${profile.display_name ?? profile.email} on the map`}
        >
          <Ionicons name="map-outline" size={13} color={colors.accent} />
          <Text style={styles.showOnMapText}>Show on map</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

function InactiveFriendRow({
  profile,
  location,
  status,
  now,
  styles,
  colors,
  onRemove,
}: {
  profile: Profile;
  location: FriendLocation | null;
  status: FriendStatus;
  now: number;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
  onRemove: () => void;
}) {
  const subtext =
    status === 'online'
      ? 'Online · not sharing location'
      : location
        ? `Last active ${formatRelativeTime(location.receivedAt, now)}`
        : 'Offline';

  return (
    <Animated.View
      style={styles.inactiveRow}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <View style={styles.inactiveRowMain}>
        <Avatar label={profile.display_name ?? profile.email} imageUrl={profile.avatar_url} size={32} />
        <Text style={[styles.cardName, styles.cardNameInRow]} numberOfLines={1}>
          {profile.display_name ?? profile.email}
        </Text>
        <FriendMenuButton
          onRemove={onRemove}
          accessibilityLabel={`Options for ${profile.display_name ?? profile.email}`}
          colors={colors}
          styles={styles}
        />
      </View>
      <Text style={styles.inactiveSubtext} numberOfLines={1}>
        {subtext}
      </Text>
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  radiusBadge: number,
  typography: Record<string, TypeStyle>,
  shared: ReturnType<typeof useSharedStyles>,
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    scrollContent: {
      padding: 20,
      gap: 20,
    },
    title: {
      ...typography.headlineLg,
      fontSize: 26,
      color: colors.textPrimary,
    },
    addRow: {
      flexDirection: 'row',
      gap: 8,
    },
    addInputWrapper: {
      flex: 1,
      justifyContent: 'center',
    },
    addInput: {
      ...shared.textInput,
      fontSize: 14,
      height: 44,
      paddingVertical: 0,
      paddingRight: 32,
      textAlignVertical: 'center',
    },
    clearButton: {
      position: 'absolute',
      right: 10,
    },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: radiusNone,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      marginTop: -12,
    },
    inviteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: -12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 13,
    },
    inviteButtonPressed: {
      opacity: 0.7,
    },
    inviteButtonText: {
      ...typography.labelCaps,
      color: colors.textPrimary,
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 32,
      paddingHorizontal: 24,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      backgroundColor: colors.surfaceContainerLow,
    },
    emptyTitle: {
      ...typography.headlineMd,
      fontSize: 16,
      color: colors.textPrimary,
    },
    emptyNote: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    section: {
      gap: 8,
    },
    sectionLabel: {
      ...typography.labelCaps,
      color: colors.textSecondary,
    },
    sectionLabelMuted: {
      color: colors.textSecondary,
      opacity: 0.7,
    },

    // Pending
    pendingCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 12,
      marginBottom: 8,
    },
    cardInfo: {
      flex: 1,
      gap: 2,
    },
    cardName: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    cardNameInRow: {
      flex: 1,
      // Without this RN's default (auto) minWidth stops the text from ever
      // shrinking below its content size, which is what let a long line
      // badge push the name -- and the 3-dot button after it -- off-screen.
      minWidth: 0,
    },
    cardSubtext: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    pendingActions: {
      flexDirection: 'row',
      gap: 8,
    },
    iconButtonAccept: {
      width: 30,
      height: 30,
      borderRadius: radiusNone,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonDecline: {
      width: 30,
      height: 30,
      borderRadius: radiusNone,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Active friends
    activeCard: {
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      borderRadius: radiusNone,
      padding: 12,
      gap: 6,
      marginBottom: 10,
    },
    activeCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    activeCardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    showOnMapButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 5,
      marginTop: 2,
      paddingVertical: 4,
    },
    showOnMapPressed: {
      opacity: 0.6,
    },
    showOnMapText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.accent,
    },
    liveLabel: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.success,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.15)',
    },
    popoverMenu: {
      position: 'absolute',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusBadge,
      paddingVertical: 4,
      paddingHorizontal: 4,
      minWidth: 150,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    popoverItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radiusBadge,
    },
    popoverItemPressed: {
      backgroundColor: colors.surfaceContainerHighest,
    },
    popoverItemText: {
      ...typography.bodyMd,
      fontSize: 13,
      fontWeight: '600',
      color: colors.danger,
    },
    lineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      flexShrink: 1,
      maxWidth: 140,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radiusBadge,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    etaBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      flexShrink: 1,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radiusBadge,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    etaBadgeText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.accent,
      flexShrink: 1,
    },
    lineBadgeText: {
      ...typography.labelCaps,
      fontSize: 10,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    menuButton: {
      flexShrink: 0,
    },

    // Inactive friends
    inactiveRow: {
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      opacity: 0.75,
      gap: 4,
    },
    inactiveRowMain: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    inactiveSubtext: {
      ...typography.dataSm,
      color: colors.textSecondary,
      paddingLeft: 42,
    },
  });
}
