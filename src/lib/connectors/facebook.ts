import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import { capabilityChecks, simulatedOperations, type ConnectorAdapter } from './contract';

export const facebookAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'facebook',
    api: 'Meta Graph API (Pages)',
    availability: 'mvp',
    formats: ['post', 'story'],
    allowedRatios: null,
    maxVideoSec: 14400,
    maxChars: 63206,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Meta App Review required for pages_manage_posts, pages_read_engagement, and Page metadata scopes.',
  },

  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },

  ...simulatedOperations('facebook'),
};
