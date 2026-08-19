import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False until .env has real Supabase credentials. Auth/Friends screens check
 * this and show a setup notice instead of crashing the whole app -- the
 * offline map/routing tabs must keep working with no backend configured. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Socket-level tracing for the realtime connection. Dev builds only.
 *
 * Turned on because the app's own logs could say what happened but never why:
 * a channel reports `CHANNEL_ERROR` and the reason -- a close code, a server
 * error payload, a heartbeat that went unanswered -- lives one layer down in
 * phoenix and was being dropped on the floor. Every drop therefore looked
 * identical from the outside, which is exactly the state that makes a
 * connection problem unfixable.
 *
 * Chatty by design: it prints every push and reply, so leave it to dev.
 */
const REALTIME_TRACE = __DEV__;

/** Payloads can be whole presence states; enough to identify one is plenty. */
function summarise(data: unknown): string {
  if (data === undefined || data === null) return '';
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return '[unserialisable]';
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Encrypted at rest -- refresh tokens previously sat in AsyncStorage
      // as plaintext. Existing sessions migrate across on first read.
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    realtime: REALTIME_TRACE
      ? {
          logger: (kind: string, msg: string, data?: unknown) => {
            console.warn(`[realtime] ${kind} ${msg} ${summarise(data)}`.trimEnd());
          },
        }
      : undefined,
  },
);

/**
 * The heartbeat's own lifecycle -- 'sent', 'ok', 'timeout', 'disconnected'.
 *
 * Worth having separately from the trace above, because a heartbeat that is
 * sent and never answered is how phoenix decides the socket is dead: it calls
 * `heartbeatTimeout()`, which tears the connection down and takes every
 * channel with it at once. That failure arrives at this app as a dozen
 * simultaneous `CHANNEL_ERROR`s with no explanation attached, and this is the
 * one line that tells it apart from the server actually rejecting something.
 */
if (REALTIME_TRACE) {
  supabase.realtime.onHeartbeat((status: string) => {
    console.warn(`[realtime] heartbeat ${status}`);
  });
}
