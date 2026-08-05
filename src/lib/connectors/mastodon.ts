import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import { capabilityChecks, simulatedOperations, warning, type ConnectorAdapter } from './contract';

/**
 * Mastodon — the second connector that needs no gatekeeper.
 *
 * Like Bluesky it can be connected today: a user creates an access token in
 * their own instance's Preferences → Development, and that is the whole
 * onboarding. Unlike Bluesky it is a plain REST API on a *user-chosen host*,
 * which is exactly why it is a good test of the connector abstraction — the
 * base URL is per-account, not a constant.
 */
export const mastodonAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'mastodon',
    api: 'Mastodon REST API v1',
    availability: 'mvp',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: null,
    // The default is 500, but instances configure their own limit; the live
    // publisher reads the real value from /api/v1/instance on connect.
    maxChars: 500,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'No app review and no developer console: the owner creates an access token in their own instance settings. Character limit and media rules vary per instance and are read at connect time.',
  },

  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out = capabilityChecks(this.capabilities, variation, assets);
    // Content warnings are a strong norm on Mastodon; long or spoiler-ish
    // posts without one get muted rather than reported, which is invisible.
    if (variation.body.length > 400 && !variation.subject) {
      out.push(
        warning(
          'mastodon-no-cw',
          'info',
          'Long post with no content warning — many Mastodon users filter these.',
          'Add a short summary as the content warning.'
        )
      );
    }
    return out;
  },

  ...simulatedOperations('mastodon'),
};
