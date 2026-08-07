import { getAccessToken, summaries } from '../oauth/store';
import type { MediaAttachment, Publisher, PublishOutcome } from './types';
import { buildMultipart } from './multipart';

/**
 * Mastodon publishing over the REST API.
 *
 * The interesting difference from Bluesky, and the reason this is a good test
 * of the abstraction: **there is no single Mastodon host.** Every account
 * lives on an instance the owner chose, so the base URL is per-account state
 * rather than a constant, and so is the character limit — the default is 500
 * but instances routinely raise it. We read the real limit from
 * `/api/v1/instance` at connect time and store it with the grant.
 *
 * Getting the limit from the protocol spec instead of the server would reject
 * perfectly valid 1500-character posts on the many instances that allow them.
 */

/** The host and limit are stored on the grant, since both are per-account. */
export function mastodonContext(): { host: string; limit: number; handle: string } | null {
  const grant = summaries().find((g) => g.channel === 'mastodon');
  if (!grant) return null;
  // externalAccountId carries "host|accountId|limit" — the store is
  // intentionally minimal, and this keeps per-instance facts with the grant
  // they belong to rather than in a second table.
  const [host, , limit] = grant.externalAccountId.split('|');
  return {
    host: host || '',
    limit: Number(limit) || 500,
    handle: grant.accountLabel,
  };
}

