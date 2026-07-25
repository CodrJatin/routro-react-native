import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage adapter for the Supabase auth client backed by expo-secure-store
 * (Keychain on iOS, EncryptedSharedPreferences/KeyStore on Android) instead
 * of AsyncStorage, which keeps refresh tokens in plaintext on disk.
 *
 * Two constraints shape this:
 *
 *  1. SecureStore rejects values over ~2 KB, and a Supabase session (access
 *     JWT + refresh token + serialized user) is comfortably larger. Values
 *     are therefore split across numbered chunk keys, with the chunk count
 *     written last so a half-finished write is never mistaken for a
 *     complete one.
 *  2. SecureStore keys accept only alphanumerics, '.', '-' and '_'.
 *
 * Chunking is by character, not byte, at a size small enough that even
 * all-4-byte UTF-8 content stays under the limit -- splitting a UTF-8 byte
 * sequence mid-character would corrupt the value.
 */
const MAX_CHUNK_CHARS = 400;
const COUNT_SUFFIX = '.n';

function baseKeyFor(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** SecureStore has no web implementation, and is unavailable on some
 * Android devices with no usable keystore -- fall back rather than throwing
 * the user into a permanently signed-out state. */
let secureStoreAvailable: Promise<boolean> | null = null;
function isSecureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(false);
  if (!secureStoreAvailable) {
    secureStoreAvailable = SecureStore.isAvailableAsync().catch(() => false);
  }
  return secureStoreAvailable;
}

async function removeChunks(base: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${base}${COUNT_SUFFIX}`);
  const count = countRaw ? Number.parseInt(countRaw, 10) : 0;
  // Delete the count first: without it the chunks are already unreadable, so
  // an interrupted delete can never surface a partial value.
  await SecureStore.deleteItemAsync(`${base}${COUNT_SUFFIX}`);
  if (Number.isFinite(count)) {
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(`${base}.${i}`);
    }
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!(await isSecureStoreAvailable())) return AsyncStorage.getItem(key);

    const base = baseKeyFor(key);
    const countRaw = await SecureStore.getItemAsync(`${base}${COUNT_SUFFIX}`);

    if (countRaw === null) {
      // Nothing in SecureStore yet. Existing installs have their session in
      // AsyncStorage from before this change -- migrate it across on first
      // read instead of signing everyone out on upgrade.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy === null) return null;
      await this.setItem(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    }

    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count < 0) return null;

    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${base}.${i}`);
      // A missing chunk means the stored value is corrupt (interrupted
      // write, partial wipe). Clear it and report "no session" rather than
      // handing Supabase a truncated JSON blob it will throw on.
      if (part === null) {
        await removeChunks(base);
        return null;
      }
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await isSecureStoreAvailable())) return AsyncStorage.setItem(key, value);

    const base = baseKeyFor(key);
    // Clear first so a shorter new value can't leave a longer old value's
    // trailing chunks behind to be reassembled later.
    await removeChunks(base);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += MAX_CHUNK_CHARS) {
      chunks.push(value.slice(i, i + MAX_CHUNK_CHARS));
    }

    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${base}.${i}`, chunks[i]);
    }
    // Written last: the count is what makes the value readable, so it only
    // appears once every chunk is safely stored.
    await SecureStore.setItemAsync(`${base}${COUNT_SUFFIX}`, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    if (!(await isSecureStoreAvailable())) return AsyncStorage.removeItem(key);
    await removeChunks(baseKeyFor(key));
    // Also clear any pre-migration copy, so signing out doesn't leave a
    // stale plaintext session behind in AsyncStorage.
    await AsyncStorage.removeItem(key);
  },
};
