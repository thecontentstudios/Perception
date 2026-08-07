import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import {
  capabilityChecks,
  simulatedOperations,
  warning,
  type ConnectorAdapter,
} from './contract';

export const googleBusinessAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'google_business',
    api: 'Google Business Profile API (local posts)',
    availability: 'mvp',
    formats: ['update'],
    allowedRatios: ['4:3', '1:1', '16:9'],
    maxVideoSec: null,
    maxChars: 1500,
    maxHashtags: null,
    supportsNativeScheduling: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Business Profile API access must be requested and approved per project; reviews and Q&A feed the inbox.',
  },

  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out: PreflightWarning[] = [];
    for (const asset of assets) {
      if (asset.kind === 'video') {
        out.push(
          warning(
            'unsupported-media',
            'block',
            'Google Business Profile updates don’t support video — this item can’t be published with this file.',
            'Swap in a photo here; the video stays on Instagram and Facebook.'
          )
        );
      }
    }
    out.push(...capabilityChecks(this.capabilities, variation, assets));
    return out;
  },

  ...simulatedOperations('google_business'),
};
