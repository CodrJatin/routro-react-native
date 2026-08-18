import { AppState, PermissionsAndroid, Platform, type AppStateStatus } from 'react-native';
// MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts
import { isMockFriendId } from '../dev/mockFriend';
import { getStation } from '../engine/graph';
import type { StationId } from '../engine/types';
import { ensureAlertChannel, presentAlert } from '../journey/alertNotifications';
import { areMeetAlertsEnabled } from '../journey/notificationPrefs';
import { useSelfPositionStore } from '../location/selfPosition';
import { meetChannelManager } from '../realtime/meetChannel';
import {
  MEET_REQUEST_COOLDOWN_MS,
  MEET_REQUEST_TTL_MS,
  newMeetRequestId,
  type MeetMessage,
  type MeetRequestMessage,
} from '../realtime/meetMessage';
import { useLocationStore } from '../realtime/locationStore';
import { readSelfRoute } from '../route/useSelfRoute';
import {
  meetCooldownRemainingMs,
  sweepMeetState,
  useMeetStore,
  type IncomingMeetRequest,
} from './meetStore';
import { secondsToStation, secondsToStationFromPosition } from './meetTiming';

/**
 * How late an acceptance may arrive and still be honoured.
 *
 * The two countdowns run on two devices and start at slightly different
 * moments -- the receiver's when the request lands, the sender's when it was
 * sent -- so an answer tapped in the last second of one can reach the other
 * just after it gave up. Dropping it there would leave the accepter waiting at
 * a station for someone who never agreed to come, which is by far the worst
 * outcome this feature has available. Better to be a couple of seconds
 * generous on the asking side.
 */
const ACCEPT_GRACE_MS = 10_000;

export type SendMeetResult = { ok: true } | { ok: false; reason: string };

/**
 * When each friend's last request was *shown* to this user.
 *
 * The sender enforces the once-a-minute rule before it sends; this enforces it
 * again on arrival. The sender's copy protects the user from themselves, this
 * one protects them from a friend running a broken or modified build -- which
 * is the only way a phone gets buzzed repeatedly, and so the one worth
 * defending against. Module state rather than store state: it is about
 * incoming traffic, not about anything the UI shows.
 */
let lastShownAt = new Map<string, number>();
let appStateSubscription: { remove: () => void } | null = null;
/** Asked at most once per launch -- see `ensureNotificationPermission`. */
let hasAskedForNotifications = false;

/**
 * Wires the meet channel into the store and the notification tray.
 *
 * Call once per signed-in session, from the same place the channels
 * themselves are managed.
 */
export function initMeetController(): void {
  meetChannelManager.setHandlers({
    onMessage: (friendId, message) => handleMessage(friendId, message),
    // Mirrored into the store rather than read back off the manager, so the
    // Meet button re-renders when a channel joins or fails. See `reachable`.
    onReachabilityChange: (friendId, canReach) =>
      useMeetStore.getState().setReachable(friendId, canReach),
  });

  // React Native stops running JS timers in the background, so the one-second
  // sweep in meetStore simply doesn't happen while the app is away. Anything
  // that expired in the meantime has to be cleared on the way back in, or the
  // user returns to a request card counting down from a number that is
  // already in the past.
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') sweepMeetState();
  });

  // Created up front rather than at the first alert: Android only honours a
  // channel's importance at creation, and a meet request landing on a
  // default-importance channel is one that doesn't make a sound -- for a
  // message with thirty seconds to live.
  void ensureAlertChannel();
  void useMeetStore.getState().hydrate();
}

/**
 * Asks for notification permission, at the point the user first does something
 * that expects an answer to come back as one.
 *
 * Deliberately not at launch. Android 13+ needs POST_NOTIFICATIONS before
 * anything can be posted, and this app's rule everywhere else is that a
 * permission dialog follows a tap rather than preceding one -- prompting on
 * mount asks someone who may never touch the feature, and Android denies
 * permanently after the second refusal, so an unasked-for prompt spends a
 * decision the user never chose to make.
 *
 * The cost of that choice: someone who has never sent or accepted a request
 * gets the in-app card without the notification. Starting a journey asks too
 * (see journeyController), so in practice most users have already answered.
 */
