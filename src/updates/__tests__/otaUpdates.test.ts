import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * When an over-the-air update is fetched, and -- the part worth testing -- when
 * it is allowed to restart the app. Every rule here exists to keep a reload out
 * of a moment where it would cost the user something.
 */

let isEnabled = true;
let updateAvailable = true;
let checks = 0;
let fetches = 0;
let reloads = 0;
let checkShouldThrow = false;
/** Lets a test hold a check open, to exercise the in-flight guard. */
let checkGate: Promise<void> | null = null;

vi.mock('expo-updates', () => ({
  get isEnabled() {
    return isEnabled;
  },
  checkForUpdateAsync: async () => {
    checks += 1;
    if (checkGate) {
      const gate = checkGate;
      checkGate = null;
      await gate;
    }
    if (checkShouldThrow) throw new Error('offline');
    return { isAvailable: updateAvailable };
  },
  fetchUpdateAsync: async () => {
    fetches += 1;
    return { isNew: true };
  },
  reloadAsync: async () => {
    reloads += 1;
  },
}));

let session: unknown = null;

vi.mock('../../journey/journeyStore', () => ({
  useJourneyStore: {
    getState: () => ({ session }),
  },
}));

const { syncUpdateOnForeground, resetOtaState, APPLY_AFTER_AWAY_MS } = await import(
  '../otaUpdates'
);

/** Long enough away that a restart reads as opening the app fresh. */
const LONG_ABSENCE = APPLY_AFTER_AWAY_MS + 1000;
/** A glance at another app and straight back. */
const BRIEF_ABSENCE = 5000;

beforeEach(() => {
  resetOtaState();
  isEnabled = true;
  updateAvailable = true;
  checks = 0;
  fetches = 0;
  reloads = 0;
  checkShouldThrow = false;
  checkGate = null;
  session = null;
});

describe('syncUpdateOnForeground', () => {
  it('fetches and applies an update after a long absence', async () => {
    await syncUpdateOnForeground(LONG_ABSENCE, false);
    expect([checks, fetches, reloads]).toEqual([1, 1, 1]);
  });

  it('fetches but does not restart the app after a brief absence', async () => {
    await syncUpdateOnForeground(BRIEF_ABSENCE, false);
    // Downloaded and waiting: expo-updates applies it at the next launch
    // anyway, so there is nothing to gain by interrupting someone who has been
    // gone five seconds.
    expect([checks, fetches]).toEqual([1, 1]);
    expect(reloads).toBe(0);
  });

  it('never restarts the app during a tracked journey', async () => {
    session = { originId: 'a', destinationId: 'b', mode: 'fastest', startedAt: 1 };
    await syncUpdateOnForeground(LONG_ABSENCE, true);
    // Not even a check: a journey spends most of its life backgrounded, so the
    // absence rule would otherwise call this the perfect moment.
    expect([checks, fetches, reloads]).toEqual([0, 0, 0]);
  });

  it('applies an update the launch-time check had already downloaded', async () => {
    await syncUpdateOnForeground(LONG_ABSENCE, true);
    // Nothing to ask the server: it is already on the device.
    expect([checks, fetches]).toEqual([0, 0]);
    expect(reloads).toBe(1);
  });

  it('does nothing when the server has nothing newer', async () => {
    updateAvailable = false;
    await syncUpdateOnForeground(LONG_ABSENCE, false);
    expect(checks).toBe(1);
    expect([fetches, reloads]).toEqual([0, 0]);
  });

  it('applies on a later return what an earlier one downloaded', async () => {
    await syncUpdateOnForeground(BRIEF_ABSENCE, false);
    expect([fetches, reloads]).toEqual([1, 0]);

    // The caller still reports isPending false -- it is React state and may not
    // have caught up. The session flag is what carries the knowledge across.
    await syncUpdateOnForeground(LONG_ABSENCE, false);
    expect(checks).toBe(1);
    expect(fetches).toBe(1);
    expect(reloads).toBe(1);
  });

  it('stays quiet when updates are disabled for this build', async () => {
    isEnabled = false;
    await syncUpdateOnForeground(LONG_ABSENCE, true);
    expect([checks, fetches, reloads]).toEqual([0, 0, 0]);
  });

  it('swallows a failed check rather than surfacing it', async () => {
    checkShouldThrow = true;
    await expect(syncUpdateOnForeground(LONG_ABSENCE, false)).resolves.toBeUndefined();
    expect([fetches, reloads]).toEqual([0, 0]);

    // And is willing to try again next time -- being offline is not a verdict.
    checkShouldThrow = false;
    await syncUpdateOnForeground(LONG_ABSENCE, false);
    expect(reloads).toBe(1);
  });

  it('collapses overlapping foreground events into one attempt', async () => {
    let release = () => {};
    checkGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = syncUpdateOnForeground(LONG_ABSENCE, false);
    const second = syncUpdateOnForeground(LONG_ABSENCE, false);
    release();
    await Promise.all([first, second]);

    expect(checks).toBe(1);
    expect(reloads).toBe(1);
  });
});
