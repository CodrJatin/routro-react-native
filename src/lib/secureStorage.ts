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
 *
 * Why this is on a hot path at all: auth-js reads the session through this
 * adapter on *every* `getSession()`, and that sits under every PostgREST
 * request, every `realtime.setAuth`, and every auto-refresh tick. A screen
 * that fires a few queries at once was doing that many full chunked reads of
 * the same bytes. Hence the two measures below -- parallel chunks, and
 * coalescing concurrent readers -- neither of which changes what a read
 * returns.
 */
const MAX_CHUNK_CHARS = 400;
const COUNT_SUFFIX = '.n';

/**
 * Reads currently in flight, so simultaneous callers share one trip to the
 * keystore instead of each starting their own.
 *
 * Deliberately NOT a cache of values. The obvious optimisation here is to
 * remember what was last read and skip the keystore entirely, and it is wrong:
 * it assumes this process is the only writer, which is exactly false in the
 * case the integrity check below exists for. A partial wipe or an interrupted
 * write removes chunks without going through `setItem`, and a value cache
 * would keep serving a session that is no longer on disk -- defeating the
 * corruption check rather than passing it. (The test suite says so out loud;
 * `reports no session rather than a truncated one when a chunk is lost` fails
 * against a value cache.)
 *
 * Coalescing has no such premise. An entry lives only while a read is
 * actually happening and is dropped the moment it settles, so every caller
 * still gets a value that was genuinely on disk just now -- they simply share
 * the trip that was already being made.
 */
const inFlightReads = new Map<string, Promise<string | null>>();

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
  // an interrupted delete can never surface a partial value. That one ordering
  // is load-bearing; the chunk deletes behind it are independent of each
  // other, so they go together.
  await SecureStore.deleteItemAsync(`${base}${COUNT_SUFFIX}`);
  if (!Number.isFinite(count)) return;
  await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${base}.${i}`)),
  );
}

/** The actual read, always going to storage. */
async function readValue(key: string): Promise<string | null> {
  if (!(await isSecureStoreAvailable())) return AsyncStorage.getItem(key);

  const base = baseKeyFor(key);
  const countRaw = await SecureStore.getItemAsync(`${base}${COUNT_SUFFIX}`);

  if (countRaw === null) {
    // Nothing in SecureStore yet. Existing installs have their session in
    // AsyncStorage from before this change -- migrate it across on first
    // read instead of signing everyone out on upgrade.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    await secureStorage.setItem(key, legacy);
    await AsyncStorage.removeItem(key);
    return legacy;
  }

  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count < 0) return null;

  // In parallel. These are independent keys and the count above has already
  // said how many there are, so sequencing them only ever bought a longer
  // wait -- one native round trip per ~400 characters of session, in series,
  // on a path that runs constantly.
  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${base}.${i}`)),
  );

  // A missing chunk means the stored value is corrupt (interrupted write,
  // partial wipe). Clear it and report "no session" rather than handing
  // Supabase a truncated JSON blob it will throw on.
  if (parts.some((part) => part === null)) {
    await removeChunks(base);
    return null;
  }
  return parts.join('');
}

export const secureStorage = {
  getItem(key: string): Promise<string | null> {
    const existing = inFlightReads.get(key);
    if (existing) return existing;

    const read = readValue(key).finally(() => {
      // Guarded, so a write that superseded this read (see `setItem`) does not
      // have its fresh entry deleted by an older read settling afterwards.
      if (inFlightReads.get(key) === read) inFlightReads.delete(key);
    });
    inFlightReads.set(key, read);
    return read;
  },

  async setItem(key: string, value: string): Promise<void> {
    // Any read still in flight was started before this write and will answer
    // with the old value. That is inherent -- it did begin first -- but a
    // *later* caller must not be able to join it and receive something this
    // write has already replaced, so the entry is dropped here.
    inFlightReads.delete(key);

    if (!(await isSecureStoreAvailable())) return AsyncStorage.setItem(key, value);

    const base = baseKeyFor(key);
    // Clear first so a shorter new value can't leave a longer old value's
    // trailing chunks behind to be reassembled later.
    await removeChunks(base);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += MAX_CHUNK_CHARS) {
      chunks.push(value.slice(i, i + MAX_CHUNK_CHARS));
    }

    // Parallel, like the reads -- and note what stays sequential: the count
    // below still waits for every chunk. That ordering is the whole integrity
    // story of this file, and grouping the chunks does not weaken it, since
    // the value remains unreadable until the count lands either way.
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${base}.${i}`, chunk)));
    // Written last: the count is what makes the value readable, so it only
    // appears once every chunk is safely stored.
    await SecureStore.setItemAsync(`${base}${COUNT_SUFFIX}`, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    inFlightReads.delete(key);
    if (!(await isSecureStoreAvailable())) return AsyncStorage.removeItem(key);
    await removeChunks(baseKeyFor(key));
    // Also clear any pre-migration copy, so signing out doesn't leave a
    // stale plaintext session behind in AsyncStorage.
    await AsyncStorage.removeItem(key);
  },
};
