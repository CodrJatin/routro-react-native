import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { INVITE_PATH } from './inviteLink';

const STORAGE_KEY = 'metrosync.pendingInvite';

/** Parks an invite that was opened while signed out.
 *
 * Sign-in is a round trip out to Google and back, and the whole navigation
 * state is rebuilt when the auth guard in app/_layout.tsx flips -- so the
 * invite screen the link opened is gone by the time there's a session to act
 * on. Without this the most common case of the feature (someone who doesn't
 * have an account yet taps a friend's link) ends on the map with no clue why
 * the app opened. Persisted rather than held in memory because the OAuth trip
 * can take the process down with it on a low-memory Android device. */
export async function savePendingInvite(publicUid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, publicUid);
  } catch (error) {
    // Losing the parked invite costs the user one manual ID paste, which is
    // not worth failing the sign-in redirect over.
    console.warn('[friends] failed to park pending invite:', error);
  }
}

/** Reads and clears in one step -- an invite is consumed the first time it is
 * resumed, so a later launch doesn't reopen a request the user already
 * answered (or deliberately backed out of). */
async function takePendingInvite(): Promise<string | null> {
  try {
    const publicUid = await AsyncStorage.getItem(STORAGE_KEY);
    if (publicUid) await AsyncStorage.removeItem(STORAGE_KEY);
    return publicUid;
  } catch {
    return null;
  }
}

/** Reopens a parked invite once there's a session to send the request with.
 * Called from the tab layout, which only mounts behind the auth guard. */
export function usePendingInviteResume(isSignedIn: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;

    void takePendingInvite().then((publicUid) => {
      if (cancelled || !publicUid) return;
      router.push(`/${INVITE_PATH}/${publicUid}`);
    });

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, router]);
}
