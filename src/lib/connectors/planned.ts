import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import {
  capabilityChecks,
  simulatedOperations,
  warning,
  type ConnectorAdapter,
} from './contract';

/**
 * Second-wave adapters. They implement the same contract as the MVP
 * connectors so wiring them in later is a registry change, not a rewrite.
 * Their capability sheets already drive validation and the Connections
 * screen, which is why platform-review work can start before the UI ships.
 */

export const tiktokAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'tiktok',
    api: 'TikTok Content Posting API',
    availability: 'planned',
    formats: ['reel'],
    allowedRatios: ['9:16'],
    maxVideoSec: 600,
    maxChars: 2200,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Supports direct publishing and draft upload — but unaudited apps are restricted to private/draft uploads. The content audit must be scheduled early.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('tiktok'),
};

export const youtubeAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'youtube',
    api: 'YouTube Data API v3',
    availability: 'planned',
    formats: ['video', 'reel'],
    allowedRatios: ['16:9', '9:16'],
    maxVideoSec: null,
    maxChars: 5000,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Video upload via the Data API; uploads from unaudited API projects are locked private until the project passes a compliance audit. Quota costs make bulk publishing expensive.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },
  ...simulatedOperations('youtube'),
};

export const smsAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'sms',
    api: 'Messaging provider (Twilio or similar)',
    availability: 'planned',
    formats: ['sms'],
    allowedRatios: null,
    maxVideoSec: null,
    maxChars: 459,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'US traffic requires 10DLC campaign registration; recipients need prior consent and every message needs opt-out language.',
  },
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out: PreflightWarning[] = [];
    const len = variation.body.length;
    if (len > 160) {
      out.push(
        warning(
          'sms-segments',
          'info',
          `This message is ${len} characters and will send as ${Math.ceil(len / 153)} segments (billed separately).`,
          'Tighten the text to 160 characters for a single segment.'
        )
      );
    }
    if (!/\bSTOP\b/i.test(variation.body)) {
      out.push(
        warning(
          'sms-no-optout',
          'block',
          'This text message has no opt-out language.',
          'Append “Reply STOP to opt out.” — required for commercial SMS.'
        )
      );
    }
    out.push(...capabilityChecks(this.capabilities, variation, assets));
    return out;
  },
  ...simulatedOperations('sms'),
};

export const websiteAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'website',
    api: 'WordPress REST API / Shopify Admin API / webhooks',
    availability: 'mvp',
    formats: ['banner', 'blog', 'landing_page'],
    allowedRatios: null,
    maxVideoSec: null,
    maxChars: null,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: false,
    reviewNotes:
      'Publishes banners, blog posts, and landing pages; conversion events (forms, bookings, purchases) flow back to campaign analytics via the tracking snippet.',
  },
  validate(variation: ChannelVariation, _assets: MediaAsset[]): PreflightWarning[] {
    const out: PreflightWarning[] = [];
    if (variation.format === 'landing_page' && !variation.cta) {
      out.push(
        warning(
          'landing-no-cta',
          'block',
          'This landing page has no call-to-action button.',
          'Every landing page needs the campaign’s action front and center.'
        )
      );
    }
    return out;
  },
  ...simulatedOperations('website'),
};
