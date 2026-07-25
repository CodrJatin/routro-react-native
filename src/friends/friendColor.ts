/**
 * A stable, distinct colour per friend, used for their map pin ring and the
 * matching ring in the focus stack so the same person reads the same way in
 * both places.
 *
 * The theme palette is deliberately near-monochrome (see tokens.ts), so
 * these are their own set rather than semantic tokens: eight hues chosen to
 * stay legible against both the light and dark map canvas, and to stay
 * distinguishable from the metro line colours already drawn underneath.
 */
const FRIEND_PIN_COLORS = [
  '#F2545B', // coral
  '#3DA5D9', // sky
  '#F5A623', // amber
  '#7B61FF', // violet
  '#2EC4B6', // teal
  '#EA4C89', // pink
  '#8CC63F', // lime
  '#FF7A45', // orange
] as const;

/** Deterministic so a friend keeps the same colour across app launches and
 * across devices -- derived from the user id, not from list position. */
export function friendColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return FRIEND_PIN_COLORS[Math.abs(hash) % FRIEND_PIN_COLORS.length];
}
