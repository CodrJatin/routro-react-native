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
import { AnimatedPressable } from '../../src/components/AnimatedPressable';
import { estimateFriendEta } from '../../src/friends/friendEta';
import { FriendMeetActions } from '../../src/friends/FriendMeetActions';
import { useFriendJourneys, type FriendJourneyView } from '../../src/friends/friendJourney';
import { MeetFriendSection } from '../../src/friends/MeetFriendSection';
import { useSelfRoute, type SelfRouteView } from '../../src/route/useSelfRoute';
import { findNearestStation, type NearestStation } from '../../src/friends/nearestStation';
import { otherParty } from '../../src/friends/useFriendships';
import { useSelfPositionStore } from '../../src/location/selfPosition';
import { useSeedSelfPosition } from '../../src/location/useSeedSelfPosition';
import { useFriendStatuses, useLocationStore, type FriendLocation, type FriendStatus } from '../../src/realtime/locationStore';
import { useGhostModeStore } from '../../src/sharing/ghostModeStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSharedStyles } from '../../src/theme/sharedStyles';
import type { ColorTokens, TypeStyle } from '../../src/theme/tokens';
import { AnimatedTextInput, useFocusAnimation } from '../../src/theme/useFocusAnimation';

/** Beyond this, the nearest station is no longer a meaningful "current line"
 * -- e.g. a friend who isn't near the metro at all. Roughly the outer edge
 * of typical inter-station spacing, so it doesn't hide legitimate matches. */
const NEARBY_LINE_MAX_METERS = 1500;

/** Orders each status ahead of the ones "less worth checking on" than it --
 * used to reorder friends within a section as their status changes, rather
 * than leaving them parked wherever the friendship row happened to sort. */
