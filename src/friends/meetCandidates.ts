import type { StationId } from '../engine/types';
import { routeClockMs } from '../route/routeClock';
import { formatClockTime, formatMinutes } from './meetFormat';
import { findMeetingStations, remainingStations, type MeetingSide } from './meetingStations';
import { NEGLIGIBLE_WAIT_MS } from './meetTiming';

/** Where the options came from, so the picker can explain a one-sided list
 * rather than just showing a shorter one. */
export type MeetCandidateSource =
  /** Both journeys call there -- neither of you goes out of your way. */
  | 'shared'
  /** Only they have a route, so these are stops on theirs. */
  | 'theirs'
  /** Only you have one, so these are stops on yours. */
  | 'yours';

export interface MeetCandidate {
  stationId: StationId;
  stationName: string;
  /** One line of context: how far each of you is, and who ends up waiting. */
  detail: string;
  source: MeetCandidateSource;
}

/**
 * The stations worth offering as a meeting point, in the order the user would
 * reach them.
 *
 * The good case is the intersection of the two journeys -- somewhere both are
 * already going, so meeting costs neither of them a detour. When only one side
 * has a route the list falls back to that side's remaining stops, which is
 * still a real answer: someone at home can perfectly well go and meet a friend
 * at a station on the friend's line, and a friend who isn't travelling can
 * come and meet the user on theirs.
 *
 * Empty when neither has a route, which the picker says out loud rather than
 * showing an empty control.
 */
export function buildMeetCandidates(input: {
  self: MeetingSide | null;
  friend: MeetingSide | null;
  friendName: string;
}): MeetCandidate[] {
  const { self, friend, friendName } = input;

  if (self && friend) {
    const shared = findMeetingStations(self, friend);
    if (shared.length > 0) {
      return shared.map((option) => ({
        stationId: option.stationId,
        stationName: option.stationName,
        source: 'shared' as const,
        detail: [
          option.selfStopsAway === 0
            ? "you're there"
            : `${option.selfStopsAway} ${option.selfStopsAway === 1 ? 'stop' : 'stops'} for you`,
          option.friendStopsAway === 0
            ? `${friendName} is there`
            : `${option.friendStopsAway} for ${friendName}`,
          describeWait(option.waitMs, option.whoWaits, friendName),
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
      }));
    }
    // Two routes that never touch. Rather than nothing at all, offer the
    // friend's stops -- going to meet them where they already are is the
    // ordinary thing to do when your paths don't cross.
  }

  if (friend) {
    return remainingStations(friend).map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      source: 'theirs' as const,
      detail: friend.clock
        ? `${friendName} gets there ${formatClockTime(routeClockMs(friend.clock, station.offsetSeconds))}`
        : `On ${friendName}'s route`,
    }));
  }

  if (self) {
    return remainingStations(self).map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      source: 'yours' as const,
      detail: self.clock
        ? `You get there ${formatClockTime(routeClockMs(self.clock, station.offsetSeconds))}`
        : 'On your route',
    }));
  }

  return [];
}

/** Silent when the two arrivals are close enough that naming a wait would be
 * inventing precision -- the same threshold the request card uses. */
function describeWait(
  waitMs: number | null,
  whoWaits: 'self' | 'friend' | null,
  friendName: string,
): string | null {
  if (waitMs === null) return null;
  if (whoWaits === null || waitMs < NEGLIGIBLE_WAIT_MS) return 'you arrive together';
  return whoWaits === 'self'
    ? `you wait ${formatMinutes(waitMs)}`
    : `${friendName} waits ${formatMinutes(waitMs)}`;
}
