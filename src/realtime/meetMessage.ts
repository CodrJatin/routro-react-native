import { getStation } from '../engine/graph';
import type { StationId } from '../engine/types';
import { parseSharedJourney, type SharedJourney } from './sharedJourney';

/** How long a request stands before it expires, in ms. Short on purpose: it
 * asks someone to change what they are doing in the next few minutes, and an
 * offer that is still sitting there ten minutes later is worse than no offer.
 *
 * Counted on each device from its OWN clock -- the sender from the moment it
 * sent, the receiver from the moment it arrived -- never from a timestamp on
 * the wire. Same rule as `FriendLocation.ts`: cross-device clocks are not
 * comparable, and here a phone set two minutes fast would either expire every
 * request instantly or hold it open forever. */
export const MEET_REQUEST_TTL_MS = 30_000;

/** The anti-spam rule: at most one request to the same friend per minute.
 * Enforced by the sender before it sends, and again by the receiver before it
 * shows anything, so a modified or broken client cannot buzz someone's phone
 * repeatedly. */
export const MEET_REQUEST_COOLDOWN_MS = 60_000;

/** Nothing on a metro network is four hours away, so anything past this is a
 * malformed or malicious payload rather than a long journey. */
const MAX_ETA_SECONDS = 4 * 60 * 60;

/** Every meet message rides one event on the pair channel. */
export const MEET_EVENT = 'meet';

/**
 * The private topic two friends share.
 *
 * Sorted, so both devices name it identically without either being "the
 * owner". The matching RLS policy accepts both orderings (see
 * supabase/migrations/0006_meet_requests.sql) rather than depending on
 * Postgres and JavaScript sorting two uuids the same way.
 */
export function meetTopicFor(userA: string, userB: string): string {
  return userA < userB ? `meet:${userA}:${userB}` : `meet:${userB}:${userA}`;
}

/** Ids only have to be unique between two people for thirty seconds, which
 * this clears by a wide margin without pulling in a uuid dependency. */
export function newMeetRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface MeetRequestMessage {
  kind: 'request';
  id: string;
  /** Where the sender is proposing to meet. Always a station both routes call
   * at -- the button only exists on stations the receiver passes through. */
  stationId: StationId;
  /**
   * How many seconds until the SENDER expects to be at that station, measured
   * on their device at the moment of sending.
   *
   * A duration rather than a timestamp, and that is the whole point: the
   * receiver anchors it to their own clock when it lands, so the two devices
   * never have to agree on what time it is. Null when the sender genuinely
   * cannot tell (no route, no fix, nowhere near the network).
   */
  etaSeconds: number | null;
  /**
   * The sender's journey, when they have one.
   *
   * Sent even though friends already receive journeys over presence: presence
   * only carries a journey while the sender is actively sharing their
   * location, and someone who isn't sharing can still ask to meet. This is
   * what lets the receiver name their destination and re-derive their arrival
   * for themselves rather than taking `etaSeconds` on faith.
   */
  journey: SharedJourney | null;
  /** Where the sender was when they asked, for the same reason -- it is what
   * `journey` is useless without, and the only anchor available at all when
   * there is no journey. */
  position: { lat: number; lon: number } | null;
}

export interface MeetReplyMessage {
  /** `cancel` is the sender withdrawing before the receiver answered. */
  kind: 'accept' | 'decline' | 'cancel';
  /** The request being answered. A reply naming a request the other side no
   * longer holds is dropped -- it expired in the meantime. */
  id: string;
  stationId: StationId;
  /** On `accept`, the accepter's own seconds-to-station, so the sender can
   * show the same wait the accepter is seeing. Null on the rest. */
  etaSeconds: number | null;
}

export type MeetMessage = MeetRequestMessage | MeetReplyMessage;

/**
 * Narrows an untrusted broadcast payload into a meet message, or null.
 *
 * The trust boundary for this channel, exactly as `parseLocPayload` is for
 * coordinates and `parseSharedJourney` for journeys. RLS guarantees only the
 * one friend on the other end of this topic can publish here, but a client on
 * a different build is enough to send something malformed -- and these ids
 * flow into `findRoute` and into a notification that interrupts someone.
 */
export function parseMeetMessage(value: unknown): MeetMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, id, stationId, etaSeconds } = value as Record<string, unknown>;

  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
  if (typeof stationId !== 'string') return null;
  // Checked here rather than left to a later `getStation` returning
  // undefined: a request naming a station this build has never heard of is not
  // something to hold in the store and rediscover as a blank card.
  if (!getStation(stationId)) return null;

  const eta = parseEtaSeconds(etaSeconds);

  if (kind === 'accept' || kind === 'decline' || kind === 'cancel') {
    return { kind, id, stationId, etaSeconds: eta };
  }

  if (kind !== 'request') return null;

  const { journey, position } = value as Record<string, unknown>;
  return {
    kind: 'request',
    id,
    stationId,
    etaSeconds: eta,
    journey: parseSharedJourney(journey),
    position: parsePosition(position),
  };
}

function parseEtaSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_ETA_SECONDS) return null;
  return value;
}

function parsePosition(value: unknown): { lat: number; lon: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { lat, lon } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
