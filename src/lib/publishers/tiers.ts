import type { Channel } from '../types';
import { LIVE_CHANNELS } from './registry';

/**
 * What each channel genuinely is, stated once.
 *
 * Eighteen channels are modelled and five publish. The gap between those
 * numbers is not one fact but three, and a screen that shows a single
 * "coming soon" for all of them tells the owner nothing they can act on:
 *
 * - `feasible`   — a public API exists and needs only build time.
 * - `approval_gated` — the API exists behind a review queue or a paid tier;
 *                  the code can be built, but shipping waits on a third
 *                  party's timeline, and pretending otherwise sets a date
 *                  we do not control.
 * - `no_api`     — the platform offers no organic publishing API to anyone.
 *                  No amount of work here changes that, so the honest move
 *                  is to say it and route that budget to the ad brief,
 *                  which those platforms do support.
 *
 * `live` is computed from the registry rather than written here, so this
 * file cannot claim a channel the code cannot deliver.
 */

export type PublisherTier = 'live' | 'feasible' | 'approval_gated' | 'no_api';

interface TierFact {
  tier: Exclude<PublisherTier, 'live'>;
  /** One sentence the screen can show, in the owner's language. */
  reason: string;
  /** For no_api channels: where that budget can still go. */
  alternative?: string;
}

const FACTS: Partial<Record<Channel, TierFact>> = {
  // Public APIs, build time only.
  pinterest: { tier: 'feasible', reason: 'Pinterest has a public API for pins. On the build list.' },
  reddit: { tier: 'feasible', reason: 'Reddit has a public posting API. On the build list.' },
  google_business: { tier: 'feasible', reason: 'Google Business Profile posts have an API once the listing is verified.' },

  // APIs behind review queues or paid tiers — buildable, not promisable.
  x: { tier: 'approval_gated', reason: 'X requires a paid API plan for posting. Built when an account carries one.' },
  linkedin: { tier: 'approval_gated', reason: 'LinkedIn page posting needs Marketing API approval — weeks, on their clock.' },
  tiktok: { tier: 'approval_gated', reason: 'TikTok content posting is gated behind app review.' },
  youtube: { tier: 'approval_gated', reason: 'YouTube uploads need OAuth verification and are video-first.' },
  whatsapp: { tier: 'approval_gated', reason: 'WhatsApp Business messaging requires Meta business verification and approved templates.' },

  // No organic publishing API exists. Not "later" — nobody has one.
  nextdoor: {
    tier: 'no_api',
    reason: 'Nextdoor offers no posting API to anyone — posts can only be written in their own app.',
    alternative: 'Its neighbourhood ads are real: plan a flight and the brief hands off to Nextdoor Ads.',
  },
  snapchat: {
    tier: 'no_api',
    reason: 'Snapchat has no organic posting API — only ads.',
    alternative: 'Reach under-25s there with a flight; the brief hands off to Snapchat Ads Manager.',
  },

  // Channels that publish through our own senders rather than a social API.
  email: { tier: 'feasible', reason: 'Sends through the campaign composer, not the social pipeline.' },
  sms: { tier: 'feasible', reason: 'Sends through the campaign composer, not the social pipeline.' },
  website: { tier: 'feasible', reason: 'Your own site — the snippet measures it; publishing is your CMS.' },
};

export function publisherTier(channel: Channel): { tier: PublisherTier; reason: string; alternative?: string } {
  if ((LIVE_CHANNELS as Channel[]).includes(channel)) {
    return { tier: 'live', reason: 'Publishes from here today.' };
  }
  const fact = FACTS[channel];
  if (!fact) return { tier: 'feasible', reason: 'A public API exists. On the build list.' };
  return fact;
}

export const TIER_LABEL: Record<PublisherTier, string> = {
  live: 'Publishes now',
  feasible: 'Buildable next',
  approval_gated: 'Waiting on their approval',
  no_api: 'No posting API exists',
};
