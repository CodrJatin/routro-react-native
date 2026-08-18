import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The background token refresh. Every case here is one that only happens with
 * the app in a pocket for a long time, which is precisely why none of them is
 * reachable by hand on a device.
 */

interface RefreshOutcome {
  data: { session: { expires_at: number } | null };
  error: { message: string } | null;
}

let refreshCalls = 0;
let nextOutcome: RefreshOutcome = { data: { session: null }, error: null };
let refreshShouldThrow = false;
/** Lets a test hold a refresh open, to exercise the in-flight guard. */
let refreshGate: Promise<void> | null = null;

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      async refreshSession(): Promise<RefreshOutcome> {
        refreshCalls += 1;
        if (refreshGate) {
          const gate = refreshGate;
          refreshGate = null;
          await gate;
        }
        if (refreshShouldThrow) throw new Error('network down');
        return nextOutcome;
      },
    },
  },
}));

const { refreshSessionIfDue, setSessionExpiry } = await import('../sessionRefresh');

const MINUTE = 60_000;

/** An `expires_at` (seconds, as Supabase sends it) that many minutes out. */
function expiringInMinutes(minutes: number): number {
  return Math.round((Date.now() + minutes * MINUTE) / 1000);
}

beforeEach(async () => {
  // Drain anything a previous test left running before resetting counters, so
  // a leaked in-flight refresh can't be mistaken for this test's.
  refreshGate = null;
  await refreshSessionIfDue();
  refreshCalls = 0;
  refreshShouldThrow = false;
  nextOutcome = { data: { session: { expires_at: expiringInMinutes(60) } }, error: null };
  setSessionExpiry(null);
  vi.useRealTimers();
});

describe('refreshSessionIfDue', () => {
  it('does nothing while the token is comfortably fresh', async () => {
    setSessionExpiry(expiringInMinutes(55));
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(0);
  });

  it('does nothing when signed out, however overdue the last token was', async () => {
    setSessionExpiry(expiringInMinutes(-30));
    setSessionExpiry(null);
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(0);
  });

  it('refreshes once the token is inside the margin', async () => {
    setSessionExpiry(expiringInMinutes(5));
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);
  });

  it('refreshes a token that has already expired', async () => {
    setSessionExpiry(expiringInMinutes(-1));
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);
  });

  it('adopts the new expiry, so the tick stops asking', async () => {
    setSessionExpiry(expiringInMinutes(5));
    nextOutcome = { data: { session: { expires_at: expiringInMinutes(60) } }, error: null };
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);

    // The next few ticks must be free. This is the whole reason the new expiry
    // is recorded from the response rather than waiting on a React render --
    // which is the one thing that cannot be relied on in the background.
    await refreshSessionIfDue();
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);
  });

  it('collapses overlapping ticks into one attempt', async () => {
    setSessionExpiry(expiringInMinutes(5));
    let release = () => {};
    refreshGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The tick fires every 5s; a refresh on a bad connection takes longer than
    // that, so several land on top of one in flight.
    const first = refreshSessionIfDue();
    const second = refreshSessionIfDue();
    const third = refreshSessionIfDue();
    release();
    await Promise.all([first, second, third]);

    expect(refreshCalls).toBe(1);
  });

  it('backs off after a failure rather than retrying every tick', async () => {
    setSessionExpiry(expiringInMinutes(5));
    nextOutcome = { data: { session: null }, error: { message: 'offline' } };
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);

    // A tunnel produces one of these every 5 seconds for as long as it lasts.
    await refreshSessionIfDue();
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);
  });

  it('treats a thrown refresh the same as a failed one', async () => {
    setSessionExpiry(expiringInMinutes(5));
    refreshShouldThrow = true;
    await expect(refreshSessionIfDue()).resolves.toBeUndefined();
    expect(refreshCalls).toBe(1);

    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);
  });

  it('tries again immediately once a new session arrives after a failure', async () => {
    setSessionExpiry(expiringInMinutes(5));
    nextOutcome = { data: { session: null }, error: { message: 'offline' } };
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(1);

    // A sign-in on another path, or the foreground refresher winning the race.
    // Whatever the last failure was, it was about the token this replaces.
    nextOutcome = { data: { session: { expires_at: expiringInMinutes(60) } }, error: null };
    setSessionExpiry(expiringInMinutes(5));
    await refreshSessionIfDue();
    expect(refreshCalls).toBe(2);
  });
});
