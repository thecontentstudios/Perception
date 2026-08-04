import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import { capabilityChecks, simulatedOperations, type ConnectorAdapter } from './contract';

export const linkedinAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'linkedin',
    api: 'LinkedIn Posts API',
    availability: 'mvp',
    formats: ['post'],
    allowedRatios: null,
    maxVideoSec: 900,
    maxChars: 3000,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Marketing Developer Platform approval required for organization posting; member posting uses the standard Share on LinkedIn product.',
  },

  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    return capabilityChecks(this.capabilities, variation, assets);
  },

  ...simulatedOperations('linkedin'),
};
