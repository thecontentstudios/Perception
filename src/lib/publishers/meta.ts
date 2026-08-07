import { getAccessToken, summaries } from '../oauth/store';
import type { MediaAttachment, PostMetrics, Publisher, PublishOutcome } from './types';
import { buildMultipart } from './multipart';

/**
 * Facebook Page publishing over the Graph API.
 *
 * Third implementation of the `Publisher` contract, and different from both
 * predecessors in ways that exercise it: the token travels as a parameter
 * rather than a header, errors arrive as `{ error: { code } }` with numeric
 * codes inside a 400/401, and — the reason this one moves the product —
 * **the platform reports impressions.** Bluesky and Mastodon count likes and
 * boosts and no views; Facebook's `post_impressions` is the first number the
 * metrics reader returns for reach that is not an honest null.
 *
 * The base URL is overridable for the same reason Resend's and Twilio's are:
 * real Meta requires a reviewed business app, and the code under test should
 * be the real adapter taking a real HTTP round trip against a stand-in that
 * speaks the same wire protocol.
 */

const BASE = () => (process.env.META_BASE_URL ?? 'https://graph.facebook.com').replace(/\/+$/, '');

/** The Page id and token, from the stored grant. */
function pageContext(): { pageId: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === 'facebook');
  if (!grant) return null;
  return { pageId: grant.externalAccountId, label: grant.accountLabel };
}

/**
 * Graph error codes that mean the grant is dead, not the request.
 * 190 is the invalid/expired session; 200-299 are permission errors that a
 * retry cannot fix either.
 */
function needsReconnect(code: number): boolean {
  return code === 190 || (code >= 200 && code <= 299);
}

async function graph(path: string, init?: { method?: string; form?: Record<string, string> }): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; status: number; code: number; message: string }
> {
  const token = getAccessToken('facebook');
  if (!token) return { ok: false, status: 0, code: 190, message: 'Facebook is not connected.' };

  try {
    const body = init?.form ? new URLSearchParams({ ...init.form, access_token: token }).toString() : undefined;
    const sep = path.includes('?') ? '&' : '?';
    const url = body ? `${BASE()}${path}` : `${BASE()}${path}${sep}access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      body,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* fall through to error below */
    }
    if (!res.ok) {
      const err = (parsed.error ?? {}) as { code?: number; message?: string };
      return { ok: false, status: res.status, code: err.code ?? 0, message: err.message ?? `Graph returned ${res.status}` };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, status: 0, code: -1, message: `Could not reach the Graph API: ${(e as Error).message}` };
  }
}

export const facebookPublisher: Publisher = {
  capabilities: {
    channel: 'facebook',
    // Practically unbounded (63,206), and counted in code units. Nobody hits
    // it with a post a human wrote; preflight warns long before.
    maxLength: 63206,
    lengthUnit: 'utf16',
    limitIsPerInstance: false,
  },

  measure: (text) => text.length,

  check(text) {
    const length = this.measure(text);
    if (length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > 63206) return { ok: false, length, error: `Too long for Facebook: ${length} characters.` };
    return { ok: true, length };
  },

  async publish(text, opts): Promise<PublishOutcome> {
    const ctx = pageContext();
    if (!ctx) return { ok: false, error: 'Facebook is not connected.', needsReconnect: true };

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    // No idempotency key: the Graph feed edge has none. The worker's
    // compare-and-swap claim is the only duplicate protection, which is the
    // same position every Facebook client is in.
    //
    // A post with an image goes to the /photos edge with the text as its
    // caption — that is how a photo post is made; attaching media to /feed is
    // a link preview, not a picture. Bytes rather than a URL, because a URL
    // would require our media host to be publicly reachable by Meta's
    // fetchers, which localhost and half of small-business hosting are not.
    const media = (opts as { media?: MediaAttachment[] }).media ?? [];
    if (media.length > 0) {
      const m = media[0];
      const token = getAccessToken('facebook');
      const { body, contentType } = buildMultipart(
        { caption: text, access_token: token ?? '', ...(m.altText ? { alt_text_custom: m.altText } : {}) },
        [{ field: 'source', filename: 'upload', mime: m.mime, bytes: m.bytes }]
      );
      try {
        const res = await fetch(`${BASE()}/v21.0/${ctx.pageId}/photos`, {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: body as BodyInit,
        });
        const textBody = await res.text();
        let parsed: { id?: string; post_id?: string; error?: { code?: number; message?: string } } = {};
        try { parsed = JSON.parse(textBody); } catch { /* handled below */ }
        if (!res.ok) {
          return {
            ok: false,
            error: `Facebook rejected the photo: ${parsed.error?.message ?? res.status}`,
            needsReconnect: needsReconnect(parsed.error?.code ?? 0),
          };
        }
        const id = String(parsed.post_id ?? parsed.id ?? '');
        if (!id) return { ok: false, error: 'Facebook stored the photo but returned no post id.' };
        return { ok: true, id, url: `https://www.facebook.com/${id}` };
      } catch (e) {
        return { ok: false, error: `Could not reach the Graph API: ${(e as Error).message}` };
      }
    }

    const r = await graph(`/v21.0/${ctx.pageId}/feed`, { method: 'POST', form: { message: text } });
    if (!r.ok) {
      return { ok: false, error: `Facebook rejected the post: ${r.message}`, needsReconnect: needsReconnect(r.code) };
    }
    const id = String(r.data.id ?? '');
    if (!id) return { ok: false, error: 'Facebook accepted the post but returned no id.' };
    return { ok: true, id, url: `https://www.facebook.com/${id}` };
  },

  async verify() {
    const ctx = pageContext();
    return ctx ? { ok: true, account: ctx.label } : { ok: false, error: 'Facebook is not connected.' };
  },

  /**
   * Impressions from the insights edge, engagement from the object itself.
   *
   * Two calls because Graph splits them: `post_impressions` lives under
   * `/insights`, while reactions, comments and shares are fields on the post.
   * Both numbers are real here — the first channel where neither column of
   * the report is a permanent blank.
   */
  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const [ins, obj] = await Promise.all([
      graph(`/v21.0/${encodeURIComponent(postId)}/insights?metric=post_impressions`),
      graph(`/v21.0/${encodeURIComponent(postId)}?fields=reactions.summary(true),comments.summary(true),shares`),
    ]);

    // Graph 404s an object that was deleted — an answer, not an error.
    if (!ins.ok && ins.status === 404) {
      return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
    }
    if (!ins.ok) return { ok: false, error: ins.message };
    if (!obj.ok) return { ok: false, error: obj.message };

    const series = (ins.data.data ?? []) as { name?: string; values?: { value?: number }[] }[];
    const impressions = series.find((d) => d.name === 'post_impressions')?.values?.[0]?.value ?? null;

    const o = obj.data as {
      reactions?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    };
    const engagements =
      (o.reactions?.summary?.total_count ?? 0) + (o.comments?.summary?.total_count ?? 0) + (o.shares?.count ?? 0);

    return { ok: true, metrics: { impressions, engagements, clicks: null } };
  },
};
