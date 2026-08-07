import type { Channel } from '../types';
import type { ConnectorAdapter } from './contract';
import { facebookAdapter } from './facebook';
import { mastodonAdapter } from './mastodon';
import { instagramAdapter } from './instagram';
import { linkedinAdapter } from './linkedin';
import { googleBusinessAdapter } from './google-business';
import { emailAdapter } from './email';
import { smsAdapter, tiktokAdapter, websiteAdapter, youtubeAdapter } from './planned';
import {
  blueskyAdapter,
  nextdoorAdapter,
  pinterestAdapter,
  redditAdapter,
  snapchatAdapter,
  threadsAdapter,
  whatsappAdapter,
  xAdapter,
} from './expansion';

/**
 * One registry, one contract. Adding a destination = writing an adapter and
 * registering it here; the campaign system, calendar, preflight engine, and
 * publishing workers pick it up unchanged.
 */
export const CONNECTORS: Record<Channel, ConnectorAdapter> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  linkedin: linkedinAdapter,
  google_business: googleBusinessAdapter,
  email: emailAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  x: xAdapter,
  threads: threadsAdapter,
  bluesky: blueskyAdapter,
  mastodon: mastodonAdapter,
  pinterest: pinterestAdapter,
  reddit: redditAdapter,
  nextdoor: nextdoorAdapter,
  snapchat: snapchatAdapter,
  whatsapp: whatsappAdapter,
  sms: smsAdapter,
  website: websiteAdapter,
};

export function adapterFor(channel: Channel): ConnectorAdapter {
  return CONNECTORS[channel];
}
