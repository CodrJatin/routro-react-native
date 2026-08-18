/**
 * A small ring of the most recent warnings and errors, so a bug report can
 * carry evidence instead of a description.
 *
 * This app's characteristic failures are the ones nobody can reproduce on
 * demand: the pin froze in a tunnel, sharing stopped somewhere on the Blue
 * Line, a friend never appeared. The code already logs exactly the right
 * things for those -- fix accuracy, broadcast refusal codes, reconnect
 * attempts, channel join failures -- and every one of them went to a console
 * nobody would ever read on a real device.
 *
 * Deliberately in memory only. Writing diagnostics to disk would turn a
 * debugging aid into a location-adjacent record of where someone has been,
 * which is the one thing this app goes out of its way not to keep.
 */

/** How many entries to hold. Enough to cover a whole journey's worth of
 * interesting events at the rate this app actually logs (a handful a minute),
 * small enough that the buffer is never a memory concern. */
const MAX_ENTRIES = 200;

export interface LogEntry {
  /** ms since epoch, this device's clock. */
  at: number;
  level: 'warn' | 'error';
  message: string;
}

let entries: LogEntry[] = [];

/**
 * Anything that looks like a bearer token, replaced wholesale.
 *
 * Load-bearing, not decorative: these entries are uploaded with a crash report
 * (see crashReport.ts), and a supabase-js or realtime-js error is perfectly
 * capable of quoting the JWT it just failed to authenticate with.
 * Matching on the JWT shape (three base64url segments after an `eyJ` header)
 * catches access and refresh tokens wherever in a message they appear.
 */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

/**
 * User ids, shortened rather than removed.
 *
 * A full uuid identifies a specific person, and half the ids in these logs
 * belong to someone *else* -- a friend whose channel failed, whose presence
 * went stale. But stripping them entirely would make the logs useless, since
 * telling two friends' channels apart is often the whole question. Eight
 * characters is enough to correlate within one report and not enough to
 * identify anyone outside it -- the same length, and the same reasoning, as
 * the `public_uid` the schema already exposes.
 */
const UUID_PATTERN =
  /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Exported so the crash reporter applies exactly this redaction, rather than
 * a second copy of it that could drift. Anything leaving the device goes
 * through here. */
export function redact(text: string): string {
  return text.replace(JWT_PATTERN, '[token]').replace(UUID_PATTERN, '$1…');
}

/** Renders one console argument. Errors keep their message (the stack is
 * minified in release and worth nothing here), and anything unserialisable --
 * a circular structure, most often -- degrades to its type rather than
 * throwing inside the logger. */
function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return '[unserialisable object]';
    }
  }
  return String(arg);
}

/** Adds one entry, dropping the oldest once the ring is full. */
export function recordLog(level: LogEntry['level'], args: unknown[]): void {
  const message = redact(args.map(stringifyArg).join(' '));
  entries.push({ at: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
}

export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLogEntries(): void {
  entries = [];
}

/**
 * Routes `console.warn` and `console.error` into the ring, then hands them on
 * to the real console untouched.
 *
 * Patching the console rather than adding a logging call at each of the ~29
 * existing sites is a deliberate trade. It is the more invasive shape, but it
 * is the one that cannot rot: a warning added next month is captured without
 * anyone remembering to, and -- the bigger win -- so are the ones from
 * supabase-js, realtime-js and expo, which are exactly the messages worth
 * having when a connection misbehaves and are entirely outside this codebase.
 *
 * `console.log` is left alone: it is debug chatter, it is far noisier, and
 * nothing in this app uses it to report a problem.
 *
 * Idempotent, so a fast refresh re-running this cannot nest the wrappers and
 * start recording each message twice.
 */
let isInstalled = false;

export function installConsoleCapture(): void {
  if (isInstalled) return;
  isInstalled = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    recordLog('warn', args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    recordLog('error', args);
    originalError(...args);
  };
}
