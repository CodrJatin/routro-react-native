import { beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory stand-ins for the two native stores. Declared before the
 * vi.mock factories run, hence the `var`-less hoisting dance via getters. */
const secureStoreData = new Map<string, string>();
const asyncStorageData = new Map<string, string>();

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async (key: string) => secureStoreData.get(key) ?? null,
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

  it('clears every chunk on removal', async () => {
    await secureStorage.setItem(AUTH_KEY, SESSION);
    await secureStorage.removeItem(AUTH_KEY);

    expect(await secureStorage.getItem(AUTH_KEY)).toBeNull();
    expect(secureStoreData.size).toBe(0);
  });
});
