import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { getLogEntries, redact } from './logBuffer';

/**
 * Crashes that outlive the process, uploaded to this project's own database.
 *
 * The diagnostics ring is in memory, which means the one failure it can never
 * report is the one that kills the app. This closes that: the crash is written
 * to disk as it happens and sent on the next launch.
 *
 * Two rules shape everything below, and both are about not making a bad moment
 * worse. Nothing here may throw -- code that runs during a crash and then
 * crashes itself turns a recoverable render error into a hard failure. And
 * nothing may block: on the fatal path the process is already on its way out,
 * so the disk write is started and whatever lands, lands.
 *
 * Native crashes are out of scope and always will be for a JS-side reporter --
 * a process the OS kills never runs the code that would record it.
 */

const PENDING_KEY = 'routro.pendingCrash';

/** How much of the log ring to carry. Comfortably inside the column's 40k cap
 * (see 0009) with room for multi-byte characters, and past the point where
 * older lines are telling you anything about what just happened. */
const MAX_LOG_CHARS = 20_000;
/** Matches the `message` column's cap, applied here so an over-long message is
 * truncated into a report rather than rejected as one. */
const MAX_MESSAGE_CHARS = 2000;

interface PendingCrash {
  occurredAt: number;
  isFatal: boolean;
  message: string;
  logs: string;
  appVersion: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  platform: string;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // Name and message only. A release stack is minified into
    // meaninglessness, and shipping one would be sending noise that might
    // still contain string fragments worth not sending.
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The recent log lines, redacted and bounded. Newest kept, oldest dropped. */
function collectLogs(): string {
  const text = getLogEntries()
    .map((e) => `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} ${e.message}`)
    .join('\n');
  return text.length > MAX_LOG_CHARS ? text.slice(-MAX_LOG_CHARS) : text;
}

/**
 * Records a crash for upload on the next launch.
 *
 * Deliberately fire-and-forget, and deliberately last-one-wins: only a single
 * pending report is kept. A crash loop would otherwise fill storage with
 * hundreds of copies of the same failure, and the most recent one describes it
 * just as well as the first.
 */
export function persistCrash(error: unknown, options: { isFatal: boolean }): void {
  try {
    const pending: PendingCrash = {
      occurredAt: Date.now(),
      isFatal: options.isFatal,
      // Redacted here rather than at upload, so nothing unredacted is ever
      // written to disk in the first place -- the same rule the log ring
      // follows.
      message: redact(describe(error)).slice(0, MAX_MESSAGE_CHARS),
      logs: collectLogs(),
      appVersion: Constants.expoConfig?.version ?? null,
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.isEmbeddedLaunch ? 'embedded' : Updates.updateId,
      platform: `${Platform.OS} ${String(Platform.Version)}`,
    };

    // Not awaited: on the fatal path there may be no more event loop to await
    // with. A write that does not land simply means no report, which is the
    // state we were in before any of this existed.
    void AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending)).catch(() => {});
  } catch {
    // A reporter that throws while reporting would escalate a caught render
    // error into a real crash. There is nothing useful to do here and nowhere
    // useful to say it.
  }
}

/**
 * Uploads a crash held over from a previous run, then clears it.
 *
 * Call once a session is available. Requires one, because the table's RLS
 * insert policy is `auth.uid() = user_id` -- a crash while signed out has
 * nowhere to go, and inventing an anonymous path would mean a table anyone can
 * write into.
 *
 * The local copy is deleted only after the insert succeeds, so a failed upload
 * (offline, most likely) is retried on the next launch rather than lost.
 */
export async function uploadPendingCrash(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return;

    let pending: PendingCrash;
    try {
      pending = JSON.parse(raw) as PendingCrash;
    } catch {
      // Written by an older build, or truncated by the crash it was recording.
      // Unparseable is unrecoverable, so drop it rather than retrying forever.
      await AsyncStorage.removeItem(PENDING_KEY);
      return;
    }

    const { error } = await supabase.from('crash_reports').insert({
      user_id: userId,
      occurred_at: new Date(pending.occurredAt).toISOString(),
      is_fatal: pending.isFatal,
      message: pending.message,
      logs: pending.logs || null,
      app_version: pending.appVersion,
      runtime_version: pending.runtimeVersion,
      update_id: pending.updateId,
      platform: pending.platform,
    });

    if (error) {
      console.warn(`[crash] could not upload the pending report: ${error.message}`);
      return;
    }
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch (error) {
    console.warn('[crash] upload failed', error);
  }
}

/**
 * Catches what the React error boundary cannot: a throw outside rendering, and
 * an unhandled promise rejection.
 *
 * React Native routes fatal JS errors through `ErrorUtils`, and the previous
 * handler is always called afterwards -- replacing it outright would swallow
 * the red box in development and the app's own crash handling in release.
 *
 * Idempotent, so a fast refresh cannot chain handlers and record twice.
 */
let isInstalled = false;

export function installCrashCapture(): void {
  if (isInstalled) return;
  isInstalled = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    persistCrash(error, { isFatal: isFatal ?? false });
    previous?.(error, isFatal);
  });
}

/** The shape of React Native's global error hook. Typed here because it is a
 * runtime global rather than a module export, and narrowly, so this file makes
 * no assumptions beyond the two functions it uses. */
interface ErrorUtilsLike {
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
}
