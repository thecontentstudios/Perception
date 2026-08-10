import type { Channel } from '../types';
import type { Publisher } from './types';
import { fetchBlueskyMetrics, graphemeLength, publishToBluesky } from './bluesky';
import { mastodonContext, mastodonPublisher } from './mastodon';
import { facebookPublisher } from './meta';
import { instagramPublisher, threadsPublisher } from './meta-family';
import { redditPublisher } from './reddit';
import { pinterestPublisher } from './pinterest';
import { gbpPublisher } from './gbp';
import { summaries } from '../oauth/store';

const MAX_GRAPHEMES = 300;

/**
 * The DID and handle Bluesky needs, read from the stored grant — the same
 * lookup `/api/publish` was doing inline. Null when nothing is connected.
 */
function blueskyContext(): { did: string; handle: string; label: string } | null {
  const grant = summaries().find((g) => g.channel === 'bluesky');
  if (!grant) return null;
  return {
    did: grant.externalAccountId,
    handle: grant.accountLabel.replace(/^@/, ''),
    label: grant.accountLabel,
  };
}

/**
 * One place that answers "can this channel actually publish, and how".
 *
 * The worker needs this. It is handed a row that says `channel: 'bluesky'` and
 * has no business knowing that Bluesky wants a DID and Mastodon wants a
 * hostname — that is exactly what the Publisher interface is for. Until now
 * `/api/publish` branched on the channel by hand, which was fine for two
 * channels called from one place and stops being fine the moment a background
 * process needs the same answer.
 */

/** Bluesky behind the shared interface, so callers stop special-casing it. */
export const blueskyPublisher: Publisher = {
  capabilities: {
    channel: 'bluesky',
    maxLength: MAX_GRAPHEMES,
    // Bluesky counts graphemes: a family emoji is one character, not eleven.
    lengthUnit: 'grapheme',
    limitIsPerInstance: false,
  },

  measure: (text) => graphemeLength(text),

  check(text) {
    const length = this.measure(text);
    if (length === 0) return { ok: false, length, error: 'Nothing to post.' };
    if (length > MAX_GRAPHEMES) {
      return { ok: false, length, error: `Too long for Bluesky: ${length} of ${MAX_GRAPHEMES} characters.` };
    }
    return { ok: true, length };
  },

  async publish(text, opts) {
    const ctx = blueskyContext();
    if (!ctx) return { ok: false, error: 'Bluesky is not connected.', needsReconnect: true };
    const r = await publishToBluesky(text, { ...ctx, idempotencyKey: opts.idempotencyKey, media: opts.media });
    return { ok: r.ok, id: r.uri, url: r.url, error: r.error, needsReconnect: r.needsReconnect };
  },

  async verify() {
    const ctx = blueskyContext();
    return ctx
      ? { ok: true, account: ctx.label }
      : { ok: false, error: 'Bluesky is not connected.' };
  },

  fetchMetrics: (postId: string) => fetchBlueskyMetrics(postId),
};

const REGISTRY: Partial<Record<Channel, Publisher>> = {
  bluesky: blueskyPublisher,
  mastodon: mastodonPublisher,
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  threads: threadsPublisher,
  reddit: redditPublisher,
  pinterest: pinterestPublisher,
  google_business: gbpPublisher,
};

/** The publisher for a channel, or null when nothing can publish it yet. */
export function publisherFor(channel: Channel): Publisher | null {
  return REGISTRY[channel] ?? null;
}

/**
 * Whether this channel is publishable *right now* — implemented and holding a
 * live grant. Sixteen of the eighteen channels are modeled but not wired, and
 * the honest answer matters more than a long list.
 */
export function canPublish(channel: Channel): boolean {
  if (channel === 'bluesky') return blueskyContext() !== null;
  if (channel === 'mastodon') return mastodonContext() !== null;
  if (['facebook', 'instagram', 'threads', 'reddit', 'pinterest', 'google_business'].includes(channel)) {
    return summaries().some((g) => g.channel === channel);
  }
  return false;
}

export const LIVE_CHANNELS = Object.keys(REGISTRY) as Channel[];
