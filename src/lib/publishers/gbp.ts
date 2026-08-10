import { getAccessToken, summaries } from '../oauth/store';
import type { PostMetrics, Publisher, PublishOutcome } from './types';

/**
 * Google Business Profile posts.
 *
 * The channel that reaches somebody *searching for you right now* — a post
 * shows on the business's own listing in Search and Maps. Text-first (the
 * one image is optional and fetched by URL), and the id it returns is a
 * resource *name* (`accounts/x/locations/y/localPosts/z`), which is the id
 * everything else here must carry.
 *
 * Post insights report views and click-throughs and no like count —
 * `REPORTS` says so, because nobody can have a number Google does not keep.
 */

const BASE = () => (process.env.GBP_BASE_URL ?? 'https://mybusiness.googleapis.com').replace(/\/+$/, '');

function ctx(): { location: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === 'google_business');
  if (!grant) return null;
  return { location: grant.externalAccountId, label: grant.accountLabel };
}

export const gbpPublisher: Publisher = {
  capabilities: { channel: 'google_business', maxLength: 1500, lengthUnit: 'utf16', limitIsPerInstance: false },
  measure: (text) => text.length,
  check(text) {
    const length = this.measure(text);
    if (length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > 1500) return { ok: false, length, error: `Google Business posts cap at 1500 characters; this is ${length}.` };
    return { ok: true, length };
  },

  async publish(text, opts): Promise<PublishOutcome> {
    const c = ctx();
    const token = getAccessToken('google_business');
    if (!c || !token) return { ok: false, error: 'Google Business is not connected.', needsReconnect: true };

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    const m = (opts.media ?? [])[0];
    try {
      const res = await fetch(`${BASE()}/v4/${c.location}/localPosts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          languageCode: 'en-US',
          summary: text,
          topicType: 'STANDARD',
          ...(m?.publicUrl ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: m.publicUrl }] } : {}),
        }),
      });
      const parsed = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string; code?: number } };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'The Google token was revoked or lacks business.manage scope.', needsReconnect: true };
      }
      if (!res.ok) return { ok: false, error: `Google Business rejected the post: ${parsed.error?.message ?? res.status}` };
      if (!parsed.name) return { ok: false, error: 'Google Business accepted the post but returned no name.' };
      const out: PublishOutcome = { ok: true, id: parsed.name };
      if (m && !m.publicUrl) {
        return { ...out, error: 'Posted without the image: it has no public address for Google to fetch (set APP_URL).' };
      }
      return out;
    } catch (e) {
      return { ok: false, error: `Could not reach Google Business: ${(e as Error).message}` };
    }
  },

  async verify() {
    const c = ctx();
    return c ? { ok: true, account: c.label } : { ok: false, error: 'Google Business is not connected.' };
  },

  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const token = getAccessToken('google_business');
    if (!token) return { ok: false, error: 'Google Business is not connected.' };
    try {
      // Insights hang off the parent location, asking about named posts.
      const parent = postId.split('/localPosts/')[0];
      const res = await fetch(`${BASE()}/v4/${parent}/localPosts:reportInsights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          localPostNames: [postId],
          basicRequest: { metricRequests: [{ metric: 'LOCAL_POST_VIEWS_SEARCH' }, { metric: 'LOCAL_POST_ACTIONS_CALL_TO_ACTION' }] },
        }),
      });
      if (res.status === 404) return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
      if (!res.ok) return { ok: false, error: `Google Business returned ${res.status}.` };
      const body = (await res.json()) as {
        localPostMetrics?: { metricValues?: { metric?: string; totalValue?: { value?: string } }[] }[];
      };
      const values = body.localPostMetrics?.[0]?.metricValues ?? [];
      const val = (name: string) => {
        const v = values.find((x) => x.metric === name)?.totalValue?.value;
        return v == null ? null : Number(v);
      };
      return {
        ok: true,
        metrics: {
          impressions: val('LOCAL_POST_VIEWS_SEARCH'),
          // Google keeps no like count on posts; nothing to pretend about.
          engagements: null,
          clicks: val('LOCAL_POST_ACTIONS_CALL_TO_ACTION'),
        },
      };
    } catch (e) {
      return { ok: false, error: `Could not reach Google Business: ${(e as Error).message}` };
    }
  },
};
