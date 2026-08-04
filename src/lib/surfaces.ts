import type { Brand, CampaignGoal, Channel, ConnectedAccount } from './types';

/**
 * The advertising & social landscape model behind the Ad HUD.
 *
 * One row per surface where a small business can show up — every posting
 * channel Perception knows, plus ads-only networks that have no organic feed
 * (Google Ads, Local Services Ads, Microsoft Ads, Yelp Ads). Each row records
 * what the surface is good for, what it costs, who is actually there, and an
 * honest note about API reality. Industry fit is scored 0–3 so the HUD can
 * compute coverage and gaps per business rather than showing everyone the
 * same generic checklist.
 */

export type Industry = Brand['industry'];

export type SurfaceKind = 'social' | 'video' | 'local' | 'search' | 'messaging' | 'owned';

export interface PaidOption {
  product: string;
  costModel: 'cpc' | 'cpm' | 'cpv' | 'per-lead' | 'budget';
  note: string;
}

export interface AdSurface {
  id: string;
  name: string;
  kind: SurfaceKind;
  /** null = ads-only network with no posting channel */
  channel: Channel | null;
  /** badge for ads-only surfaces (channels use ChannelIcon) */
  badge: { short: string; color: string } | null;
  organic: boolean;
  paid: PaidOption | null;
  /** who is actually there — qualitative, no invented statistics */
  audience: string;
  bestFor: CampaignGoal[];
  fit: Record<Industry, 0 | 1 | 2 | 3>;
  apiNote: string;
  /** industry-specific one-line pitch, used by the gap recommendations */
  why: Partial<Record<Industry, string>>;
}

export const FIT_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: 'Skip',
  1: 'Situational',
  2: 'Strong',
  3: 'Essential',
};

export const KIND_LABEL: Record<SurfaceKind, string> = {
  social: 'Social feed',
  video: 'Video',
  local: 'Local',
  search: 'Search intent',
  messaging: 'Messaging',
  owned: 'Owned',
};

