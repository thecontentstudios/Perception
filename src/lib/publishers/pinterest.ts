import { getAccessToken, summaries } from '../oauth/store';
import type { PostMetrics, Publisher, PublishOutcome } from './types';

/**
 * Pinterest pins over API v5.
 *
 * Pinterest is the second platform (after Instagram) where a post *is* an
 * image — there is no text-only pin — and like Instagram it fetches the
 * image from a URL rather than accepting bytes. Unlike everything else so
 * far, a pin lands on a **board**, which rides on the grant. And it is the
 * platform where the link matters most: a pin is closer to a shop-window
 * card than a feed post, and Pinterest reports outbound clicks on it.
 */

const BASE = () => (process.env.PINTEREST_BASE_URL ?? 'https://api.pinterest.com').replace(/\/+$/, '');

function ctx(): { boardId: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === 'pinterest');
  if (!grant) return null;
  return { boardId: grant.externalAccountId, label: grant.accountLabel };
}

export const pinterestPublisher: Publisher = {
  capabilities: { channel: 'pinterest', maxLength: 800, lengthUnit: 'utf16', limitIsPerInstance: false },
  measure: (text) => text.length,
  check(text) {
    const length = this.measure(text);
    if (length > 800) return { ok: false, length, error: `Pinterest descriptions cap at 800 characters; this is ${length}.` };
    return { ok: true, length };
  },

  async publish(text, opts): Promise<PublishOutcome> {
    const c = ctx();
    const token = getAccessToken('pinterest');
    if (!c || !token) return { ok: false, error: 'Pinterest is not connected.', needsReconnect: true };

    const m = (opts.media ?? [])[0];
    if (!m) {
      return { ok: false, error: 'Pinterest has no text-only pins — a pin is an image. Attach one, or leave Pinterest out of this campaign.' };
    }
    if (!m.publicUrl) {
      return { ok: false, error: 'Pinterest fetches images from a public URL, and this deployment has no public address for its media (set APP_URL).' };
    }
    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    const [title, ...rest] = text.split('\n');
    try {
      const res = await fetch(`${BASE()}/v5/pins`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          board_id: c.boardId,
          title: title.trim().slice(0, 100),
          description: rest.join('\n').trim() || title.trim(),
          alt_text: m.altText ?? undefined,
          media_source: { source_type: 'image_url', url: m.publicUrl },
        }),
      });
      const parsed = (await res.json().catch(() => ({}))) as { id?: string; message?: string; code?: number };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'The Pinterest token was revoked or lacks pin scope.', needsReconnect: true };
      }
      if (!res.ok) return { ok: false, error: `Pinterest rejected the pin: ${parsed.message ?? res.status}` };
      if (!parsed.id) return { ok: false, error: 'Pinterest accepted the pin but returned no id.' };
      return { ok: true, id: parsed.id, url: `https://www.pinterest.com/pin/${parsed.id}/` };
    } catch (e) {
      return { ok: false, error: `Could not reach Pinterest: ${(e as Error).message}` };
    }
  },

  async verify() {
    const c = ctx();
    return c ? { ok: true, account: c.label } : { ok: false, error: 'Pinterest is not connected.' };
  },

  /**
   * Impressions, saves and outbound clicks — Pinterest reports all three,
   * and the click number is the platform's own, kept beside ours as always.
   */
  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const token = getAccessToken('pinterest');
    if (!token) return { ok: false, error: 'Pinterest is not connected.' };
    try {
      const res = await fetch(`${BASE()}/v5/pins/${encodeURIComponent(postId)}/analytics?metric_types=IMPRESSION,SAVE,OUTBOUND_CLICK`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
      if (!res.ok) return { ok: false, error: `Pinterest returned ${res.status}.` };
      const body = (await res.json()) as { all?: { lifetime_metrics?: Record<string, number> } };
      const m = body.all?.lifetime_metrics ?? {};
      return {
        ok: true,
        metrics: {
          impressions: m.IMPRESSION ?? null,
          engagements: m.SAVE ?? null,
          clicks: m.OUTBOUND_CLICK ?? null,
        },
      };
    } catch (e) {
      return { ok: false, error: `Could not reach Pinterest: ${(e as Error).message}` };
    }
  },
};
