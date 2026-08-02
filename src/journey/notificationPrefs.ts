import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { JourneyAlertKind } from './alerts';

const STORAGE_KEY = 'metrosync.notificationPrefs';

/** Everything the app can interrupt someone for. The ongoing journey
 * notification is deliberately absent: Android requires a foreground service
 * to show one, so it isn't ours to switch off. */
export interface NotificationPrefs {
  /** Master switch. Off silences every alert below regardless of their own
   * setting -- kept as a separate flag rather than clearing them, so turning
   * it back on restores what the user had chosen. */
  enabled: boolean;
  /** "Get off at the next stop" and arriving. */
  alighting: boolean;
  /** Changing lines, and the warning one stop before it. */
  interchange: boolean;
  /** A friend coming within a couple of stops, or arriving somewhere. */
  friends: boolean;
  /** Someone asking to meet you at a station, and their answer when you ask.
   * Unlike everything above it, this one is not tied to a journey -- a request
   * expires in thirty seconds, so it has to reach you wherever you are. */
  meets: boolean;
}

/** Alerts about your own journey default on -- they are the reason to follow
 * one. Friend alerts default off: a journey already interrupts twice, and
 * stacking unrequested alerts about other people on top is how someone ends
 * up silencing the app entirely, taking "get off at the next stop" with it. */
const DEFAULTS: NotificationPrefs = {
  enabled: true,
  alighting: true,
  interchange: true,
  friends: false,
  // On, unlike the passive friend alerts above: this is a person waiting on an
  // answer with a thirty-second clock running, not the app volunteering an
  // observation. Missing it silently is the feature failing.
  meets: true,
};

interface NotificationPrefsState extends NotificationPrefs {
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setPref: <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => void;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  ...DEFAULTS,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ ...DEFAULTS, ...parseStored(raw), isHydrated: true });
    } catch {
      set({ ...DEFAULTS, isHydrated: true });
    }
  },

  setPref: (key, value) => {
    set({ [key]: value } as Pick<NotificationPrefs, typeof key>);
    const { enabled, alighting, interchange, friends, meets } = get();
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled, alighting, interchange, friends, meets }),
    ).catch(() => {
      // Best-effort; the in-memory value is what this session acts on.
    });
  },
}));

/** Whether an alert of this kind should be shown, master switch included.
 * Read at fire time rather than at journey start, so a change takes effect
 * mid-journey instead of at the next one. */
export function isAlertKindEnabled(kind: JourneyAlertKind): boolean {
  const prefs = useNotificationPrefsStore.getState();
  if (!prefs.enabled) return false;

  switch (kind) {
    case 'approaching-destination':
    case 'arrived':
      return prefs.alighting;
    case 'approaching-interchange':
    case 'interchange-now':
      return prefs.interchange;
  }
}

export function areFriendAlertsEnabled(): boolean {
  const prefs = useNotificationPrefsStore.getState();
  return prefs.enabled && prefs.friends;
}

export function areMeetAlertsEnabled(): boolean {
  const prefs = useNotificationPrefsStore.getState();
  return prefs.enabled && prefs.meets;
}

function parseStored(raw: string | null): Partial<NotificationPrefs> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const stored = parsed as Record<string, unknown>;
    const prefs: Partial<NotificationPrefs> = {};
    // Field by field, so a stored blob written by an older or newer build
    // can't put a non-boolean into a switch.
    for (const key of ['enabled', 'alighting', 'interchange', 'friends', 'meets'] as const) {
      if (typeof stored[key] === 'boolean') prefs[key] = stored[key];
    }
    return prefs;
  } catch {
    return {};
  }
}
