import { getAccessToken, summaries } from '../oauth/store';
import type { Channel } from '../types';
import type { MediaAttachment, PostMetrics, Publisher, PublishOutcome } from './types';

/**
 * Instagram and Threads — the two-step half of the Meta family.
 *
 * Both publish the same way and neither publishes like Facebook: first a
 * *container* is created with the content, then a second call publishes it.
 * The split exists because processing is asynchronous on Meta's side, and it
 * gives these adapters a failure mode Facebook does not have — a container
 * that is created and never published is invisible everywhere except the
 * error log.
 *
 * The honest differences between the two are the interesting part:
 *
 * - **Instagram cannot post text.** The API has no caption-only container;
 *   a feed post *is* media. The adapter refuses with that sentence rather
 *   than silently skipping the channel or faking a text card.
 * - **Instagram fetches; it does not accept uploads.** The container takes
 *   `image_url` and Meta's fetchers download it, which means the media
 *   library must be publicly reachable. On localhost that is a hard fact,
 *   and the adapter says it instead of handing Meta an unreachable URL and
 *   reporting whatever timeout comes back.
 * - **Threads is text-first.** Same wire shape, text welcome, media
 *   optional — which is exactly why the two share this file: the contrast
 *   is the documentation.
 */

const GRAPH = () => (process.env.META_BASE_URL ?? 'https://graph.facebook.com').replace(/\/+$/, '');
const THREADS = () => (process.env.THREADS_BASE_URL ?? 'https://graph.threads.net').replace(/\/+$/, '');

function grantFor(channel: Channel): { accountId: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === channel);
  if (!grant) return null;
  return { accountId: grant.externalAccountId, label: grant.accountLabel };
}

function reconnectCode(code: number): boolean {
  return code === 190 || (code >= 200 && code <= 299);
}

