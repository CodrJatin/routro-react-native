import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

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

/** Pulls the implicit-flow tokens out of an OAuth redirect URL and installs the
 * session. `handled` is false for unrelated deep links (share intents, etc). */
async function completeAuthFromUrl(url: string): Promise<{ handled: boolean; error: string | null }> {
  const params = new URLSearchParams(url.split('#')[1] ?? '');

  const errorDescription = params.get('error_description') ?? params.get('error');
  if (errorDescription) return { handled: true, error: errorDescription };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { handled: false, error: null };

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return { handled: true, error: error?.message ?? null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // getSession() races onAuthStateChange: an OAuth deep link can install a
    // session before the (slower) getSession call resolves, and its stale
    // result would then clobber the newer one. Once any auth event has
    // arrived, that is the source of truth.
    let hasAuthEvent = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!hasAuthEvent) setSession(data.session);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hasAuthEvent = true;
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

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

  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setProfile(data as Profile | null);
      });
    return () => {
      cancelled = true;
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
