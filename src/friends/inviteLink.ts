/**
 * Invite links, in the one shape that actually travels.
 *
 * These used to be `metrosync://invite/<uid>` deep links, which failed at both
 * jobs: chat apps only turn http(s) into a tappable link, and phone cameras
 * hand an unrecognised scheme to the OS as plain text (Android offers to save
 * it to Notes rather than open it). A custom scheme is also a dead end for the
 * recipients who matter most -- the ones who don't have MetroSync installed
 * yet, and for whom the link has to be a real web page.
 *
 * So the shared artifact is an https URL pointing at a small static page
 * (see site/ in the repo root). Android App Links let a verified install skip
 * that page and open the app directly; everyone else lands on it and gets an
 * "Open in MetroSync" button plus the raw ID. app/+native-intent.tsx turns the
 * https URL back into the /invite/<uid> route once it reaches the app.
 */

/**
 * Where the static invite page is published. This is the single line to change
 * when the site moves to a real domain -- but changing it is NOT self-contained:
 *
 *   1. `expo.android.intentFilters` in app.json pins the same host and path
 *      prefix, and needs a native rebuild to take effect.
 *   2. The new host must serve /.well-known/assetlinks.json (root of the
 *      domain, not of the project path) or App Links silently stop verifying.
 *
 * Trailing slash included so a static host resolves it to index.html.
 */
export const INVITE_BASE_URL = 'https://codrjatin.github.io/ms/';

/** Route segment the invite lands on inside the app. Must stay in step with
 * the file at app/invite/[uid].tsx, which is what expo-router matches on. */
export const INVITE_PATH = 'invite';

/** Query key carrying the public_uid.
 *
 * A query parameter rather than a path segment (`/ms/a944aac2`) because static
 * hosts have no file at that path and would 404 -- GitHub Pages, S3 and
 * Netlify all serve `/ms/?u=...` from the same index.html without any routing
 * config. Android matches App Links on the path only, so the query is invisible
 * to verification either way. */
export const INVITE_QUERY_KEY = 'u';

/** The invite payload is just the sender's existing `public_uid` -- the same
 * 8-hex handle the Friends tab already accepts by hand. Nothing is minted,
 * stored or expired server-side; the link is a shortcut through the normal
 * add-by-ID flow, not a credential. */
export function buildInviteUrl(publicUid: string): string {
  return `${INVITE_BASE_URL}?${INVITE_QUERY_KEY}=${encodeURIComponent(publicUid)}`;
}

/** Pulls the public_uid back out of an incoming link, for the native-intent
 * rewrite. Returns null for anything that isn't one of our invite URLs --
 * every deep link the app receives passes through here, including the OAuth
 * callback, and those must be handed on untouched.
 *
 * Matched on host + path prefix rather than string equality with
 * INVITE_BASE_URL so a link that picked up a trailing slash, an extra query
 * param (utm tags from a chat app) or a different case in the host still
 * resolves. */
export function parseInviteUid(url: string): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(INVITE_BASE_URL);
  } catch {
    return null;
  }

  if (parsed.protocol !== base.protocol) return null;
  if (parsed.host.toLowerCase() !== base.host.toLowerCase()) return null;
  if (!parsed.pathname.startsWith(base.pathname.replace(/\/$/, ''))) return null;

  const publicUid = parsed.searchParams.get(INVITE_QUERY_KEY)?.trim().toLowerCase();
  return publicUid ? publicUid : null;
}

/** The ID rides along in plain text as well as inside the URL: it's the
 * fallback when the link is flattened by a chat app that strips query strings,
 * and the only route left for anyone reading a screenshot. */
export function buildInviteMessage(displayName: string | null, publicUid: string): string {
  const who = displayName?.trim() || 'A friend';
  return [
    `${who} wants to share their live metro location with you on MetroSync.`,
    '',
    buildInviteUrl(publicUid),
    '',
    `Already have the app? You can also add ID ${publicUid} directly.`,
  ].join('\n');
}
