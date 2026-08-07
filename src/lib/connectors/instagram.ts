import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import {
  capabilityChecks,
  simulatedOperations,
  warning,
  type ConnectorAdapter,
} from './contract';

export const instagramAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'instagram',
    api: 'Instagram Graph API (professional accounts)',
    availability: 'mvp',
    formats: ['post', 'reel', 'story'],
    allowedRatios: ['1:1', '4:5', '1.91:1'],
    maxVideoSec: 90,
    maxChars: 2200,
    maxHashtags: 30,
    supportsNativeScheduling: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Requires an Instagram professional account linked to a Facebook Page; content publishing scopes go through Meta App Review. No native scheduling — Perception publishes at the scheduled minute.',
  },

  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[] {
    const out: PreflightWarning[] = [];
    const vertical = variation.format === 'reel' || variation.format === 'story';

    if (vertical) {
      // Reels/Stories: vertical video; ratio rules differ from feed images.
      for (const asset of assets) {
        if (asset.kind === 'video' && (asset.durationSec ?? 0) > 90) {
          out.push(
            warning(
              'video-too-long',
              'block',
              `This video is too long for this destination (${asset.durationSec}s — Instagram Reels allow up to 90s here).`,
              'Trim the video or publish the full cut to YouTube instead.'
            )
          );
        }
        if (asset.aspectRatio !== '9:16') {
          out.push(
            warning(
              'image-ratio',
              'warn',
              `Instagram ${variation.format === 'reel' ? 'Reels' : 'Stories'} are vertical — “${asset.name}” is ${asset.aspectRatio}, expected 9:16.`,
              'Crop to 9:16 or pick a vertical asset.'
            )
          );
        }
      }
      // Text limits still apply to captions.
      const caps = { ...this.capabilities, allowedRatios: null, maxVideoSec: null };
      out.push(...capabilityChecks(caps, variation, assets));
      return out;
    }

    return capabilityChecks(this.capabilities, variation, assets);
  },

  ...simulatedOperations('instagram'),
};
