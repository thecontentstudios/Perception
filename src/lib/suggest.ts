import type { BrandIntel, BrandVoice, ProfileIntel } from './discovery';
import type { CampaignGoal, Channel, ContentFormat, MediaAsset } from './types';
import { CHANNEL_META } from './channels';

/**
 * The suggestion engine.
 *
 * Takes what discovery found and proposes specific posts. Every suggestion
 * must be able to answer "why this?" — a suggestion the owner can't trace
 * back to a fact about their business is just filler, and filler is what
 * makes people stop trusting generated content.
 *
 * So each carries `reasons[]`, and each reason points at the evidence:
 * an unused photo, a dormant profile, a live offer on the site, a service
 * page, a five-star review.
 *
 * PRODUCTION NOTE. Copy here is assembled deterministically from templates
 * conditioned on the brand's own voice profile and vocabulary. In production
 * this is the model call — but the *structure* stays: intel in, grounded
 * drafts with explicit provenance out, never auto-published.
 */

export type SuggestionSource =
  | 'live_offer'
  | 'service_page'
  | 'testimonial'
  | 'unused_media'
  | 'dormant_profile'
  | 'missing_profile'
  | 'seasonal'
  | 'faq';

export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  live_offer: 'Live offer on your site',
  service_page: 'Service you offer',
  testimonial: 'Customer review',
  unused_media: 'Unused photo',
  dormant_profile: 'Quiet profile',
  missing_profile: 'Missing profile',
  seasonal: 'Seasonal timing',
  faq: 'Question customers ask',
};

export interface Suggestion {
  id: string;
  title: string;
  /** The shared message; per-channel bodies hang off it. */
  coreMessage: string;
  channels: Channel[];
  format: ContentFormat;
  goal: CampaignGoal;
  source: SuggestionSource;
  /** Why we're proposing this, in the owner's terms. */
  reasons: string[];
  /** Per-channel copy, already adapted to each destination's conventions. */
  bodies: Partial<Record<Channel, string>>;
  mediaIds: string[];
  hashtags: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** 0–1 — drives ordering and the confidence chip. */
  score: number;
}

// ---------------------------------------------------------------------------
// Voice-aware phrasing
// ---------------------------------------------------------------------------

/** Adapt a sentence to the brand's observed register and emoji habit. */
function inVoice(text: string, voice: BrandVoice, emoji?: string): string {
  const withEmoji = voice.usesEmoji && emoji ? `${text} ${emoji}` : text;
  return voice.register === 'professional' || voice.register === 'technical'
    ? withEmoji.replace(/!/g, '.')
    : withEmoji;
}

/** Instagram/TikTok can't take a real link, so the CTA changes shape. */
function ctaFor(channel: Channel, label: string, url: string, hasLinkInBio: boolean): string {
  if (channel === 'instagram' || channel === 'tiktok') {
    return hasLinkInBio ? `${label} — link in bio.` : `${label} — details in the comments.`;
  }
  if (channel === 'x' || channel === 'bluesky' || channel === 'threads') return url;
  return `${label}: ${url}`;
}

function hashtagsFrom(words: string[], location: string | null): string[] {
  const base = words
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const local = location
    ? location.split(',')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
    : null;
  return [...new Set([...base, ...(local ? [local] : [])])].slice(0, 4);
}

/** Channels the brand can actually post to right now, best-first. */
function activeChannels(profiles: ProfileIntel[], allow: Channel[]): Channel[] {
  return profiles
    .filter((p) => p.found && allow.includes(p.channel))
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
    .map((p) => p.channel);
}

