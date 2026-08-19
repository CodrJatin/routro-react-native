import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { uploadPendingCrash } from '../diagnostics/crashReport';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { setSessionExpiry } from './sessionRefresh';

WebBrowser.maybeCompleteAuthSession();

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  public_uid: string;
  created_at: string;
}

interface AuthResult {
  error: string | null;
}

export interface ProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
}

interface AuthContextValue {
  isConfigured: boolean;
  isLoading: boolean;
  session: Session | null;
  profile: Profile | null;
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  updateProfile: (updates: ProfileUpdate) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** How long to wait before each profile re-read. Short, and finite -- see the
 * effect that uses it for why this one does give up where the realtime
 * reconnects deliberately do not. */
const PROFILE_RETRY_DELAYS_MS = [2000, 5000, 15_000];

/** The last OAuth redirect consumed by `completeAuthFromUrl`. Module scope, not
 * a ref: the point is that it outlives any one caller, and the whole process
 * only ever sees one redirect per sign-in. */
let lastHandledUrl: string | null = null;

/** Pulls the implicit-flow tokens out of an OAuth redirect URL and installs the
 * session. `handled` is false for unrelated deep links (share intents, etc). */
async function completeAuthFromUrl(url: string): Promise<{ handled: boolean; error: string | null }> {
  const params = new URLSearchParams(url.split('#')[1] ?? '');

  const errorDescription = params.get('error_description') ?? params.get('error');
  if (errorDescription) return { handled: true, error: errorDescription };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { handled: false, error: null };

  // On Android the same redirect arrives twice -- once as the intent the
  // deep-link listener sees, once as openAuthSessionAsync's return value -- and
  // both callers race into setSession with the same token pair. That produced
  // two SIGNED_IN events, and the profile read fired off the first one while
  // the second was still swapping the client's token underneath it. The second
  // call is also handing back a refresh token the first may already have
  // rotated away. Claiming the URL synchronously, before the first await,
  // is what makes this a guard rather than a wider window.
  if (url === lastHandledUrl) return { handled: true, error: null };
  lastHandledUrl = url;

  try {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { handled: true, error: error?.message ?? null };
  } catch (err) {
    // setSession can reject outright (network flake right after the OAuth
    // redirect), not just resolve with `error` set. Left unguarded, that
    // rejection had nothing downstream to catch it -- not signInWithGoogle's
    // caller, and not the error boundary, which only sees render-time throws.
    // The result was a screen that just went blank with no explanation.
    console.warn('[auth] setSession rejected', err);
    return { handled: true, error: 'Could not complete sign-in. Please try again.' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  /** Mirrors `profile` for the AppState listener below, which is registered
   * once and would otherwise close over the value as of that moment. Written
   * from an effect rather than during render: a render can be discarded and
   * replayed, and a ref written from one that never committed describes state
   * the app was never in. */
  const profileRef = useRef<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // getSession() races onAuthStateChange: an OAuth deep link can install a
    // session before the (slower) getSession call resolves, and its stale
    // result would then clobber the newer one. Once any auth event has
    // arrived, that is the source of truth.
    let hasAuthEvent = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!hasAuthEvent) setSession(data.session);
      })
      // Load-bearing, despite there being nothing to do about the error. This
      // read can genuinely reject -- a device whose keystore is unavailable,
      // a session left half-written across an interrupted chunked write (see
      // secureStorage.ts) -- and `isLoading` is what `RootNavigator` holds its
      // first paint on. Without this the app renders `null` forever: no
      // screen, no error, no sign-in button, and no way out but a reinstall.
      // Falling through with no session lands on the sign-in screen instead,
      // which is both honest and recoverable.
      .catch((error: unknown) => {
        console.warn('[auth] could not read the stored session', error);
      })
      .finally(() => {
        setIsLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hasAuthEvent = true;
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // A crash held over from a previous run, now that there is a session to
  // attribute it to. Keyed on the id so a token refresh does not re-run it;
  // the upload clears the local copy on success, so a repeat would be a no-op
  // anyway.
  useEffect(() => {
    const userId = session?.user.id;
    if (!isSupabaseConfigured || !userId) return;
    void uploadPendingCrash(userId);
  }, [session?.user?.id]);

  // The background half of token refresh. The foreground half is the effect
  // below; this hands the journey service's tick what it needs to cover the
  // stretch that one cannot -- see `sessionRefresh.ts`. Keyed on the expiry
  // rather than the session object, which is a fresh reference on every
  // refresh and would re-run this for nothing.
  useEffect(() => {
    setSessionExpiry(session?.expires_at);
  }, [session?.expires_at]);

  // Supabase refreshes the access token on a JS timer, which the OS suspends
  // along with the rest of the app while it's backgrounded -- so the
  // documented React Native setup ties the refresher to foreground rather
  // than leaving it to tick into a suspended runtime. It matters more here
  // than for plain API calls: the location channels are private and
  // JWT-gated, so returning to the app on an expired token doesn't present
  // as an auth problem at all, it presents as "live connection lost" over an
  // empty map.
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    if (AppState.currentState === 'active') void supabase.auth.startAutoRefresh();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      // 'background' rather than any non-active state, matching
      // LocationProvider: iOS fires 'inactive' for a notification pull-down,
      // and cycling the refresher on those is pure churn.
      if (next === 'active') void supabase.auth.startAutoRefresh();
      else if (next === 'background') void supabase.auth.stopAutoRefresh();
    });