async function api<T>(
  host: string,
  path: string,
  init?: RequestInit & { token?: string }
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    // http only for loopback, so a local dev instance can be used; a real
    // remote host can never be downgraded from TLS by this.
    const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
    const res = await fetch(`${scheme}://${host}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      let error = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: string; error_description?: string };
        error = parsed.error_description ?? parsed.error ?? error;
      } catch {
        /* keep raw */
      }
      return { ok: false, status: res.status, error };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

/** Read the instance's real configuration — limits are per-server. */
export async function fetchInstanceLimits(
  host: string
): Promise<{ ok: boolean; limit?: number; title?: string; error?: string }> {
  const res = await api<{
    title?: string;
    configuration?: { statuses?: { max_characters?: number } };
    max_toot_chars?: number; // older instances
  }>(host, '/api/v1/instance');
  if (!res.ok) return { ok: false, error: res.error };
  const limit =
    res.data.configuration?.statuses?.max_characters ?? res.data.max_toot_chars ?? 500;
  return { ok: true, limit, title: res.data.title };
}

export const mastodonPublisher: Publisher = {
  capabilities: {
    channel: 'mastodon',
    maxLength: 500, // overridden per instance at runtime
    // Mastodon counts by code point, and it counts every URL as a fixed 23
    // characters regardless of real length — a long tracking URL costs the
    // same as a short one.
    lengthUnit: 'codepoint',
    limitIsPerInstance: true,
  },

  measure(text: string): number {
    // URLs count as 23 characters each, whatever their real length.
    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    let count = [...text].length;
    for (const u of urls) count += 23 - [...u].length;
    return Math.max(0, count);
  },

  check(text: string) {
    const ctx = mastodonContext();
    const limit = ctx?.limit ?? this.capabilities.maxLength ?? 500;
    const length = this.measure(text);
    if (length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > limit) {
      return {
        ok: false,
        length,
        error: `Too long for ${ctx?.host ?? 'this instance'}: ${length} of ${limit} characters.`,
      };
    }
    return { ok: true, length };
  },

  async publish(text: string, opts): Promise<PublishOutcome> {
    const ctx = mastodonContext();
    if (!ctx) return { ok: false, error: 'Mastodon is not connected.', needsReconnect: true };
    const token = getAccessToken('mastodon');
    if (!token) return { ok: false, error: 'Mastodon is not connected.', needsReconnect: true };

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    // Images first: /api/v2/media per file, then their ids ride on the
    // status. `description` is Mastodon's name for alt text, set at upload —
    // there is no second chance to attach it after the post exists.
    const mediaIds: string[] = [];
    for (const m of (opts as { media?: MediaAttachment[] }).media ?? []) {
      const up = await uploadMastodonMedia(ctx.host, token, m);
      if (!up.ok) return { ok: false, error: up.error };
      mediaIds.push(up.id);
    }

    const res = await api<{ id: string; url: string }>(ctx.host, '/api/v1/statuses', {
      method: 'POST',
      token,
      headers: {
        'Content-Type': 'application/json',
        // Mastodon honours this header natively: the same key within a short
        // window returns the original status instead of creating a second one.
        'Idempotency-Key': opts.idempotencyKey ?? `${ctx.host}:${text.slice(0, 40)}`,
      },
      body: JSON.stringify({ status: text, visibility: 'public', ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
    });

    if (!res.ok) {
      // Mastodon tokens do not expire, so a 401 means revoked — reconnect,
      // don't retry. That is the opposite of Bluesky's short-lived JWT.
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: 'The Mastodon access token was revoked or is invalid.',
          needsReconnect: true,
        };
      }
      return { ok: false, error: `${ctx.host} rejected the post: ${res.error}` };
    }

    return { ok: true, id: res.data.id, url: res.data.url };
  },

  async verify() {
    const ctx = mastodonContext();
    const token = getAccessToken('mastodon');
    if (!ctx || !token) return { ok: false, error: 'Not connected.' };
    const res = await api<{ acct: string; username: string }>(
      ctx.host,
      '/api/v1/accounts/verify_credentials',
      { token }
    );
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, account: `@${res.data.username}@${ctx.host}` };
  },

  /**
   * A status carries its own counters: `favourites_count`, `reblogs_count`
   * and `replies_count`. There is **no view count** — Mastodon does not
   * measure reach at all, by design, and no instance can be configured to
   * report it. So impressions are null for ever here, the same as Bluesky,
   * and for a stronger reason: it is a stated position of the software rather
   * than an omission.
   *
   * Worth an owner knowing before they compare it to Facebook on reach.
   */
  async fetchMetrics(postId: string) {
    const ctx = mastodonContext();
    const token = getAccessToken('mastodon');
    if (!ctx || !token) return { ok: false, error: 'Mastodon is not connected.' };

    const res = await api<{
      favourites_count?: number;
      reblogs_count?: number;
      replies_count?: number;
    }>(ctx.host, `/api/v1/statuses/${encodeURIComponent(postId)}`, { token });

    if (!res.ok) {
      // A deleted status is a 404, which is an answer and not an error: the
      // post is gone and will not come back, so the refresher should stop
      // asking rather than retrying for ever.
      if (res.status === 404) {
        return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
      }
      return { ok: false, error: `${ctx.host} returned ${res.status}: ${res.error}` };
    }

    const engagements =
      (res.data.favourites_count ?? 0) + (res.data.reblogs_count ?? 0) + (res.data.replies_count ?? 0);

    return { ok: true, metrics: { impressions: null, engagements, clicks: null } };
  },
};

/** Upload one image to the instance; the id rides on the status that follows. */
async function uploadMastodonMedia(
  host: string,
  token: string,
  m: MediaAttachment
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { body, contentType } = buildMultipart(
    m.altText ? { description: m.altText } : {},
    [{ field: 'file', filename: 'upload', mime: m.mime, bytes: m.bytes }]
  );
  try {
    const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
    const res = await fetch(`${scheme}://${host}/api/v2/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': contentType },
      body: body as BodyInit,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${host} refused the image: ${text.slice(0, 160)}` };
    const parsed = JSON.parse(text) as { id?: string };
    if (!parsed.id) return { ok: false, error: `${host} stored the image but returned no id.` };
    return { ok: true, id: parsed.id };
  } catch (e) {
    return { ok: false, error: `Could not reach ${host}: ${(e as Error).message}` };
  }
}