function linkInBio(profiles: ProfileIntel[]): boolean {
  return profiles.find((p) => p.channel === 'instagram')?.hasLinkInBio ?? true;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

const FEED: Channel[] = ['facebook', 'instagram', 'linkedin', 'google_business', 'x', 'threads', 'bluesky', 'nextdoor'];

export function suggestPosts(intel: BrandIntel, assets: MediaAsset[]): Suggestion[] {
  const out: Suggestion[] = [];
  const { site, profiles, media } = intel;
  const voice = site.voice.value;
  const cta = site.conversionUrl.value ?? `https://${site.domain}`;
  const bio = linkInBio(profiles);
  const feed = activeChannels(profiles, FEED);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  let n = 1;
  const id = () => `sg-${n++}`;

  const goalFor = (): CampaignGoal =>
    intel.industry === 'landscaping'
      ? 'quote_requests'
      : intel.industry === 'house_rentals'
        ? 'rental_inquiries'
        : intel.industry === 'music_studio'
          ? 'bookings'
          : 'trial_signups';

  const ctaLabel =
    intel.industry === 'landscaping'
      ? 'Request a Quote'
      : intel.industry === 'house_rentals'
        ? 'Book a Tour'
        : intel.industry === 'music_studio'
          ? 'Book a Session'
          : 'Start Free Trial';

  const build = (
    channels: Channel[],
    make: (c: Channel) => string
  ): Partial<Record<Channel, string>> => Object.fromEntries(channels.map((c) => [c, make(c)]));

  // --- 1. The live offer nobody is promoting -------------------------------
  for (const offer of site.liveOffers.value.slice(0, 1)) {
    const channels = feed.slice(0, 4);
    if (channels.length === 0) break;
    const core = `${offer} — ${site.description.value.split('.')[0]}.`;
    out.push({
      id: id(),
      title: `Promote your live offer: ${offer}`,
      coreMessage: core,
      channels,
      format: 'post',
      goal: goalFor(),
      source: 'live_offer',
      reasons: [
        `"${offer}" is live on your homepage but appears in none of your scheduled posts.`,
        `Found on ${site.liveOffers.source.where}.`,
      ],
      bodies: build(channels, (c) =>
        c === 'linkedin'
          ? inVoice(`${offer}. ${site.description.value} ${ctaFor(c, ctaLabel, cta, bio)}`, voice)
          : inVoice(`${offer}. ${core.split('—')[1]?.trim() ?? ''} ${ctaFor(c, ctaLabel, cta, bio)}`, voice, '📣')
      ),
      mediaIds: media.unused.slice(0, 1).map((a) => a.id),
      hashtags: hashtagsFrom(offer.split(' ').slice(0, 3), site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: 0.96,
    });
  }

  // --- 2. Unused media, matched to the format each channel rewards ---------
  for (const asset of media.unused.slice(0, 2)) {
    const vertical = asset.aspectRatio === '9:16';
    const allowed = vertical
      ? activeChannels(profiles, ['instagram', 'tiktok', 'facebook'])
      : feed.slice(0, 3);
    if (allowed.length === 0) continue;
    const subject = asset.altText ?? asset.name;
    const core = vertical
      ? `${asset.name} — a short clip from a recent job.`
      : `${subject}.`;
    out.push({
      id: id(),
      title: `Post the unused ${asset.kind}: ${asset.name}`,
      coreMessage: core,
      channels: allowed,
      format: vertical && asset.kind === 'video' ? 'reel' : 'post',
      goal: goalFor(),
      source: 'unused_media',
      reasons: [
        `"${asset.name}" has been in your library since ${asset.uploadedAt} and never posted.`,
        vertical
          ? 'It is 9:16, which is exactly what Reels and TikTok want.'
          : `Its ${asset.aspectRatio} ratio fits these feeds without cropping.`,
        ...(asset.altText ? [] : ['Needs alt text before it can publish — preflight will hold it.']),
      ],
      bodies: build(allowed, (c) =>
        inVoice(`${core} ${ctaFor(c, ctaLabel, cta, bio)}`, voice, '📸')
      ),
      mediaIds: [asset.id],
      hashtags: hashtagsFrom(asset.tags, site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: asset.altText ? 0.88 : 0.8,
    });
  }

  // --- 3. Wake a dormant profile that still has an audience ----------------
  const dormant = profiles
    .filter((p) => p.found && (p.daysSinceLastPost ?? 0) > 30)
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0];
  if (dormant) {
    const core = `We've been heads-down — here's what we've been working on.`;
    out.push({
      id: id(),
      title: `Wake up ${CHANNEL_META[dormant.channel].label} (${dormant.daysSinceLastPost} days quiet)`,
      coreMessage: core,
      channels: [dormant.channel],
      format: dormant.channel === 'tiktok' ? 'reel' : dormant.channel === 'google_business' ? 'update' : 'post',
      goal: goalFor(),
      source: 'dormant_profile',
      reasons: [
        `No post in ${dormant.daysSinceLastPost} days.`,
        dormant.followers
          ? `${dormant.followers.toLocaleString('en-US')} followers are still subscribed and seeing nothing.`
          : 'Dormant profiles lose local ranking.',
        dormant.bestFormat ? `Your best-performing format here is ${dormant.bestFormat}.` : '',
      ].filter(Boolean),
      bodies: {
        [dormant.channel]: inVoice(
          `${core}${
            site.services.value[0] ? ` We're booking ${site.services.value[0].name.toLowerCase()} now.` : ''
          } ${ctaFor(dormant.channel, ctaLabel, cta, bio)}`,
          voice,
          '👋'
        ),
      },
      mediaIds: media.unused.slice(1, 2).map((a) => a.id),
      hashtags: hashtagsFrom(dormant.themes, site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: 0.92,
    });
  }

  // --- 4. Social proof from a real review ----------------------------------
  const review = site.testimonials.value[0];
  if (review && feed.length > 0) {
    const channels = feed.slice(0, 3);
    const core = `"${review.quote}" — ${review.attribution}`;
    out.push({
      id: id(),
      title: `Turn a five-star review into a post`,
      coreMessage: core,
      channels,
      format: 'post',
      goal: goalFor(),
      source: 'testimonial',
      reasons: [
        `This review is already published on ${site.testimonials.source.where} but has never been posted socially.`,
        'Social proof converts better than anything you say about yourself.',
      ],
      bodies: build(channels, (c) => inVoice(`${core}\n\n${ctaFor(c, ctaLabel, cta, bio)}`, voice, '⭐')),
      mediaIds: media.unused.slice(2, 3).map((a) => a.id),
      hashtags: hashtagsFrom(['customer', 'review'], site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: 0.87,
    });
  }

  // --- 5. A service page nobody has posted about ---------------------------
  const seasonNow = seasonOf(intel.analyzedAt);
  const service =
    site.services.value.find((s) => s.season === seasonNow) ?? site.services.value[0];
  if (service && feed.length > 0) {
    const channels = feed.slice(0, 3);
    const core = `${service.name}: ${service.description}`;
    out.push({
      id: id(),
      title: `Spotlight a service: ${service.name}`,
      coreMessage: core,
      channels,
      format: 'post',
      goal: goalFor(),
      source: service.season === seasonNow ? 'seasonal' : 'service_page',
      reasons: [
        `Listed on ${site.services.source.where} with no matching post.`,
        service.season === seasonNow
          ? `It's a ${service.season} service and we're in ${seasonNow} — the timing is now.`
          : 'One of your core services.',
        ...(service.priceHint ? [`Your site already states the price (${service.priceHint}), so the post can too.`] : []),
      ],
      bodies: build(channels, (c) =>
        inVoice(
          `${service.name} — ${service.description}${service.priceHint ? ` ${service.priceHint}.` : ''} ${ctaFor(c, ctaLabel, cta, bio)}`,
          voice,
          '🍂'
        )
      ),
      mediaIds: media.unused.slice(3, 4).map((a) => a.id),
      hashtags: hashtagsFrom(service.name.split(' '), site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: service.season === seasonNow ? 0.9 : 0.78,
    });
  }

  // --- 6. Claim a missing profile where the audience is ---------------------
  const missing = profiles.find((p) => !p.found);
  if (missing) {
    out.push({
      id: id(),
      title: `Claim ${CHANNEL_META[missing.channel].label} and introduce the business`,
      coreMessage: `${site.businessName.value} — ${site.tagline.value ?? site.description.value}`,
      channels: [missing.channel],
      format: 'post',
      goal: 'awareness',
      source: 'missing_profile',
      reasons: [
        missing.issues[0] ?? 'No account found for this business.',
        `Your ${site.serviceArea.value ?? 'area'} audience is already there.`,
      ],
      bodies: {
        [missing.channel]: inVoice(
          `${site.businessName.value} — ${site.tagline.value ?? ''}. ${site.description.value} ${ctaFor(missing.channel, ctaLabel, cta, bio)}`,
          voice,
          '👋'
        ),
      },
      mediaIds: assets.find((a) => a.kind === 'logo' && a.brandId === intel.brandId)
        ? [assets.find((a) => a.kind === 'logo' && a.brandId === intel.brandId)!.id]
        : [],
      hashtags: hashtagsFrom([site.businessName.value], site.address.value),
      ctaLabel,
      ctaUrl: cta,
      score: 0.7,
    });
  }

  // --- 7. Answer the question customers actually ask -----------------------
  if (site.hours.value && feed.includes('google_business')) {
    out.push({
      id: id(),
      title: 'Answer the question you get asked most',
      coreMessage: `Hours, service area, and how to reach us.`,
      channels: ['google_business'],
      format: 'update',
      goal: 'calls',
      source: 'faq',
      reasons: [
        `Your hours (${site.hours.value}) and service area are on the site but not on your Business Profile posts.`,
        'Google Business updates surface directly in local search and Maps.',
      ],
      bodies: {
        google_business: inVoice(
          `${site.hours.value}. Serving ${site.serviceArea.value ?? 'the local area'}. ${site.phone.value ? `Call ${site.phone.value}` : ctaFor('google_business', ctaLabel, cta, bio)}.`,
          voice
        ),
      },
      mediaIds: [],
      hashtags: [],
      ctaLabel,
      ctaUrl: cta,
      score: 0.74,
    });
  }

  return out
    .filter((s) => s.channels.length > 0)
    .sort((a, b) => b.score - a.score);
}

function seasonOf(dateKey: string): 'spring' | 'summer' | 'fall' | 'winter' {
  const m = Number(dateKey.slice(5, 7));
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'fall';
  return 'winter';
}

export function confidenceLabel(score: number): string {
  return score >= 0.9 ? 'Strong' : score >= 0.8 ? 'Good' : 'Worth a look';
}
