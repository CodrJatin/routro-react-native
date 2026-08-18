import { beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory stand-ins for the two native stores. Declared before the
 * vi.mock factories run, hence the `var`-less hoisting dance via getters. */
const secureStoreData = new Map<string, string>();
const asyncStorageData = new Map<string, string>();

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** Every SecureStore read, so the concurrency claims below are measured
 * rather than asserted. */
let reads: string[] = [];
/** Lets a test hold chosen reads open. `applies` is what makes the
 * concurrency test meaningful: gating only the chunk reads means a sequential
 * implementation stalls after issuing one, while a concurrent one has issued
 * them all. */
let gate: { promise: Promise<void>; applies: (key: string) => boolean } | null = null;

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async (key: string) => {
    reads.push(key);
    if (gate?.applies(key)) await gate.promise;
    return secureStoreData.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    // The real SecureStore refuses values over ~2KB -- enforce it here so a
    // regression in chunk sizing fails the test instead of passing silently.
    if (Buffer.byteLength(value, 'utf8') > 2048) {
      throw new Error(`value too large for SecureStore: ${value.length} chars`);
    }
    secureStoreData.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureStoreData.delete(key);
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => asyncStorageData.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorageData.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorageData.delete(key);
    },
  },
}));

const { secureStorage } = await import('../secureStorage');

const AUTH_KEY = 'sb-wwvczkqtadcwwmmcitgr-auth-token';
const COUNT_KEY_SUFFIX = '.n';

/** Lets every already-queued promise callback run, so a test can inspect what
 * has been issued without letting the gated calls resolve. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
/** Roughly the shape and size of a real Supabase session: two JWTs plus a
 * serialized user, comfortably past SecureStore's single-value limit. */
const SESSION = JSON.stringify({
  access_token: 'a'.repeat(900),
  refresh_token: 'r'.repeat(900),
  user: { id: '00000000-0000-0000-0000-000000000000', email: 'rider@example.com' },
});

describe('secureStorage', () => {
  beforeEach(() => {
    secureStoreData.clear();
    asyncStorageData.clear();
    reads = [];
    gate = null;
  });

  it('round-trips a value far larger than SecureStore\'s per-value limit', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    expect(await secureStorage.getItem(AUTH_KEY)).toBe(SESSION);
    // Must actually have been split, or the test proves nothing.
    expect(secureStoreData.size).toBeGreaterThan(2);
  });

  it('round-trips multi-byte characters without splitting them', async () => {
    const value = JSON.stringify({ name: '日本語テスト'.repeat(200), emoji: '🚇'.repeat(200) });
    await secureStorage.setItem(AUTH_KEY, value);
    expect(await secureStorage.getItem(AUTH_KEY)).toBe(value);
  });

  it('migrates a pre-existing AsyncStorage session and clears the plaintext copy', async () => {
    asyncStorageData.set(AUTH_KEY, SESSION);

    expect(await secureStorage.getItem(AUTH_KEY)).toBe(SESSION);
    // Migrated across...
    expect(await secureStorage.getItem(AUTH_KEY)).toBe(SESSION);
    // ...and the plaintext original is gone.
    expect(asyncStorageData.has(AUTH_KEY)).toBe(false);
  });

  it('does not leave trailing chunks behind when a value shrinks', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    const short = JSON.stringify({ access_token: 'short' });
    await secureStorage.setItem(AUTH_KEY, short);

    expect(await secureStorage.getItem(AUTH_KEY)).toBe(short);
  });

  it('reports no session rather than a truncated one when a chunk is lost', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    secureStoreData.delete(`${AUTH_KEY}.1`);

    expect(await secureStorage.getItem(AUTH_KEY)).toBeNull();
    // The corrupt remains are cleared out too.
    expect(await secureStorage.getItem(AUTH_KEY)).toBeNull();
  });


  it('reads every chunk of a value concurrently, not one after another', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    const chunkCount = Number(secureStoreData.get(`${AUTH_KEY}.n`));
    expect(chunkCount).toBeGreaterThan(2);
    reads = [];

    // Only the chunks are held. The count read runs freely, so the read gets
    // as far as issuing chunk reads and then stops there with them pending.
    let release = () => {};
    gate = {
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
      applies: (key) => !key.endsWith(COUNT_KEY_SUFFIX),
    };

    const pending = secureStorage.getItem(AUTH_KEY);
    await flushMicrotasks();

    // The point of the test: with the chunks still blocked, every one of them
    // has already been asked for. Reading them in series would show the count
    // plus exactly one chunk here.
    expect(reads).toHaveLength(chunkCount + 1);
    expect(reads[0]).toBe(`${AUTH_KEY}${COUNT_KEY_SUFFIX}`);

    release();
    gate = null;
    expect(await pending).toBe(SESSION);
  });

  it('shares one trip to the keystore between simultaneous readers', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    reads = [];

    // This is the real pattern: several PostgREST calls and realtime.setAuth
    // all reaching getSession() as a screen loads.
    const [a, b, c] = await Promise.all([
      secureStorage.getItem(AUTH_KEY),
      secureStorage.getItem(AUTH_KEY),
      secureStorage.getItem(AUTH_KEY),
    ]);

    expect([a, b, c]).toEqual([SESSION, SESSION, SESSION]);
    // One read of the count, not three -- so one whole traversal, not three.
    expect(reads.filter((k) => k === `${AUTH_KEY}.n`)).toHaveLength(1);
  });

  it('does not remember a value between reads, so corruption is still caught', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    expect(await secureStorage.getItem(AUTH_KEY)).toBe(SESSION);

    // Out-of-band, exactly as a partial wipe would be -- no setItem involved.
    // A value cache would keep serving the session that is no longer stored.
    secureStoreData.delete(`${AUTH_KEY}.2`);
    expect(await secureStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it('does not let a later reader join a read the write has already superseded', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    const short = JSON.stringify({ access_token: 'short' });

    let release = () => {};
    gate = {
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
      applies: () => true,
    };
    const stale = secureStorage.getItem(AUTH_KEY);
    await flushMicrotasks();

    gate = null;
    await secureStorage.setItem(AUTH_KEY, short);
    // Started after the write landed, so it must see the new value however
    // the in-flight read above resolves.
    expect(await secureStorage.getItem(AUTH_KEY)).toBe(short);

    release();
    await stale.catch(() => null);
  });

  it('clears every chunk on removal', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    await secureStorage.removeItem(AUTH_KEY);

    expect(await secureStorage.getItem(AUTH_KEY)).toBeNull();
    expect(secureStoreData.size).toBe(0);
  });
});
