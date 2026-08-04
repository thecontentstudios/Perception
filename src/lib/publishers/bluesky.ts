import { getAccessToken, getRefreshToken, saveGrant } from '../oauth/store';

/**
 * Real Bluesky publishing over AT Protocol.
 *
 * Two details here are where naive implementations get it wrong, and both are
 * silent failures rather than errors:
 *
 *  1. **Facets use UTF-8 byte offsets, not JavaScript string indices.** Any
 *     emoji or accented character before a link shifts the byte position, and
 *     using `indexOf` directly produces a link that highlights the wrong span
 *     — or renders as plain text. We index the encoded bytes.
 *
 *  2. **The 300 limit is graphemes, not `String.length`.** "👨‍👩‍👧‍👦" is one
 *     grapheme, four code points, and eleven UTF-16 units. Counting wrong
 *     rejects valid posts or lets over-long ones through to a server error.
 */

const PDS = process.env.BLUESKY_PDS_URL || 'https://bsky.social';
const MAX_GRAPHEMES = 300;

export interface PublishResult {
  ok: boolean;
  uri?: string;
  cid?: string;
  /** Human-clickable permalink. */
  url?: string;
  error?: string;
  /** True when the caller should reconnect rather than retry. */
  needsReconnect?: boolean;
}

/** Grapheme-accurate length, matching how Bluesky counts. */
export function graphemeLength(text: string): number {
  // Intl.Segmenter is in Node 18+ and every current browser.
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let n = 0;
    for (const _ of seg.segment(text)) n++;
    return n;
  }
  return [...text].length; // code points — closer than .length
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: string; uri?: string; tag?: string }[];
}

/**
 * Build link and hashtag facets with correct UTF-8 byte offsets.
 *
 * We encode once and search the byte array, so multi-byte characters earlier
 * in the string can't shift the offsets.
 */
export function buildFacets(text: string): Facet[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const facets: Facet[] = [];

  /** Byte offset of a substring occurrence, given its UTF-16 index. */
  const byteOffsetOf = (charIndex: number): number =>
    encoder.encode(text.slice(0, charIndex)).length;

  // Links. Trailing punctuation is excluded so "see https://x.com." doesn't
  // swallow the full stop into the URL.
  const urlRe = /https?:\/\/[^\s]+/g;
  for (const m of text.matchAll(urlRe)) {
    if (m.index === undefined) continue;
    let raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]}'"]+$/, '');
    raw = trimmed;
    const start = byteOffsetOf(m.index);
    const end = start + encoder.encode(raw).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: raw }],
    });
  }

  // Hashtags — must be preceded by start-of-string or whitespace so that
  // "https://x.com/#anchor" doesn't produce a bogus tag.
  const tagRe = /(^|\s)(#[^\s#]+)/g;
  for (const m of text.matchAll(tagRe)) {
    if (m.index === undefined) continue;
    const tagText = m[2];
    const charIndex = m.index + m[1].length;
    const start = byteOffsetOf(charIndex);
    const end = start + encoder.encode(tagText).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagText.slice(1) }],
    });
  }

  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

/** Exchange the refresh JWT for a fresh session when the access JWT expires. */
async function refreshSession(): Promise<string | null> {
  const refresh = getRefreshToken('bluesky');
  if (!refresh) return null;
  try {
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refresh}` },
    });
    if (!res.ok) return null;
    const s = (await res.json()) as {
      accessJwt: string;
      refreshJwt: string;
      handle: string;
      did: string;
    };
    saveGrant({
      channel: 'bluesky',
      accessToken: s.accessJwt,
      refreshToken: s.refreshJwt,
      expiresInSec: 60 * 60 * 2,
      scopes: ['app-password session'],
      accountLabel: `@${s.handle}`,
      externalAccountId: s.did,
    });
    return s.accessJwt;
  } catch {
    return null;
  }
}

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

/**
 * Publish a post. Retries exactly once after a token refresh, because an
 * expired access JWT is the single most common recoverable failure here and
 * asking the owner to reconnect for it would be needless friction.
 */
export async function publishToBluesky(
  text: string,
  opts: { did: string; handle: string; idempotencyKey?: string }
): Promise<PublishResult> {
  const length = graphemeLength(text);
  if (length === 0) return { ok: false, error: 'Nothing to post.' };
  if (length > MAX_GRAPHEMES) {
    return { ok: false, error: `Too long for Bluesky: ${length} of ${MAX_GRAPHEMES} characters.` };
  }

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    facets: buildFacets(text),
    createdAt: new Date().toISOString(),
  };

  const attempt = async (token: string): Promise<Response> =>
    fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ repo: opts.did, collection: 'app.bsky.feed.post', record }),
    });

  let token = getAccessToken('bluesky');
  if (!token) return { ok: false, error: 'Bluesky is not connected.', needsReconnect: true };

  try {
    let res = await attempt(token);

    if (res.status === 400 || res.status === 401) {
      const body = await res.clone().text();
      if (/ExpiredToken|invalid.?token/i.test(body)) {
        const fresh = await refreshSession();
        if (!fresh) {
          return {
            ok: false,
            error: 'The Bluesky session expired and could not be refreshed.',
            needsReconnect: true,
          };
        }
        token = fresh;
        res = await attempt(token);
      }
    }

    if (!res.ok) {
      const body = await res.text();
      let message = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { message?: string; error?: string };
        message = parsed.message ?? parsed.error ?? message;
      } catch {
        /* keep raw */
      }
      return { ok: false, error: `Bluesky rejected the post: ${message}` };
    }

    const created = (await res.json()) as CreateRecordResponse;
    // at://did:plc:xxx/app.bsky.feed.post/3k... → the last segment is the rkey
    const rkey = created.uri.split('/').pop();
    return {
      ok: true,
      uri: created.uri,
      cid: created.cid,
      url: `https://bsky.app/profile/${opts.handle}/post/${rkey}`,
    };
  } catch (e) {
    return { ok: false, error: `Could not reach ${PDS}: ${(e as Error).message}` };
  }
}