    return () => {
      subscription.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Android delivers the OAuth redirect as an app intent rather than resolving
  // it inside the WebBrowser auth session, so the tokens arrive here instead of
  // as the return value of openAuthSessionAsync. Handle both paths.
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    Linking.getInitialURL().then((url) => {
      if (url) void completeAuthFromUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void completeAuthFromUrl(url);
    });

    return () => subscription.remove();
  }, []);

  /**
   * Loads the signed-in user's profile row, and keeps trying until it has one.
   *
   * The version this replaces asked once, threw the error away, and wrote
   * whatever came back -- so a cold start with no network (opening the app on
   * the metro, which is most of the time) left `profile` null for the entire
   * session, with Settings and the user's own avatar blank and nothing
   * anywhere saying why. It also wrote that null over a profile it already
   * had, meaning one failed refetch was enough to lose a good one.
   *
   * Both are fixed by the same rule: only a successful read may write.
   */
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user) {
      setProfile(null);
      return;
    }
    const userId = session.user.id;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (attempt: number): Promise<void> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (cancelled) return;

      if (!error && data) {
        setProfile(data as Profile);
        return;
      }

      // Deliberately does not clear `profile`: a failed read knows nothing
      // about the user, so the last good answer is still the best one held.
      console.warn(`[auth] could not load profile (attempt ${attempt}): ${error?.message}`);

      // A short ladder, then stop. Retrying forever is pointless here -- unlike
      // the realtime channels, nothing about this is expected to be flaky, so a
      // persistent failure means something structural (an RLS change, a row
      // that was never created) that another attempt will not fix. Coming back
      // to the app tries again, which covers the case this is really for:
      // opening it underground.
      const delay = PROFILE_RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load(attempt + 1);
      }, delay);
    };

    void load(1);

    // Reopening the app is the other trigger, and the one that matters most:
    // it is when a user who was underground is most likely to have signal
    // again. A no-op once the profile is in hand.
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (profileRef.current) return;
      void load(1);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription.remove();
    };
    // Keyed by id, not the user object: that object is a fresh reference on
    // every hourly token refresh, which refetched the profile for nothing.
  }, [session?.user?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: isSupabaseConfigured,
      isLoading,
      session,
      profile,

      async signInWithGoogle() {
        try {
          const redirectTo = Linking.createURL('auth/callback');
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo, skipBrowserRedirect: true },
          });
          if (error || !data?.url) {
            return { error: error?.message ?? 'Failed to start Google sign-in.' };
          }

          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
          if (result.type !== 'success' || !result.url) {
            // Either the user cancelled, or Android routed the redirect to the app
            // as an intent -- in which case the deep-link listener above completes
            // the sign-in. Neither case is an error worth surfacing here.
            return { error: null };
          }

          return { error: (await completeAuthFromUrl(result.url)).error };
        } catch (err) {
          // The button's own caller (sign-in.tsx) turns this into a visible
          // error strip and clears the spinner. Without this catch, a reject
          // here (e.g. the browser session throwing) left the button spinning
          // or the caller's own unhandled rejection with no UI to show for it.
          console.warn('[auth] signInWithGoogle failed', err);
          return { error: 'Could not sign in with Google. Please try again.' };
        }
      },

      async signOut() {
        await supabase.auth.signOut();
      },

      async updateProfile(updates) {
        if (!session?.user) return { error: 'Not signed in.' };
        const { data, error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', session.user.id)
          .select()
          .single();
        if (error) return { error: error.message };
        setProfile(data as Profile);
        return { error: null };
      },
    }),
    [isLoading, session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
