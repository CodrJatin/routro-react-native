import { describe, expect, it } from 'vitest';
import {
  buildInviteMessage,
  buildInviteUrl,
  INVITE_BASE_URL,
  parseInviteUid,
} from '../inviteLink';

const UID = 'a944aac2';

describe('buildInviteUrl', () => {
  it('produces an https URL, which is the whole point -- chat apps only linkify http(s) and cameras treat unknown schemes as plain text', () => {
    expect(buildInviteUrl(UID).startsWith('https://')).toBe(true);
  });

  it('round-trips through parseInviteUid', () => {
    expect(parseInviteUid(buildInviteUrl(UID))).toBe(UID);
  });
});

describe('parseInviteUid', () => {
  it('tolerates the mangling a link picks up in transit', () => {
    const base = INVITE_BASE_URL.replace(/\/$/, '');
    // Hosts are case-insensitive and get shouted by some mail clients. (Paths
    // are not, and deliberately still have to match exactly.)
    const shoutedHost = new URL(INVITE_BASE_URL).host.toUpperCase();
    expect(parseInviteUid(`https://${shoutedHost}${new URL(INVITE_BASE_URL).pathname}?u=${UID}`)).toBe(UID);
    // Tracking params appended by whatever forwarded it.
    expect(parseInviteUid(`${base}/?u=${UID}&utm_source=whatsapp`)).toBe(UID);
    // Uppercased ID -- public_uid is stored lowercase, so the lookup needs it lowered.
    expect(parseInviteUid(`${base}/?u=${UID.toUpperCase()}`)).toBe(UID);
  });

  it('returns null for links that are not invites, so they pass through the native-intent rewrite untouched', () => {
    // The OAuth redirect is the one that must never be rewritten -- mangling it
    // breaks sign-in.
    expect(parseInviteUid('metrosync://auth/callback#access_token=abc&refresh_token=def')).toBeNull();
    expect(parseInviteUid('https://example.com/ms/?u=a944aac2')).toBeNull();
    expect(parseInviteUid('not a url at all')).toBeNull();
    expect(parseInviteUid('')).toBeNull();
  });

  it('returns null when the code is missing, rather than routing to an empty invite', () => {
    expect(parseInviteUid(INVITE_BASE_URL)).toBeNull();
    expect(parseInviteUid(`${INVITE_BASE_URL}?u=`)).toBeNull();
    expect(parseInviteUid(`${INVITE_BASE_URL}?u=%20%20`)).toBeNull();
  });
});

describe('buildInviteMessage', () => {
  it('names the sender and repeats the ID outside the URL, for links that arrive truncated', () => {
    const message = buildInviteMessage('Deepika', UID);

    expect(message).toContain('Deepika');
    expect(message).toContain(buildInviteUrl(UID));
    expect(message).toContain(`add ID ${UID}`);
  });

  it('falls back to a generic subject when the profile has no display name', () => {
    expect(buildInviteMessage(null, UID)).toMatch(/^A friend/);
    // Whitespace-only names are the same case -- "   wants to share" reads as
    // a bug, not as a name.
    expect(buildInviteMessage('   ', UID)).toMatch(/^A friend/);
  });
});