export const SURFACES: AdSurface[] = [
  // --- Posting channels ------------------------------------------------------
  {
    id: 'facebook', name: 'Facebook', kind: 'social', channel: 'facebook', badge: null,
    organic: true,
    paid: { product: 'Meta Ads Manager', costModel: 'budget', note: 'Boosts from a few dollars a day; the strongest local + interest targeting for SMBs' },
    audience: 'Broad local adults; community groups still drive small-business discovery',
    bestFor: ['quote_requests', 'bookings', 'awareness', 'calls'],
    fit: { landscaping: 3, house_rentals: 3, music_studio: 2, software: 1 },
    apiNote: 'Graph API — live in Perception (App Review scopes)',
    why: {},
  },
  {
    id: 'instagram', name: 'Instagram', kind: 'social', channel: 'instagram', badge: null,
    organic: true,
    paid: { product: 'Meta Ads Manager', costModel: 'budget', note: 'Same buy as Facebook; Reels placements reach the under-40 local audience' },
    audience: 'Visual-first; where before/after work, spaces, and food get discovered',
    bestFor: ['quote_requests', 'bookings', 'awareness'],
    fit: { landscaping: 3, house_rentals: 3, music_studio: 3, software: 1 },
    apiNote: 'Instagram Graph API — live in Perception',
    why: {},
  },
  {
    id: 'linkedin', name: 'LinkedIn', kind: 'social', channel: 'linkedin', badge: null,
    organic: true,
    paid: { product: 'LinkedIn Ads', costModel: 'cpc', note: 'Premium CPCs — worth it only when a customer is worth hundreds; unmatched B2B targeting' },
    audience: 'Professionals and buying committees; commercial property managers live here',
    bestFor: ['trial_signups', 'quote_requests', 'awareness'],
    fit: { landscaping: 2, house_rentals: 1, music_studio: 1, software: 3 },
    apiNote: 'Posts API — live in Perception (MDP approval)',
    why: { landscaping: 'Commercial lots and HOA contracts are sold to property managers — and they’re here, not on Instagram.' },
  },
  {
    id: 'tiktok', name: 'TikTok', kind: 'video', channel: 'tiktok', badge: null,
    organic: true,
    paid: { product: 'TikTok Ads Manager', costModel: 'cpm', note: 'Cheap reach; Spark Ads boost organic posts that already work' },
    audience: 'Under-35 discovery engine; “satisfying work” and music content travel farthest',
    bestFor: ['awareness', 'bookings'],
    fit: { landscaping: 2, house_rentals: 2, music_studio: 3, software: 1 },
    apiNote: 'Content Posting API — audit-gated (private uploads until audit passes)',
    why: { music_studio: 'Session clips and gear tours are native TikTok material — artists book studios they’ve already seen.' },
  },
  {
    id: 'youtube', name: 'YouTube', kind: 'video', channel: 'youtube', badge: null,
    organic: true,
    paid: { product: 'Google Ads (video)', costModel: 'cpv', note: 'Skippable in-stream from pennies per view; layers on Google search intent data' },
    audience: 'How-to and evaluation viewing; second screen of every research decision',
    bestFor: ['awareness', 'trial_signups'],
    fit: { landscaping: 2, house_rentals: 2, music_studio: 3, software: 2 },
    apiNote: 'Data API v3 — uploads locked private until project audit',
    why: {},
  },
  {
    id: 'google_business', name: 'Google Business Profile', kind: 'local', channel: 'google_business', badge: null,
    organic: true,
    paid: null,
    audience: 'People searching your category on Maps and Search — the highest-intent free surface for local business',
    bestFor: ['calls', 'quote_requests', 'bookings'],
    fit: { landscaping: 3, house_rentals: 2, music_studio: 3, software: 0 },
    apiNote: 'Business Profile API — live in Perception (per-project approval)',
    why: {},
  },
  {
    id: 'x', name: 'X (Twitter)', kind: 'social', channel: 'x', badge: null,
    organic: true,
    paid: { product: 'X Ads', costModel: 'cpm', note: 'Cheapest reach among the majors since 2023; brand-safety varies by adjacency' },
    audience: 'News, tech, sports, and music conversation; where software buyers and journalists argue in public',
    bestFor: ['awareness', 'trial_signups'],
    fit: { landscaping: 0, house_rentals: 1, music_studio: 2, software: 3 },
    apiNote: 'API v2 — posting requires a paid API tier',
    why: { software: 'Your buyers and their engineers already argue about tools here — build-in-public posts outperform ads.' },
  },
  {
    id: 'threads', name: 'Threads', kind: 'social', channel: 'threads', badge: null,
    organic: true,
    paid: { product: 'Meta Ads Manager (Threads placement)', costModel: 'budget', note: 'Rides the same Meta buy; inventory is young and cheap' },
    audience: 'Text-first spillover from Instagram; friendlier tone than X, same demographics as IG',
    bestFor: ['awareness'],
    fit: { landscaping: 1, house_rentals: 1, music_studio: 2, software: 2 },
    apiNote: 'Threads API — GA, same Meta app review',
    why: {},
  },
  {
    id: 'bluesky', name: 'Bluesky', kind: 'social', channel: 'bluesky', badge: null,
    organic: true,
    paid: null,
    audience: 'Early adopters, tech and media communities; small but high-attention',
    bestFor: ['awareness'],
    fit: { landscaping: 0, house_rentals: 0, music_studio: 1, software: 2 },
    apiNote: 'AT Protocol — open, no review; no ads product exists',
    why: {},
  },
  {
    id: 'pinterest', name: 'Pinterest', kind: 'social', channel: 'pinterest', badge: null,
    organic: true,
    paid: { product: 'Pinterest Ads', costModel: 'cpc', note: 'Intent-adjacent: people planning projects and purchases; long content half-life' },
    audience: 'Planners: yard projects, interiors, events — searches happen months before purchases',
    bestFor: ['quote_requests', 'awareness', 'purchases'],
    fit: { landscaping: 3, house_rentals: 2, music_studio: 0, software: 0 },
    apiNote: 'API v5 — standard review; ads via the same API',
    why: { landscaping: 'Yard-transformation Pins keep pulling traffic for months — a before/after board is a slow-burn lead machine.' },
  },
  {
    id: 'reddit', name: 'Reddit', kind: 'social', channel: 'reddit', badge: null,
    organic: true,
    paid: { product: 'Reddit Ads', costModel: 'cpm', note: 'Community targeting by subreddit; honest tone required or it backfires' },
    audience: 'High-trust niche communities; recommendations carry unusual weight',
    bestFor: ['trial_signups', 'awareness'],
    fit: { landscaping: 1, house_rentals: 1, music_studio: 2, software: 3 },
    apiNote: 'Data API — organic posting is community work; per-subreddit rules',
    why: { software: 'Ops and dev communities take recommendations seriously — one honest answer outlives ten ads.' },
  },
  {
    id: 'nextdoor', name: 'Nextdoor', kind: 'local', channel: 'nextdoor', badge: null,
    organic: true,
    paid: { product: 'Nextdoor Ads', costModel: 'budget', note: 'Neighborhood-level targeting no one else offers; built for home services' },
    audience: 'Verified neighbors asking each other who to hire — the recommendation engine for local services',
    bestFor: ['quote_requests', 'calls'],
    fit: { landscaping: 3, house_rentals: 2, music_studio: 1, software: 0 },
    apiNote: 'Posting API is partner-gated — assisted manual publishing until access lands',
    why: { landscaping: '“Who does fall cleanups around here?” is the highest-intent post on the internet — be the answer neighbors see.' },
  },
  {
    id: 'snapchat', name: 'Snapchat', kind: 'social', channel: 'snapchat', badge: null,
    organic: false,
    paid: { product: 'Snapchat Ads', costModel: 'cpm', note: 'Vertical video with strong local radius targeting; reaches under-25s others miss' },
    audience: 'Under-25s who aren’t on Facebook and barely open Instagram',
    bestFor: ['awareness', 'bookings'],
    fit: { landscaping: 0, house_rentals: 1, music_studio: 2, software: 0 },
    apiNote: 'Organic API limited to approved public profiles; Marketing API open for ads',
    why: { music_studio: 'Under-25 artists live here — behind-the-scenes studio clips travel.' },
  },
  {
    id: 'whatsapp', name: 'WhatsApp Business', kind: 'messaging', channel: 'whatsapp', badge: null,
    organic: true,
    paid: { product: 'Meta Ads (Click-to-WhatsApp)', costModel: 'cpc', note: 'Ads open a chat instead of a form — high response rates for booking conversations' },
    audience: 'Customers who treat email as spam but answer chat in minutes',
    bestFor: ['bookings', 'rental_inquiries', 'calls'],
    fit: { landscaping: 1, house_rentals: 2, music_studio: 1, software: 1 },
    apiNote: 'Cloud API — template messages + opt-in required (enforced by preflight)',
    why: { house_rentals: 'Tour scheduling over WhatsApp closes faster than email threads.' },
  },
  {
    id: 'email', name: 'Email', kind: 'owned', channel: 'email', badge: null,
    organic: true,
    paid: null,
    audience: 'Your list — the only audience an algorithm can’t take away',
    bestFor: ['quote_requests', 'purchases', 'email_signups', 'trial_signups'],
    fit: { landscaping: 3, house_rentals: 3, music_studio: 2, software: 3 },
    apiNote: 'Delivery provider — live in Perception (CAN-SPAM enforced structurally)',
    why: {},
  },
  {
    id: 'sms', name: 'SMS', kind: 'messaging', channel: 'sms', badge: null,
    organic: true,
    paid: null,
    audience: 'Near-100% open rates; reserved for time-sensitive nudges to opted-in customers',
    bestFor: ['bookings', 'calls'],
    fit: { landscaping: 2, house_rentals: 2, music_studio: 2, software: 1 },
    apiNote: '10DLC registration + structural opt-out required',
    why: {},
  },
  {
    id: 'website', name: 'Website', kind: 'owned', channel: 'website', badge: null,
    organic: true,
    paid: null,
    audience: 'Where every other surface sends people — banners, landing pages, and the conversion events analytics runs on',
    bestFor: ['quote_requests', 'purchases', 'trial_signups', 'email_signups'],
    fit: { landscaping: 3, house_rentals: 3, music_studio: 3, software: 3 },
    apiNote: 'WordPress / Shopify / webhooks — live in Perception',
    why: {},
  },

  // --- Ads-only networks (no posting feed) -----------------------------------
  {
    id: 'google_ads', name: 'Google Ads (Search)', kind: 'search', channel: null,
    badge: { short: 'GA', color: '#4285f4' },
    organic: false,
    paid: { product: 'Google Ads', costModel: 'cpc', note: 'Captures existing demand — people typing “fall cleanup near me” this week' },
    audience: 'Buyers mid-search; the highest-intent clicks money can buy',
    bestFor: ['quote_requests', 'calls', 'trial_signups', 'purchases'],
    fit: { landscaping: 3, house_rentals: 2, music_studio: 2, software: 3 },
    apiNote: 'Google Ads API — ads-only surface (planned: campaign import + spend/lead sync)',
    why: { landscaping: '“Fall cleanup near me” is typed by people ready to book this week — search captures the demand your posts create.' },
  },
  {
    id: 'google_lsa', name: 'Google Local Services Ads', kind: 'local', channel: null,
    badge: { short: 'LSA', color: '#188038' },
    organic: false,
    paid: { product: 'Local Services Ads', costModel: 'per-lead', note: 'Pay per lead, not per click, with the “Google Guaranteed” badge — home-services categories only' },
    audience: 'Top-of-page local placement above regular search ads',
    bestFor: ['quote_requests', 'calls'],
    fit: { landscaping: 3, house_rentals: 1, music_studio: 0, software: 0 },
    apiNote: 'Background-check + license verification per business category',
    why: { landscaping: 'Often the cheapest qualified quote request a home-services business can buy — you pay for leads, not clicks.' },
  },
  {
    id: 'microsoft_ads', name: 'Microsoft Ads (Bing)', kind: 'search', channel: null,
    badge: { short: 'MS', color: '#5e5e5e' },
    organic: false,
    paid: { product: 'Microsoft Advertising', costModel: 'cpc', note: 'Imports Google campaigns in minutes; cheaper CPCs, older and desktop-heavy audience' },
    audience: 'Desktop and enterprise defaults; overlooked and underpriced',
    bestFor: ['quote_requests', 'trial_signups'],
    fit: { landscaping: 1, house_rentals: 1, music_studio: 0, software: 2 },
    apiNote: 'Ads API — ads-only surface',
    why: {},
  },
  {
    id: 'yelp_ads', name: 'Yelp Ads', kind: 'local', channel: null,
    badge: { short: 'Y', color: '#d32323' },
    organic: false,
    paid: { product: 'Yelp Ads', costModel: 'cpc', note: 'Placement above competitors on their own listings; reviews do the selling' },
    audience: 'People comparing local providers at the moment of choice',
    bestFor: ['quote_requests', 'calls', 'bookings'],
    fit: { landscaping: 2, house_rentals: 1, music_studio: 1, software: 0 },
    apiNote: 'No organic posting; ads program + review management',
    why: {},
  },
];

