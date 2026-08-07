import { getAccessToken, summaries } from '../oauth/store';
import type { PostMetrics, Publisher, PublishOutcome } from './types';

/**
 * Reddit posting — the first non-Meta, non-fediverse publisher.
 *
 * Different again, which is what keeps the contract honest: OAuth bearer
 * *plus* a mandatory User-Agent (Reddit rejects anonymous UAs), form-encoded
 * submit, and a success envelope `{ json: { errors: [], data: { name } } }`
 * where errors arrive inside a 200. A post goes to a *subreddit*, carried on
 * the grant — usually the business's own community or profile (u_username).
 *
 * Metrics: score and comment count are public on the thing itself.
 * `view_count` exists in the response and is null for everyone but the
 * subreddit's own moderators — the REPORTS table already says so, and this
 * adapter returns impressions as the honest null it is.
 */

const BASE = () => (process.env.REDDIT_BASE_URL ?? 'https://oauth.reddit.com').replace(/\/+$/, '');
const UA = 'perception-campaign-os/1.0';

function grantCtx(): { subreddit: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === 'reddit');
  if (!grant) return null;
  return { subreddit: grant.externalAccountId, label: grant.accountLabel };
}

export const redditPublisher: Publisher = {
  capabilities: { channel: 'reddit', maxLength: 300, lengthUnit: 'utf16', limitIsPerInstance: false },

  // The 300 limit is the *title*; body text is effectively unbounded. Our
  // posts submit as self posts with the first line as title.
  measure: (text) => text.split('\n')[0].length,

  check(text) {
    const length = this.measure(text);
    if (text.trim().length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > 300) return { ok: false, length, error: `Reddit titles cap at 300 characters; the first line is ${length}.` };
    return { ok: true, length };
  },

  async publish(text, _opts): Promise<PublishOutcome> {
    const ctx = grantCtx();
    const token = getAccessToken('reddit');
    if (!ctx || !token) return { ok: false, error: 'Reddit is not connected.', needsReconnect: true };

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    const [title, ...rest] = text.split('\n');
    try {
      const res = await fetch(`${BASE()}/api/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          sr: ctx.subreddit,
          kind: 'self',
          title: title.trim(),
          text: rest.join('\n').trim(),
          api_type: 'json',
        }).toString(),
      });
      const body = (await res.json().catch(() => ({}))) as {
        json?: { errors?: unknown[][]; data?: { name?: string; url?: string } };
      };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'The Reddit token was revoked or lacks submit scope.', needsReconnect: true };
      }
      // Reddit's signature move: errors inside a 200.
      const errors = body.json?.errors ?? [];
      if (!res.ok || errors.length > 0) {
        return { ok: false, error: `Reddit rejected the post: ${JSON.stringify(errors[0] ?? res.status).slice(0, 160)}` };
      }
      const name = body.json?.data?.name;
      if (!name) return { ok: false, error: 'Reddit accepted the post but returned no id.' };
      return { ok: true, id: name, url: body.json?.data?.url };
    } catch (e) {
      return { ok: false, error: `Could not reach Reddit: ${(e as Error).message}` };
    }
  },

  async verify() {
    const ctx = grantCtx();
    return ctx ? { ok: true, account: ctx.label } : { ok: false, error: 'Reddit is not connected.' };
  },

  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const token = getAccessToken('reddit');
    if (!token) return { ok: false, error: 'Reddit is not connected.' };
    try {
      const res = await fetch(`${BASE()}/api/info?id=${encodeURIComponent(postId)}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      });
      if (!res.ok) return { ok: false, error: `Reddit returned ${res.status}.` };
      const body = (await res.json()) as { data?: { children?: { data?: { score?: number; num_comments?: number } }[] } };
      const post = body.data?.children?.[0]?.data;
      if (!post) return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
      return {
        ok: true,
        // view_count is moderator-only; claiming reach here would be a guess.
        metrics: { impressions: null, engagements: (post.score ?? 0) + (post.num_comments ?? 0), clicks: null },
      };
    } catch (e) {
      return { ok: false, error: `Could not reach Reddit: ${(e as Error).message}` };
    }
  },
};
