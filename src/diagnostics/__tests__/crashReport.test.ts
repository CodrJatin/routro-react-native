import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Crash capture and upload. The rules worth pinning are the ones about not
 * making a bad moment worse: never throw while recording a crash, never lose a
 * report that failed to upload, and never write anything unredacted to disk.
 */

const storage = new Map<string, string>();
let storageShouldThrow = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (storageShouldThrow) throw new Error('disk full');
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
}));

let inserted: Record<string, unknown>[] = [];
let insertError: { message: string } | null = null;

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: insertError };
      },
    }),
  },
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0' } } }));
vi.mock('expo-updates', () => ({
  runtimeVersion: 'fingerprint-abc',
  updateId: 'ffffffff-1111-2222-3333-444444444444',
  isEmbeddedLaunch: false,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 34 } }));

const { persistCrash, uploadPendingCrash } = await import('../crashReport');
const { recordLog, clearLogEntries } = await import('../logBuffer');

const PENDING_KEY = 'routro.pendingCrash';
const USER = '99999999-1111-2222-3333-444444444444';

/** Lets the un-awaited disk write inside persistCrash settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  storage.clear();
  storageShouldThrow = false;
  inserted = [];
  insertError = null;
  clearLogEntries();
});

describe('persistCrash', () => {
  it('writes a report that survives the process', async () => {
    persistCrash(new TypeError('cannot read property of undefined'), { isFatal: true });
    await flush();

    const pending = JSON.parse(storage.get(PENDING_KEY)!);
    expect(pending.message).toBe('TypeError: cannot read property of undefined');
    expect(pending.isFatal).toBe(true);
    expect(pending.platform).toBe('android 34');
  });

  it('carries the log lines leading up to the crash', async () => {
    recordLog('warn', ['[location] connection lost, retry 1 in 3000ms']);
    persistCrash(new Error('boom'), { isFatal: false });
    await flush();

    expect(JSON.parse(storage.get(PENDING_KEY)!).logs).toContain('connection lost');
  });

  it('redacts before anything reaches the disk, not on the way out', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.abcdefghijklmnop';
    recordLog('error', [`refresh failed with ${jwt}`]);
    persistCrash(new Error(`token ${jwt} rejected for aaaaaaaa-1111-2222-3333-444444444444`), {
      isFatal: false,
    });
    await flush();

    const written = storage.get(PENDING_KEY)!;
    expect(written).not.toContain(jwt);
    expect(written).not.toContain('aaaaaaaa-1111-2222-3333-444444444444');
    expect(written).toContain('[token]');
    expect(written).toContain('aaaaaaaa…');
  });

  it('keeps only the most recent report, so a crash loop cannot fill storage', async () => {
    persistCrash(new Error('first'), { isFatal: true });
    await flush();
    persistCrash(new Error('second'), { isFatal: true });
    await flush();

    expect(storage.size).toBe(1);
    expect(JSON.parse(storage.get(PENDING_KEY)!).message).toBe('Error: second');
  });

  it('never throws, even when the disk write fails', async () => {
    storageShouldThrow = true;
    expect(() => persistCrash(new Error('boom'), { isFatal: true })).not.toThrow();
    await flush();
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it('handles a thrown non-Error without losing the report', async () => {
    persistCrash('a bare string was thrown', { isFatal: true });
    await flush();
    expect(JSON.parse(storage.get(PENDING_KEY)!).message).toBe('a bare string was thrown');
  });
});

describe('uploadPendingCrash', () => {
  it('does nothing when there is no report', async () => {
    await uploadPendingCrash(USER);
    expect(inserted).toHaveLength(0);
  });

  it('uploads the report and clears it locally', async () => {
    persistCrash(new Error('boom'), { isFatal: true });
    await flush();

    await uploadPendingCrash(USER);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      user_id: USER,
      is_fatal: true,
      message: 'Error: boom',
      app_version: '1.0.0',
      runtime_version: 'fingerprint-abc',
    });
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it('keeps the report when the upload fails, so the next launch retries', async () => {
    persistCrash(new Error('boom'), { isFatal: true });
    await flush();
    insertError = { message: 'network request failed' };

    await uploadPendingCrash(USER);

    expect(inserted).toHaveLength(1);
    // Still on disk: an offline launch must not lose the report.
    expect(storage.has(PENDING_KEY)).toBe(true);

    insertError = null;
    await uploadPendingCrash(USER);
    expect(inserted).toHaveLength(2);
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it('drops an unparseable report rather than retrying it forever', async () => {
    storage.set(PENDING_KEY, '{ truncated by the crash it was recor');

    await uploadPendingCrash(USER);

    expect(inserted).toHaveLength(0);
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it('sends null rather than an empty string when there were no logs', async () => {
    persistCrash(new Error('crashed during start-up'), { isFatal: true });
    await flush();

    await uploadPendingCrash(USER);
    expect(inserted[0].logs).toBeNull();
  });
});