/** POST a form to a Graph-shaped endpoint, token as a parameter. */
async function post(
  base: string,
  path: string,
  channel: Channel,
  form: Record<string, string>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: number; message: string; status: number }> {
  const token = getAccessToken(channel);
  if (!token) return { ok: false, code: 190, message: `${channel} is not connected.`, status: 0 };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, access_token: token }).toString(),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      const err = (parsed.error ?? {}) as { code?: number; message?: string };
      return { ok: false, code: err.code ?? 0, message: err.message ?? `returned ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, code: -1, message: `Could not reach the API: ${(e as Error).message}`, status: 0 };
  }
}

async function get(
  base: string,
  path: string,
  channel: Channel
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: number; message: string; status: number }> {
  const token = getAccessToken(channel);
  if (!token) return { ok: false, code: 190, message: `${channel} is not connected.`, status: 0 };
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${base}${path}${sep}access_token=${encodeURIComponent(token)}`);
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      const err = (parsed.error ?? {}) as { code?: number; message?: string };
      return { ok: false, code: err.code ?? 0, message: err.message ?? `returned ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, code: -1, message: `Could not reach the API: ${(e as Error).message}`, status: 0 };
  }
}

/** Container → publish, the dance both platforms share. */
async function twoStep(
  base: string,
  channel: Channel,
  accountId: string,
  edge: { container: string; publish: string },
  containerForm: Record<string, string>
): Promise<PublishOutcome> {
  const created = await post(base, `/${edge.container.replace('{id}', accountId)}`, channel, containerForm);
  if (!created.ok) {
    return { ok: false, error: `${channel} refused the post: ${created.message}`, needsReconnect: reconnectCode(created.code) };
  }
  const creationId = String(created.data.id ?? '');
  if (!creationId) return { ok: false, error: `${channel} created no container id.` };

  const published = await post(base, `/${edge.publish.replace('{id}', accountId)}`, channel, { creation_id: creationId });
  if (!published.ok) {
    return {
      ok: false,
      error: `${channel} accepted the content but failed to publish it (container ${creationId}): ${published.message}`,
      needsReconnect: reconnectCode(published.code),
    };
  }
  const id = String(published.data.id ?? '');
  if (!id) return { ok: false, error: `${channel} published but returned no id.` };
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

export const instagramPublisher: Publisher = {
  capabilities: {
    channel: 'instagram',
    maxLength: 2200,
    lengthUnit: 'utf16',
    limitIsPerInstance: false,
  },

  measure: (text) => text.length,

  check(text) {
    const length = this.measure(text);
    if (length > 2200) return { ok: false, length, error: `Too long for an Instagram caption: ${length} of 2200.` };
    return { ok: true, length };
  },

  async publish(text, opts): Promise<PublishOutcome> {
    const ctx = grantFor('instagram');
    if (!ctx) return { ok: false, error: 'Instagram is not connected.', needsReconnect: true };

    const media = opts.media ?? [];
    if (media.length === 0) {
      // Not a limitation of this adapter — a fact about the platform. The
      // API has no caption-only container; an Instagram feed post is media.
      return { ok: false, error: 'Instagram has no text-only posts — a feed post is a photo. Attach an image, or leave Instagram out of this campaign.' };
    }
    const m = media[0];
    if (!m.publicUrl) {
      return {
        ok: false,
        error: 'Instagram fetches images from a public URL rather than accepting an upload, and this deployment has no public address for its media (set APP_URL). The image cannot reach Instagram from here.',
      };
    }

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    return twoStep(GRAPH(), 'instagram', ctx.accountId, { container: 'v21.0/{id}/media', publish: 'v21.0/{id}/media_publish' }, {
      image_url: m.publicUrl,
      caption: text,
      ...(m.altText ? { alt_text: m.altText } : {}),
    });
  },

  async verify() {
    const ctx = grantFor('instagram');
    return ctx ? { ok: true, account: ctx.label } : { ok: false, error: 'Instagram is not connected.' };
  },

  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const r = await get(GRAPH(), `/v21.0/${encodeURIComponent(postId)}/insights?metric=impressions,likes,comments,shares`, 'instagram');
    if (!r.ok && r.status === 404) {
      return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
    }
    if (!r.ok) return { ok: false, error: r.message };
    const series = (r.data.data ?? []) as { name?: string; values?: { value?: number }[] }[];
    const val = (name: string) => series.find((d) => d.name === name)?.values?.[0]?.value ?? null;
    const impressions = val('impressions');
    const engagements = (val('likes') ?? 0) + (val('comments') ?? 0) + (val('shares') ?? 0);
    return { ok: true, metrics: { impressions, engagements, clicks: null } };
  },
};

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const threadsPublisher: Publisher = {
  capabilities: {
    channel: 'threads',
    maxLength: 500,
    lengthUnit: 'utf16',
    limitIsPerInstance: false,
  },

  measure: (text) => text.length,

  check(text) {
    const length = this.measure(text);
    if (length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > 500) return { ok: false, length, error: `Too long for Threads: ${length} of 500 characters.` };
    return { ok: true, length };
  },

  async publish(text, opts): Promise<PublishOutcome> {
    const ctx = grantFor('threads');
    if (!ctx) return { ok: false, error: 'Threads is not connected.', needsReconnect: true };

    const local = this.check(text);
    if (!local.ok) return { ok: false, error: local.error };

    const m = (opts.media ?? [])[0];
    // Text-first: media is welcome and optional, the opposite of Instagram —
    // and an image without a public URL degrades to the text post the owner
    // still gets, stated in the outcome rather than silently.
    const form =
      m && m.publicUrl
        ? { media_type: 'IMAGE', image_url: m.publicUrl, text, ...(m.altText ? { alt_text: m.altText } : {}) }
        : { media_type: 'TEXT', text };

    const out = await twoStep(THREADS(), 'threads', ctx.accountId, { container: 'v1.0/{id}/threads', publish: 'v1.0/{id}/threads_publish' }, form);
    if (out.ok && m && !m.publicUrl) {
      return { ...out, error: 'Posted as text: the image has no public address for Threads to fetch (set APP_URL).' };
    }
    return out;
  },

  async verify() {
    const ctx = grantFor('threads');
    return ctx ? { ok: true, account: ctx.label } : { ok: false, error: 'Threads is not connected.' };
  },

  async fetchMetrics(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }> {
    const r = await get(THREADS(), `/v1.0/${encodeURIComponent(postId)}/insights?metric=views,likes,replies,reposts,quotes`, 'threads');
    if (!r.ok && r.status === 404) {
      return { ok: true, metrics: { impressions: null, engagements: null, clicks: null, missing: true } };
    }
    if (!r.ok) return { ok: false, error: r.message };
    const series = (r.data.data ?? []) as { name?: string; values?: { value?: number }[] }[];
    const val = (name: string) => series.find((d) => d.name === name)?.values?.[0]?.value ?? null;
    const engagements = (val('likes') ?? 0) + (val('replies') ?? 0) + (val('reposts') ?? 0) + (val('quotes') ?? 0);
    return { ok: true, metrics: { impressions: val('views'), engagements, clicks: null } };
  },
};