const STATUS_RANK: Record<FriendStatus, number> = { live: 0, stale: 1, online: 2, offline: 3 };

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
  const isGhost = useGhostModeStore((state) => state.isGhost);
  const setGhost = useGhostModeStore((state) => state.setGhost);

  // Journeys friends are advertising on presence, and the viewer's own route
  // to measure them against. Both resolved once here rather than per card, so
  // every row on this screen is answering against the same journeys -- and so
  // the route-progress pass behind each one happens once per fix rather than
  // once per friend per fix.
  const friendJourneys = useFriendJourneys();
  const selfRoute = useSelfRoute();

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
  const active: { profile: Profile; location: FriendLocation | null; status: FriendStatus }[] = [];
  const inactive: { profile: Profile; location: FriendLocation | null; status: FriendStatus }[] = [];
  for (const row of accepted) {
    const profile = otherParty(row, selfUserId);
    const location = friendLocations[profile.id] ?? null;
    const status = statuses[profile.id] ?? 'offline';
    if (status === 'live' || status === 'stale') {
      active.push({ profile, location, status });
    } else {
      inactive.push({ profile, location, status });
    }
  }

  // Reorder within each section as status changes, rather than leaving a
  // friend parked wherever their friendship row happened to sort -- a
  // friend actively sharing a journey, or freshly live, is the one worth
  // seeing first. `rows` stays sorted by created_at, so this only reorders
  // on top of that, it doesn't replace it.
  active.sort((a, b) => {
    const aJourney = friendJourneys[a.profile.id] ? 0 : 1;
    const bJourney = friendJourneys[b.profile.id] ? 0 : 1;
    if (aJourney !== bJourney) return aJourney - bJourney;
    return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  });
  inactive.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

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

        {/* Without this the list is just everyone marked Inactive, which is a
            lie the user told themselves and then forgot -- and "all my friends
            are offline" is exactly the wrong conclusion to draw from it. Sits
            above the list rather than replacing it: the friendships are still
            real and still manageable while hidden, it is only their live status
            that is unavailable. */}
        {isGhost && (
          <Pressable
            style={styles.ghostNotice}
            onPress={() => setGhost(false)}
            accessibilityRole="button"
            accessibilityLabel="Turn off Ghost Mode"
          >
            <Ionicons name="eye-off" size={15} color={colors.textPrimary} />
            <Text style={styles.ghostNoticeText}>
              Ghost Mode is on, so nobody's status is showing. Tap to turn it off.
            </Text>
          </Pressable>
        )}

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
              <AnimatedPressable
                style={styles.clearButton}
                onPress={clearHandle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear input"
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </AnimatedPressable>
            )}
          </View>
          <AnimatedPressable style={styles.addButton} onPress={handleSend} disabled={isSending}>
            {isSending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Ionicons name="person-add" size={18} color={colors.onPrimary} />
            )}
          </AnimatedPressable>
        </View>
        {sendError && <Text style={styles.errorText}>{sendError}</Text>}
        {actionError && <Text style={styles.errorText}>{actionError}</Text>}
        {listError && <Text style={styles.errorText}>{listError}</Text>}

        {/* The other direction: rather than needing their handle, hand them
            yours as a link or a code and let them come to you. Gated on the
            profile because the invite is built from its public_uid, which
            arrives a moment after the session does. */}
        {profile && (
          <AnimatedPressable
            style={styles.inviteButton}
            onPress={() => setIsInviteOpen(true)}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.inviteButtonText}>Invite by link or QR</Text>
          </AnimatedPressable>
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
                    <AnimatedPressable style={styles.iconButtonAccept} onPress={() => handleAccept(row.id)}>
                      <Ionicons name="checkmark" size={16} color={colors.onSuccess} />
                    </AnimatedPressable>
                    <AnimatedPressable style={styles.iconButtonDecline} onPress={() => handleRemove(row.id)}>
                      <Ionicons name="close" size={16} color={colors.textPrimary} />
                    </AnimatedPressable>
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
                  <AnimatedPressable style={styles.iconButtonDecline} onPress={() => handleRemove(row.id)}>
                    <Ionicons name="close" size={16} color={colors.textPrimary} />
                  </AnimatedPressable>
                }
              />
            ))}
          </Section>
        )}

        {active.length > 0 && (
          <Section title={`Active Friends (${active.length})`} styles={styles}>
            {active.map(({ profile, location, status }) => (
              <ActiveFriendCard
                key={profile.id}
                profile={profile}
                location={location}
                status={status}
                journey={friendJourneys[profile.id] ?? null}
                selfRoute={selfRoute}
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
                selfRoute={selfRoute}
                now={now}
                styles={styles}
                colors={colors}
                onRemove={() => removeFriend(profile)}
                onShowOnMap={() => showFriendOnMap(profile.id)}
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

/** What each status is called, and what it is worth in the eye. Live is the
 * only one that gets a colour: everything else is a shade of "not right now". */
const STATUS_PRESENTATION: Record<FriendStatus, { label: string; filled: boolean }> = {
  live: { label: 'LIVE', filled: true },
  stale: { label: 'STALE', filled: true },
  online: { label: 'ONLINE', filled: false },
  offline: { label: 'OFFLINE', filled: false },
};

/**
 * Whether a friend is reachable, said next to their name.
 *
 * On the name rather than off in a meta row: it is the first thing anyone
 * checks about a person on this screen, and the one that decides whether the
 * buttons underneath are worth pressing. Reads the same in both sections, so
 * "Active" and "Inactive" are groupings rather than the only way to tell.
 */
function FriendStatusBadge({
  status,
  styles,
  colors,
}: {
  status: FriendStatus;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
}) {
  const { label, filled } = STATUS_PRESENTATION[status];
  const tone =
    status === 'live' ? colors.success : status === 'stale' ? colors.accent : colors.textSecondary;

  return (
    <View style={styles.statusBadge}>
      <View
        style={[
          styles.statusDot,
          { borderColor: tone, backgroundColor: filled ? tone : 'transparent' },
        ]}
      />
      <Text style={[styles.statusLabel, { color: tone }]}>{label}</Text>
    </View>
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
        <AnimatedPressable
          hitSlop={8}
          style={styles.menuButton}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>

      <Modal transparent visible={visible} animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVisible(false)}>
          <View style={[styles.popoverMenu, { top: pos.top, right: pos.right }]}>
            <AnimatedPressable
              style={styles.popoverItem}
              onPress={() => {
                setVisible(false);
                onRemove();
              }}
            >
              <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
              <Text style={styles.popoverItemText}>Remove friend</Text>
            </AnimatedPressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function ActiveFriendCard({
  profile,
  location,
  status,
  journey,
  selfRoute,
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
  status: FriendStatus;
  /** The journey they're advertising, when they're on one. */
  journey: FriendJourneyView | null;
  /** The viewer's own route, for working out where the two of them could
   * meet. */
  selfRoute: SelfRouteView | null;
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

  // A shared journey answers outright what the bearing heuristic above can
  // only guess: the leg they are on names the line, with no interchange coin
  // flip and no need for them to have moved far enough to take a bearing from.
  // The inference stays as the fallback for a friend who is sharing a position
  // but not a journey.
  const line = lineFor(journey?.currentLineId ?? inferredLineId ?? undefined, lines);
  const accentColor = line?.color ?? colors.outline;

  // The station they're nearest to *on their own route*, which for someone
  // mid-journey is frequently not the nearest station on the network -- see
  // `findNearestRouteStation`. Falls back to the network-wide answer.
  const nearestLabel = journey?.progress
    ? journey.progress.sequence[journey.progress.nearestIndex].stationName
    : (nearest?.name ?? null);

  const eta = useMemo(() => {
    if (!location || !selfPosition) return null;
    return estimateFriendEta(
      selfPosition.lat,
      selfPosition.lon,
      location.lat,
      location.lon,
    );
  }, [location, selfPosition]);

  // Paired with `nearestLabel` so the distance always belongs to the station
  // being named, whichever of the two answers that came from.
  const nearestDistanceMeters = journey?.progress
    ? journey.progress.distanceMeters
    : (nearest?.distanceMeters ?? null);

  const subtext = !location
    ? 'Waiting for location…'
    : nearestLabel && nearestDistanceMeters !== null
      ? `${formatDistance(nearestDistanceMeters)} from ${nearestLabel} · updated ${formatRelativeTime(location.receivedAt, now)}`
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
        <View style={styles.nameBlock}>
          <Text style={[styles.cardName, styles.cardNameInRow]} numberOfLines={1}>
            {profile.display_name ?? profile.email}
          </Text>
          <FriendStatusBadge status={status} styles={styles} colors={colors} />
        </View>
        <FriendMenuButton
          onRemove={onRemove}
          accessibilityLabel={`Options for ${profile.display_name ?? profile.email}`}
          colors={colors}
          styles={styles}
        />
      </View>

      {/* The live dot that used to lead this row has moved up beside the name,
          where it belongs -- what is left here is what they are doing. */}
      <View style={styles.activeCardMetaRow}>
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

      {/* Where they're headed, which is the thing a live dot could never say.
          Only present when they're sharing a journey. */}
      {journey && (
        <View style={styles.destinationRow}>
          <Ionicons name="arrow-forward" size={12} color={colors.textSecondary} />
          <Text style={styles.destinationText} numberOfLines={1}>
            {journey.destination.name}
          </Text>
          {journey.remainingStops !== null && (
            <Text style={styles.destinationStops}>
              {journey.remainingStops === 0
                ? 'ARRIVED'
                : `${journey.remainingStops} ${journey.remainingStops === 1 ? 'STOP' : 'STOPS'} LEFT`}
            </Text>
          )}
        </View>
      )}

      <Text style={styles.cardSubtext}>{subtext}</Text>

      {/* A meet request from them, one this user sent them, or a meet the two
          have agreed -- whichever is live. Nothing at all in the ordinary
          case, which is most of the time. */}
      <MeetFriendSection friendUserId={profile.id} />

      <FriendMeetActions
        friendUserId={profile.id}
        friendName={profile.display_name?.trim() || 'your friend'}
        journey={journey}
        selfRoute={selfRoute}
        onShowOnMap={onShowOnMap}
        canShowOnMap={location !== null}
      />
    </Animated.View>
  );
}

function InactiveFriendRow({
  profile,
  location,
  status,
  selfRoute,
  now,
  styles,
  colors,
  onRemove,
  onShowOnMap,
}: {
  profile: Profile;
  location: FriendLocation | null;
  status: FriendStatus;
  selfRoute: SelfRouteView | null;
  now: number;
  styles: ReturnType<typeof createStyles>;
  colors: ColorTokens;
  onRemove: () => void;
  onShowOnMap: () => void;
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
        <View style={styles.nameBlock}>
          <Text style={[styles.cardName, styles.cardNameInRow]} numberOfLines={1}>
            {profile.display_name ?? profile.email}
          </Text>
          <FriendStatusBadge status={status} styles={styles} colors={colors} />
        </View>
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
      {/* Here too: a friend can stop sharing in the seconds between asking and
          you looking, and their request must not disappear with them. */}
      <MeetFriendSection friendUserId={profile.id} />

      {/* Online but not sharing is still someone you can arrange to meet --
          they just aren't on the map, so there is nothing to fly to. Offline
          gets nothing: the request would expire unseen. */}
      {status !== 'offline' && (
        <FriendMeetActions
          friendUserId={profile.id}
          friendName={profile.display_name?.trim() || 'your friend'}
          // Null by definition: presence drops a friend's journey the moment
          // they stop broadcasting, which is what puts them in this list.
          journey={null}
          selfRoute={selfRoute}
          onShowOnMap={onShowOnMap}
          // False by definition, matching the note above: nobody in this list
          // is drawn on the map. It used to be able to rely on `location` being
          // null here, because presence deleted it on the way into this list.
          // It no longer does (see `setFriendPresence`) -- the position is kept
          // so "last active" can be shown -- so this has to say so outright
          // rather than infer it, or it would offer to fly to a pin that
          // `FriendsLayer` deliberately isn't drawing.
          canShowOnMap={false}
        />
      )}
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
    ghostNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surface,
    },
    ghostNoticeText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
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
    // Name and status read as one thing. minWidth lets the name shrink so a
    // long one squeezes itself rather than pushing the badge off the card.
    nameBlock: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      borderWidth: 1,
    },
    statusLabel: {
      ...typography.labelCaps,
      fontSize: 9,
    },
    activeCardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    destinationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    destinationText: {
      ...typography.bodyMd,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
      flexShrink: 1,
    },
    destinationStops: {
      ...typography.labelCaps,
      fontSize: 9,
      color: colors.textSecondary,
      flexShrink: 0,
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