// ---------------------------------------------------------------------------
// Derivations used by the HUD
// ---------------------------------------------------------------------------

export type SurfaceStatus = 'connected' | 'needs_reconnect' | 'available' | 'ads_only';

export function surfaceStatus(surface: AdSurface, accounts: ConnectedAccount[]): SurfaceStatus {
  if (surface.channel === null) return 'ads_only';
  const account = accounts.find((a) => a.channel === surface.channel);
  if (!account || account.status === 'not_connected') return 'available';
  if (account.status === 'needs_reconnect') return 'needs_reconnect';
  return 'connected';
}

/** Fit for one industry, or the best fit across all industries for the "all businesses" view. */
export function fitFor(surface: AdSurface, industry: Industry | 'all'): 0 | 1 | 2 | 3 {
  if (industry === 'all') {
    return Math.max(...Object.values(surface.fit)) as 0 | 1 | 2 | 3;
  }
  return surface.fit[industry];
}

export interface CoverageGap {
  surface: AdSurface;
  fit: 2 | 3;
  reason: string;
}

export interface Coverage {
  essential: AdSurface[];
  essentialCovered: number;
  pct: number;
  gaps: CoverageGap[];
}

/**
 * Coverage for one industry: how many essential (fit 3) surfaces are active,
 * and the ranked list of gaps — strong-or-essential surfaces not yet in use.
 */
export function coverageFor(industry: Industry, accounts: ConnectedAccount[]): Coverage {
  const essential = SURFACES.filter((s) => s.fit[industry] === 3);
  const active = (s: AdSurface) => surfaceStatus(s, accounts) === 'connected';
  const essentialCovered = essential.filter(active).length;
  const gaps: CoverageGap[] = SURFACES.filter((s) => s.fit[industry] >= 2 && !active(s))
    .map((s) => ({
      surface: s,
      fit: s.fit[industry] as 2 | 3,
      reason: s.why[industry] ?? s.audience,
    }))
    .sort((a, b) => b.fit - a.fit);
  return {
    essential,
    essentialCovered,
    pct: essential.length === 0 ? 100 : Math.round((essentialCovered / essential.length) * 100),
    gaps,
  };
}
