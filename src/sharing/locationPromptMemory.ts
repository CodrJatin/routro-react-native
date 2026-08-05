import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'routro.locationPromptSpent';

/**
 * Whether the app has already opened the system location dialog on its own
 * initiative, rather than because someone tapped something.
 *
 * Android stops showing that dialog after the second refusal and resolves
 * every later request instantly as denied, so it is a resource with about two
 * uses in it. Automatic sharing is allowed to spend exactly one, once. After
 * that it checks silently and stays off if the answer is no, leaving the map's
 * own sharing button as the way back -- a prompt the user actually asked for,
 * at a moment they can see what it is for.
 *
 * Persisted, unlike Ghost Mode: "we have already asked" is precisely the fact
 * that has to survive a restart, or every cold start would ask again.
 */
let cached: boolean | null = null;

export async function hasSpentLocationPrompt(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
  } catch {
    // Unreadable. Assume spent: the cost of being wrong that way is one tap on
    // a button the user can see, and the cost of being wrong the other way is
    // a permission dialog on every launch.
    cached = true;
  }
  return cached;
}

export function markLocationPromptSpent(): void {
  cached = true;
  AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {
    // Best-effort. The in-memory value holds for this process, which is the
    // one that would otherwise ask twice.
  });
}