async function ensureNotificationPermission(): Promise<void> {
  if (hasAskedForNotifications) return;
  hasAskedForNotifications = true;
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch (error) {
    console.warn('[meet] notification permission request failed', error);
  }
}

/** Unmounting the authenticated tree. */
export function teardownMeetController(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  clearMeetState();
}

/** Sign-out. Nothing about who was meeting whom belongs to the next session,
 * on disk or in memory. */
export function clearMeetState(): void {
  lastShownAt = new Map();
  useMeetStore.getState().reset();
}

/** One friend went away -- unfriended, or removed on another device. */
export function forgetMeetsWith(friendUserId: string): void {
  lastShownAt.delete(friendUserId);
  useMeetStore.getState().forgetFriend(friendUserId);
}

// --- sending ---------------------------------------------------------------

/**
 * Asks a friend to meet at a station.
 *
 * Quotes this user's own arrival at that station from the best source
 * available -- their journey if they have one, their position if not -- and
 * sends the journey and position along with it, so the other side can time
 * them even though this user may not be sharing their location at all.
 */
export async function sendMeetRequest(
  friendUserId: string,
  stationId: StationId,
): Promise<SendMeetResult> {
  const remaining = meetCooldownRemainingMs(friendUserId);
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    return {
      ok: false,
      reason: `You can ask again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
    };
  }

  // Their answer comes back as a notification, so this is the moment to have
  // the permission for one.
  void ensureNotificationPermission();

  const now = Date.now();
  const selfRoute = readSelfRoute();
  const position = useSelfPositionStore.getState().position;

  const etaSeconds =
    secondsToStation(selfRoute?.route ?? null, selfRoute?.clock ?? null, stationId, now) ??
    secondsToStationFromPosition(position, stationId);

  const request: MeetRequestMessage = {
    kind: 'request',
    id: newMeetRequestId(),
    stationId,
    etaSeconds,
    // Sent whether or not this user is broadcasting: presence only carries a
    // journey while sharing is on, and asking to meet is not sharing your
    // location. This tells them where you are headed for this one purpose and
    // nothing more.
    journey: selfRoute
      ? {
          originId: selfRoute.route.originStationId,
          destinationId: selfRoute.route.destinationStationId,
          mode: selfRoute.route.mode,
          startedAt: now,
        }
      : null,
    position,
  };

  // Recorded before the send so a spammed button cannot get two requests out
  // while the first is still in flight.
  useMeetStore.getState().markRequestSent(friendUserId, now);

  // MOCK FRIEND -- the fixture has no channel, so nothing can be delivered to
  // it; the dev panel answers on its behalf instead. Delete with
  // src/dev/mockFriend.ts.
  const delivered = isMockFriendId(friendUserId)
    ? true
    : await meetChannelManager.send(friendUserId, request);

  useMeetStore.getState().setOutgoing({
    id: request.id,
    toUserId: friendUserId,
    stationId,
    sentAt: now,
    expiresAt: now + MEET_REQUEST_TTL_MS,
    outcome: delivered ? 'pending' : 'undelivered',
    settledAt: delivered ? null : Date.now(),
  });

  if (!delivered) {
    // Rolled back: the cooldown exists to stop a friend's phone being buzzed
    // repeatedly, and nothing reached them to buzz it. Making someone wait a
    // minute to retry a request that never left the device would be punishing
    // them for a dropped connection.
    useMeetStore.getState().markRequestSent(friendUserId, now - MEET_REQUEST_COOLDOWN_MS);
    return {
      ok: false,
      reason: "Couldn't reach them just now. Check your connection and try again.",
    };
  }
  return { ok: true };
}

/** Withdraws a request before it has been answered. */
export async function cancelMeetRequest(friendUserId: string): Promise<void> {
  const outgoing = useMeetStore.getState().outgoing[friendUserId];
  useMeetStore.getState().dropOutgoing(friendUserId);
  if (!outgoing || outgoing.outcome !== 'pending') return;
  await meetChannelManager.send(friendUserId, {
    kind: 'cancel',
    id: outgoing.id,
    stationId: outgoing.stationId,
    etaSeconds: null,
  });
}

// --- answering -------------------------------------------------------------

/**
 * Accepts a request: tells the other side, and records the meet on this one.
 *
 * The reply carries this user's own seconds-to-station so both phones can show
 * the same wait -- without it the asker would know when they themselves get
 * there and nothing about who is waiting for whom.
 */
export async function acceptMeetRequest(requestId: string): Promise<SendMeetResult> {
  const request = useMeetStore.getState().incoming[requestId];
  if (!request) return { ok: false, reason: 'That request has already expired.' };

  // Someone who answers a request is someone who will want the next one to
  // reach them.
  void ensureNotificationPermission();

  const now = Date.now();
  const selfRoute = readSelfRoute();
  const etaSeconds =
    secondsToStation(selfRoute?.route ?? null, selfRoute?.clock ?? null, request.stationId, now) ??
    secondsToStationFromPosition(useSelfPositionStore.getState().position, request.stationId);

  // MOCK FRIEND -- nothing to deliver to. Delete with src/dev/mockFriend.ts.
  const delivered = isMockFriendId(request.fromUserId)
    ? true
    : await meetChannelManager.send(request.fromUserId, {
        kind: 'accept',
        id: request.id,
        stationId: request.stationId,
        etaSeconds,
      });

  if (!delivered) {
    // Deliberately does NOT record the meet. A meet only one side knows about
    // sends someone to a platform to wait for a friend who was never told.
    return { ok: false, reason: "Couldn't reach them to say yes. Try again." };
  }

  useMeetStore.getState().setMeet({
    friendUserId: request.fromUserId,
    requestId: request.id,
    stationId: request.stationId,
    agreedAt: now,
    // Re-based from when the quote arrived to now, so the countdown doesn't
    // silently restart at whatever it was thirty seconds ago.
    theirEtaSeconds:
      request.etaSeconds === null
        ? null
        : Math.max(0, request.etaSeconds - (now - request.receivedAt) / 1000),
  });
  useMeetStore.getState().dropIncoming(requestId);
  return { ok: true };
}

export async function declineMeetRequest(requestId: string): Promise<void> {
  const request = useMeetStore.getState().incoming[requestId];
  useMeetStore.getState().dropIncoming(requestId);
  if (!request) return;
  // MOCK FRIEND -- delete with src/dev/mockFriend.ts.
  if (isMockFriendId(request.fromUserId)) return;
  await meetChannelManager.send(request.fromUserId, {
    kind: 'decline',
    id: request.id,
    stationId: request.stationId,
    etaSeconds: null,
  });
}

/**
 * Either side calling the meet off after it was agreed.
 *
 * Tells the other phone as well as this one. A meet that quietly disappears
 * from one itinerary and stays on the other is how somebody ends up standing
 * on a platform for a friend who has already left -- the same failure
 * `acceptMeetRequest` refuses to record a one-sided meet to avoid.
 */
export function cancelMeet(friendUserId: string): void {
  const meet = useMeetStore.getState().meets[friendUserId];
  useMeetStore.getState().clearMeet(friendUserId);
  if (!meet) return;
  // MOCK FRIEND -- delete with src/dev/mockFriend.ts.
  if (isMockFriendId(friendUserId)) return;
  void meetChannelManager.send(friendUserId, {
    kind: 'cancel',
    id: meet.requestId,
    stationId: meet.stationId,
    etaSeconds: null,
  });
}

// --- receiving -------------------------------------------------------------

/**
 * MOCK FRIEND -- temporary dev fixture, delete with src/dev/mockFriend.ts.
 *
 * The fixture's way in. Deliberately the same entry point the channel uses, so
 * a faked request runs the real cooldown guard, the real notification and the
 * real store writes rather than a parallel path that could quietly diverge
 * from the one that ships.
 */
export function deliverMockMeetMessage(friendId: string, message: MeetMessage): void {
  if (!__DEV__) return;
  handleMessage(friendId, message);
}

function handleMessage(friendId: string, message: MeetMessage): void {
  switch (message.kind) {
    case 'request':
      return handleRequest(friendId, message);
    case 'cancel':
      return handleCancel(friendId, message.id);
    case 'accept':
      return handleAccept(friendId, message.id, message.etaSeconds);
    case 'decline':
      return handleDecline(friendId, message.id);
  }
}

function handleRequest(friendId: string, message: MeetRequestMessage): void {
  const now = Date.now();

  const last = lastShownAt.get(friendId);
  if (last !== undefined && now - last < MEET_REQUEST_COOLDOWN_MS) {
    console.warn(`[meet] ignoring a second request from ${friendId} inside the cooldown`);
    return;
  }
  lastShownAt.set(friendId, now);

  const request: IncomingMeetRequest = {
    id: message.id,
    fromUserId: friendId,
    stationId: message.stationId,
    receivedAt: now,
    expiresAt: now + MEET_REQUEST_TTL_MS,
    etaSeconds: message.etaSeconds,
    journey: message.journey,
    position: message.position,
  };
  useMeetStore.getState().addIncoming(request);

  const station = getStation(message.stationId);
  void notify(
    `${friendLabel(friendId)} wants to meet`,
    station ? `At ${station.name} — answer within 30 seconds.` : 'Answer within 30 seconds.',
  );
}

/** They withdrew the request before it was answered, or called off a meet
 * already agreed. One message covers both because from this side they are the
 * same event: whatever we were holding about that request is off. */
function handleCancel(friendId: string, requestId: string): void {
  const held = useMeetStore.getState().incoming[requestId];
  if (held && held.fromUserId === friendId) {
    useMeetStore.getState().dropIncoming(requestId);
    return;
  }

  const meet = useMeetStore.getState().meets[friendId];
  if (!meet || meet.requestId !== requestId) return;
  useMeetStore.getState().clearMeet(friendId);

  // Worth interrupting for, unlike a withdrawn request: the user had agreed to
  // this one and may be on their way to it.
  const station = getStation(meet.stationId);
  void notify(
    `${friendLabel(friendId)} called off the meet`,
    station ? `You are no longer meeting at ${station.name}.` : 'The meet is off.',
  );
}

function handleAccept(
  friendId: string,
  requestId: string,
  etaSeconds: number | null,
): void {
  const outgoing = useMeetStore.getState().outgoing[friendId];
  // No record of asking them: either this is a reply to a request from a
  // previous launch, or it isn't ours. Either way there is nothing to agree to.
  if (!outgoing || outgoing.id !== requestId) return;
  if (outgoing.outcome !== 'pending') {
    const settledAt = outgoing.settledAt ?? 0;
    // See ACCEPT_GRACE_MS -- a yes that lost a race with our own countdown is
    // still a yes.
    if (outgoing.outcome !== 'expired' || Date.now() - settledAt > ACCEPT_GRACE_MS) return;
  }

  // The station comes from the request WE sent, never from the reply. The
  // reply carries one so it can be read on its own, but taking it on trust
  // would let a client on another build -- or a hostile one -- agree to a
  // meeting somewhere the user never proposed, and put it on their itinerary.
  const { stationId } = outgoing;

  useMeetStore.getState().settleOutgoing(friendId, requestId, 'accepted');
  useMeetStore.getState().setMeet({
    friendUserId: friendId,
    requestId,
    stationId,
    agreedAt: Date.now(),
    theirEtaSeconds: etaSeconds,
  });

  const station = getStation(stationId);
  void notify(
    `${friendLabel(friendId)} is meeting you`,
    station ? `At ${station.name}. Your route now shows the wait.` : 'They accepted.',
  );
}

function handleDecline(friendId: string, requestId: string): void {
  const outgoing = useMeetStore.getState().outgoing[friendId];
  // Checked before saying anything: an unmatched reply is one we have already
  // forgotten, and "they can't meet" out of nowhere -- naming a station the
  // user never asked about -- is worse than silence.
  if (!outgoing || outgoing.id !== requestId || outgoing.outcome !== 'pending') return;

  useMeetStore.getState().settleOutgoing(friendId, requestId, 'declined');
  const station = getStation(outgoing.stationId);
  void notify(
    `${friendLabel(friendId)} can't meet`,
    station ? `Not at ${station.name} this time.` : 'They declined.',
  );
}

async function notify(title: string, body: string): Promise<void> {
  if (!areMeetAlertsEnabled()) return;
  await presentAlert({ title, body });
}

/**
 * A friend's display name, or a neutral fallback.
 *
 * Same reasoning as `friendAlerts.ts`: this can run with nothing mounted, and
 * "A friend wants to meet" is a better notification than one that never fires
 * because the friendships list hadn't loaded.
 */
function friendLabel(userId: string): string {
  return useLocationStore.getState().friendNames[userId] ?? 'A friend';
}
