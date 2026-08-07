import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import {
  capabilityChecks,
  simulatedOperations,
  warning,
  type ConnectorAdapter,
} from './contract';

/**
 * Expansion-wave adapters: the wider social/advertising landscape.
 *
 * Same contract as the MVP connectors — wiring one in is a registry change.
 * Capability sheets are deliberately honest about API reality: X posting is
 * behind paid API tiers, Nextdoor's posting API is partner-gated, Bluesky has
 * no ads product, Snapchat's organic surface is limited while its ads API is
 * open. The Ad HUD renders directly from these sheets, so what the product
 * promises never drifts from what the platforms actually allow.
 */

export const xAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'x',
    api: 'X API v2 (paid tiers)',
    availability: 'planned',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: 140,
    maxChars: 280,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Posting requires a paid API tier — per-app cost scales with volume. 280-character limit for standard accounts; X Ads runs separately through the X Ads API.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('x'),
};

export const threadsAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'threads',
    api: 'Threads API (Meta)',
    availability: 'planned',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: 300,
    maxChars: 500,
    maxHashtags: 1,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Official publishing API is generally available; rides on the same Meta app + review as Facebook/Instagram. One topic tag per post, 500-character limit.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('threads'),
};

export const blueskyAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'bluesky',
    api: 'AT Protocol (open)',
    availability: 'planned',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: 180,
    maxChars: 300,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsMetrics: false,
    supportsInboxEvents: true,
    reviewNotes:
      'Open protocol — no app review at all, the easiest connector to ship. No ads product and no official analytics; reach is organic only.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('bluesky'),
};

export const pinterestAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'pinterest',
    api: 'Pinterest API v5',
    availability: 'planned',
    formats: ['pin'],
    allowedRatios: ['2:3', '1:1', '9:16'],
    maxVideoSec: 900,
    maxChars: 500,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: false,
    reviewNotes:
      'Pins live for months, not hours — strongest for visual/planning niches (landscaping, interiors). 2:3 vertical images perform best. Standard app review; Pinterest Ads via the same API.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out = capabilityChecks(this.capabilities, variation, assets);
    if (!variation.cta?.url && !/https?:\/\//.test(variation.body)) {
      out.push(
        warning(
          'pin-no-link',
          'warn',
          'This Pin has no destination link — Pins are traffic drivers, not just images.',
          'Add the campaign link so saves and clicks land on your page.'
        )
      );
    }
    return out;
  },
  ...simulatedOperations('pinterest'),
};

export const redditAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'reddit',
    api: 'Reddit Data API',
    availability: 'planned',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: 900,
    maxChars: 40000,
    maxHashtags: 0,
    supportsNativeScheduling: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: false,
    supportsInboxEvents: true,
    reviewNotes:
      'Every subreddit has its own self-promotion rules — organic posting is community work, not broadcasting. Reddit Ads is the reliable paid path; the Data API covers organic posting under rate limits.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out = capabilityChecks(this.capabilities, variation, assets);
    if (variation.hashtags.length > 0) {
      out.push(
        warning(
          'reddit-hashtags',
          'warn',
          'Hashtags don’t exist on Reddit — they read as spam.',
          'Remove them; write for the specific community instead.'
        )
      );
    }
    return out;
  },
  ...simulatedOperations('reddit'),
};

export const nextdoorAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'nextdoor',
    api: 'Nextdoor (partner program)',
    availability: 'planned',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: null,
    maxChars: 10000,
    maxHashtags: 0,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: false,
    supportsInboxEvents: false,
    reviewNotes:
      'The neighborhood surface for local services — recommendations drive it. Business posting API is partner-gated: until access lands, Perception supports it as assisted manual publishing (reminder + ready-to-paste kit). Nextdoor Ads is open for local campaigns.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('nextdoor'),
};

export const snapchatAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'snapchat',
    api: 'Snap Marketing API (ads) / Public Profiles (limited)',
    availability: 'planned',
    formats: ['story'],
    allowedRatios: ['9:16'],
    maxVideoSec: 60,
    maxChars: 250,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: false,
    reviewNotes:
      'Reaches the under-25 audience others miss. Organic publishing API is limited to approved public profiles; Snap Ads (vertical video, strong local targeting) is the dependable path.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('snapchat'),
};

export const whatsappAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'whatsapp',
    api: 'WhatsApp Business Cloud API (Meta)',
    availability: 'planned',
    formats: ['message'],
    allowedRatios: null,
    maxVideoSec: null,
    maxChars: 1024,
    maxHashtags: 0,
    supportsNativeScheduling: true,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Marketing messages require pre-approved templates and customer opt-in — closer to SMS than to social. Click-to-WhatsApp ads run through Meta Ads Manager and are the usual growth path.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out = capabilityChecks(this.capabilities, variation, assets);
    if (!/\b(stop|opt.?out|unsubscribe)\b/i.test(variation.body)) {
      out.push(
        warning(
          'wa-no-optout',
          'block',
          'This WhatsApp message has no opt-out language.',
          'Template messages need a clear way out — add “Reply STOP to opt out.”'
        )
      );
    }
    return out;
  },
  ...simulatedOperations('whatsapp'),
};
