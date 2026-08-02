import { describe, expect, it } from 'vitest';
import {
  meetTopicFor,
  newMeetRequestId,
  parseMeetMessage,
  type MeetRequestMessage,
} from '../meetMessage';

const A = '00000000-0000-0000-0000-00000000000a';
const B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function request(overrides: Partial<MeetRequestMessage> = {}): Record<string, unknown> {
  return {
    kind: 'request',
    id: 'abc123',
    stationId: 'rajiv-chowk',
    etaSeconds: 420,
    journey: {
      originId: 'rithala',
      destinationId: 'botanical-garden',
      mode: 'fastest',
      startedAt: 1_700_000_000_000,
    },
    position: { lat: 28.6, lon: 77.2 },
    ...overrides,
  };
}

describe('meetTopicFor', () => {
  it('names the same topic whichever side asks', () => {
    expect(meetTopicFor(A, B)).toBe(meetTopicFor(B, A));
  });

  it('sorts the pair into the name', () => {
    expect(meetTopicFor(B, A)).toBe(`meet:${A}:${B}`);
  });
});

describe('newMeetRequestId', () => {
  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMeetRequestId()));
    expect(ids.size).toBe(200);
  });
});

describe('parseMeetMessage', () => {
  it('accepts a well-formed request', () => {
    const parsed = parseMeetMessage(request());
    expect(parsed).toMatchObject({
      kind: 'request',
      id: 'abc123',
      stationId: 'rajiv-chowk',
      etaSeconds: 420,
      position: { lat: 28.6, lon: 77.2 },
    });
    expect(parsed && 'journey' in parsed && parsed.journey?.destinationId).toBe(
      'botanical-garden',
    );
  });

  it('accepts the three replies', () => {
    for (const kind of ['accept', 'decline', 'cancel'] as const) {
      expect(
        parseMeetMessage({ kind, id: 'abc123', stationId: 'rajiv-chowk', etaSeconds: 60 }),
      ).toEqual({ kind, id: 'abc123', stationId: 'rajiv-chowk', etaSeconds: 60 });
    }
  });

  it('rejects anything that is not a message', () => {
    expect(parseMeetMessage(null)).toBeNull();
    expect(parseMeetMessage('request')).toBeNull();
    expect(parseMeetMessage({})).toBeNull();
    expect(parseMeetMessage(request({ kind: 'invite' } as never))).toBeNull();
  });

  it('rejects a station this build has never heard of', () => {
    // Otherwise it would be held in the store and rediscovered as a blank card
    // by every surface that tries to name it.
    expect(parseMeetMessage(request({ stationId: 'not-a-station' }))).toBeNull();
  });

  it('rejects an unusable id', () => {
    expect(parseMeetMessage(request({ id: '' }))).toBeNull();
    expect(parseMeetMessage(request({ id: 'x'.repeat(65) }))).toBeNull();
    expect(parseMeetMessage(request({ id: 12 } as never))).toBeNull();
  });

  it('drops a nonsense ETA rather than the whole message', () => {
    // An unusable duration is recoverable -- the receiver falls back to the
    // journey, or to saying it cannot tell.
    for (const etaSeconds of [-1, Number.NaN, 60 * 60 * 5, 'soon']) {
      const parsed = parseMeetMessage(request({ etaSeconds } as never));
      expect(parsed?.etaSeconds).toBeNull();
    }
  });

  it('drops a malformed journey or position rather than the whole message', () => {
    const parsed = parseMeetMessage(
      request({ journey: { originId: 'rithala' }, position: { lat: 99, lon: 77.2 } } as never),
    );
    expect(parsed).not.toBeNull();
    expect(parsed && 'journey' in parsed && parsed.journey).toBeNull();
    expect(parsed && 'position' in parsed && parsed.position).toBeNull();
  });
});
