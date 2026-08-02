// `URL`/`URLSearchParams` are only partially implemented in Hermes, and this
// module can be evaluated before anything that pulls in src/lib/supabase.ts
// (which is where the polyfill is otherwise installed). Importing it here as
// well is idempotent and removes the load-order dependency.
import 'react-native-url-polyfill/auto';
import { INVITE_PATH, parseInviteUid } from '../src/friends/inviteLink';

/**
 * Rewrites incoming deep links that expo-router can't match on its own.
 *
 * Invite links are published as `https://<host>/i/?u=<public_uid>` (see
 * src/friends/inviteLink.ts for why they aren't a custom scheme). That URL is
 * shaped for a static web host, not for the app's route tree -- there is no
 * `/i` route and the ID is in the query string -- so an Android App Link
 * opening it would otherwise land on the unmatched-route screen.
 *
 * Everything else is returned untouched. This function sees *every* link the
 * OS hands the app, including the `routro://auth/callback#access_token=...`
 * OAuth redirect, and mangling one of those would break sign-in.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const publicUid = parseInviteUid(path);
    return publicUid ? `/${INVITE_PATH}/${publicUid}` : path;
  } catch {
    // A malformed link is not worth a crash on launch -- hand it back and let
    // the router show its own unmatched-route screen.
    return path;
  }
}
