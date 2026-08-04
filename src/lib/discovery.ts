import type { Brand, Channel, MediaAsset } from './types';
import type { Industry } from './surfaces';
import { CHANNEL_META } from './channels';

/**
 * Discovery — read a business's existing footprint and turn it into facts the
 * composer can write from.
 *
 * The owner shouldn't have to describe their own business to us. They already
 * did that on their website, their Instagram bio, and in the photos on their
 * phone. Discovery reads those, extracts what a copywriter would need, and
 * names what's missing.
 *
 * Three passes:
 *   1. Site      — crawl the domain for services, contact facts, offers, voice
 *   2. Profiles  — find and audit the social accounts that already exist
 *   3. Media     — audit the asset library for what's usable and what's idle
 *
 * PRODUCTION NOTE. In this prototype `analyze()` resolves deterministically
 * from a fixture table — no network. The types, the staged pipeline, and the
 * per-fact `SourceRef` provenance are the real design; the production
 * implementation swaps the fixture for the extractors described on each
 * field, behind this same interface. Every extracted fact carries where it
 * came from, because a business owner correcting a wrong fact needs to know
 * which page we read it off.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type SourceKind =
  | 'jsonld' // schema.org LocalBusiness / Organization / Product
  | 'opengraph' // og: / twitter: meta tags
  | 'meta' // title, description, canonical
  | 'page' // parsed body copy of a specific page
  | 'sitemap' // sitemap.xml page inventory
  | 'footer' // footer links (NAP, socials)
  | 'profile' // the social profile itself
  | 'media' // the asset library
  | 'inferred'; // derived, not directly stated — always labelled as such

export interface SourceRef {
  kind: SourceKind;
  /** Human-readable location: "/services/fall-cleanup", "schema.org LocalBusiness" */
  where: string;
}

export interface Fact<T> {
  value: T;
  source: SourceRef;
  /** 0–1. Anything below 0.7 is shown to the owner for confirmation. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Site intelligence
// ---------------------------------------------------------------------------

export interface ServiceOffering {
  name: string;
  description: string;
  /** Price or range as written on the site, if stated at all. */
  priceHint: string | null;
  /** Seasonal services surface in suggestions at the right time of year. */
  season: 'spring' | 'summer' | 'fall' | 'winter' | 'year_round';
}

export interface Testimonial {
  quote: string;
  attribution: string;
  rating: number | null;
}

export interface BrandVoice {
  /** Where the copy sits between plain-spoken and formal. */
  register: 'casual' | 'warm' | 'professional' | 'technical';
  usesEmoji: boolean;
  usesFirstPerson: boolean;
  avgSentenceWords: number;
  /** Words the site leans on — reused so drafts sound like them, not like us. */
  signaturePhrases: string[];
}

export interface SiteIntel {
  domain: string;
  reachable: boolean;
  /** WordPress / Shopify / Squarespace / Wix / custom — decides the connector. */
  platform: Fact<string>;
  businessName: Fact<string>;
  tagline: Fact<string | null>;
  description: Fact<string>;
  services: Fact<ServiceOffering[]>;
  /** Name / address / phone — the local-SEO trio; must match Google exactly. */
  address: Fact<string | null>;
  phone: Fact<string | null>;
  serviceArea: Fact<string | null>;
  hours: Fact<string | null>;
  /** Promotions already live on the site, so drafts don't contradict them. */
  liveOffers: Fact<string[]>;
  testimonials: Fact<Testimonial[]>;
  voice: Fact<BrandVoice>;
  /** Hex colors pulled from the stylesheet, for on-brand generated graphics. */
  palette: Fact<string[]>;
  /** The page a call-to-action should point at. */
  conversionUrl: Fact<string | null>;
  /** Images found on the site that could be pulled into the media library. */
  imagesFound: number;
  pagesCrawled: number;
}

// ---------------------------------------------------------------------------
// Profile intelligence
// ---------------------------------------------------------------------------

export interface ProfileIntel {
  channel: Channel;
  found: boolean;
  handle: string | null;
  url: string | null;
  followers: number | null;
  postsAnalyzed: number;
  /** Days since the most recent post. High numbers drive reactivation suggestions. */
  daysSinceLastPost: number | null;
  /** Observed posting rhythm, e.g. "about twice a week". */
  cadence: string | null;
  /** The format that historically got the most engagement here. */
  bestFormat: string | null;
  /** Recurring themes in their existing posts — reused so we sound like them. */
  themes: string[];
  bioComplete: boolean;
  hasLinkInBio: boolean;
  /** How we located it: footer link, rel=me, handle search, or Meta's graph. */
  discoveredVia: string | null;
  /** Concrete, fixable problems found on the profile itself. */
  issues: string[];
}

// ---------------------------------------------------------------------------
// Media audit
// ---------------------------------------------------------------------------

export interface MediaAudit {
  total: number;
  /** Assets never attached to any published or scheduled item. */
  unused: MediaAsset[];
  missingAltText: MediaAsset[];
  /** Aspect ratios present, so we know which channels are already servable. */
  ratios: Record<string, number>;
  /** Channels we can't post visually to without new assets. */
  ratioGapsFor: Channel[];
  videoCount: number;
  /** Subject tags across the library, most common first. */
  topTags: string[];
}

// ---------------------------------------------------------------------------
// The full result
// ---------------------------------------------------------------------------

export interface DiscoveryGap {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  /** What the product can do about it right now. */
  action: string | null;
}

export interface BrandIntel {
  brandId: string | null;
  industry: Industry;
  site: SiteIntel;
  profiles: ProfileIntel[];
  media: MediaAudit;
  gaps: DiscoveryGap[];
  analyzedAt: string;
}

/** The staged pipeline, surfaced in the UI so the wait is legible. */
export const DISCOVERY_STAGES = [
  { id: 'fetch', label: 'Reading the website', detail: 'Homepage, services, contact, sitemap' },
  { id: 'extract', label: 'Extracting business facts', detail: 'Services, hours, location, offers' },
  { id: 'voice', label: 'Learning the brand voice', detail: 'Tone, phrasing, vocabulary' },
  { id: 'profiles', label: 'Finding social profiles', detail: 'Footer links, rel=me, handle search' },
  { id: 'audit', label: 'Auditing profiles and media', detail: 'Cadence, gaps, usable assets' },
  { id: 'suggest', label: 'Drafting suggested posts', detail: 'Grounded in what we found' },
] as const;

export type StageId = (typeof DISCOVERY_STAGES)[number]['id'];

// ---------------------------------------------------------------------------
// Fixtures — the simulated crawl results
// ---------------------------------------------------------------------------

const f = <T,>(value: T, kind: SourceKind, where: string, confidence = 0.95): Fact<T> => ({
  value,
  source: { kind, where },
  confidence,
});

interface Fixture {
  brandId: string;
  industry: Industry;
  site: Omit<SiteIntel, 'domain' | 'reachable'>;
  profiles: ProfileIntel[];
}

const FIXTURES: Record<string, Fixture> = {
  'greenscapenj.com': {
    brandId: 'b-green',
    industry: 'landscaping',
    site: {
      platform: f('WordPress 6.5 (Astra theme)', 'meta', 'generator meta tag'),
      businessName: f('GreenScape Landscaping', 'jsonld', 'schema.org LocalBusiness'),
      tagline: f('Yards worth coming home to', 'meta', '<title>'),
      description: f(
        'Full-service residential landscaping in Essex County: design, installation, seasonal cleanups, and year-round maintenance.',
        'meta',
        'meta description'
      ),
      services: f(
        [
          { name: 'Fall & spring cleanups', description: 'Leaf removal, gutter clearing, bed winterization, haul-away.', priceHint: 'from $275', season: 'fall' },
          { name: 'Lawn maintenance plans', description: 'Weekly mowing, edging, and bed upkeep on a flat monthly rate.', priceHint: 'from $180/mo', season: 'year_round' },
          { name: 'Landscape design & install', description: 'Planting plans, hardscape, drainage, and lighting.', priceHint: null, season: 'spring' },
          { name: 'Snow & ice management', description: 'Driveway and walkway clearing on a per-storm or seasonal contract.', priceHint: null, season: 'winter' },
        ],
        'page',
        '/services'
      ),
      address: f('41 Springfield Ave, Maplewood, NJ 07040', 'jsonld', 'schema.org PostalAddress'),
      phone: f('(973) 555-0148', 'footer', 'site footer'),
      serviceArea: f('Essex County — 25 miles of Maplewood', 'page', '/service-area'),
      hours: f('Mon–Fri 7:00–17:00, Sat 8:00–13:00', 'jsonld', 'schema.org openingHours'),
      liveOffers: f(['Free estimates through October 31'], 'page', '/ homepage hero banner'),
      testimonials: f(
        [
          { quote: 'The yard looked better than the day we moved in.', attribution: 'The Henderson family, Maplewood', rating: 5 },
          { quote: 'Showed up when they said, cleaned up after themselves. Rare.', attribution: 'M. DiStefano', rating: 5 },
          { quote: 'Third season with them on a maintenance plan. Never had to chase them once.', attribution: 'P. Ruiz, South Orange', rating: 5 },
        ],
        'page',
        '/reviews'
      ),
      voice: f(
        {
          register: 'warm',
          usesEmoji: false,
          usesFirstPerson: true,
          avgSentenceWords: 14,
          signaturePhrases: ['one visit', 'before the first freeze', 'we handle the haul-away', 'free estimate'],
        },
        'inferred',
        'tone analysis across 11 pages',
        0.72
      ),
      palette: f(['#16a34a', '#052e16', '#f5f5f0'], 'page', 'stylesheet custom properties'),
      conversionUrl: f('https://greenscapenj.com/request-a-quote', 'page', 'primary nav CTA'),
      imagesFound: 47,
      pagesCrawled: 11,
    },
    profiles: [
      {
        channel: 'facebook', found: true, handle: 'greenscapenj', url: 'facebook.com/greenscapenj',
        followers: 1840, postsAnalyzed: 60, daysSinceLastPost: 6, cadence: 'about twice a week',
        bestFormat: 'before/after photo pairs', themes: ['project photos', 'seasonal reminders', 'crew introductions'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link',
        issues: [],
      },
      {
        channel: 'instagram', found: true, handle: 'greenscapelandscaping', url: 'instagram.com/greenscapelandscaping',
        followers: 920, postsAnalyzed: 60, daysSinceLastPost: 8, cadence: 'about once a week',
        bestFormat: 'before/after carousels', themes: ['before/after', 'plant closeups', 'truck & crew'],
        bioComplete: true, hasLinkInBio: false, discoveredVia: 'footer link',
        issues: ['No link in bio — every "link in bio" caption currently goes nowhere'],
      },
      {
        channel: 'google_business', found: true, handle: 'GreenScape Landscaping', url: 'g.page/greenscapenj',
        followers: null, postsAnalyzed: 4, daysSinceLastPost: 63, cadence: 'rarely',
        bestFormat: 'offer posts', themes: ['seasonal offers'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'Google Business Profile match on name + address',
        issues: ['No post in 63 days — Google favours active profiles in local results', '11 reviews with no owner response'],
      },
      {
        channel: 'nextdoor', found: false, handle: null, url: null, followers: null, postsAnalyzed: 0,
        daysSinceLastPost: null, cadence: null, bestFormat: null, themes: [],
        bioComplete: false, hasLinkInBio: false, discoveredVia: null,
        issues: ['No business page found — Nextdoor is where neighbours ask for landscaper recommendations'],
      },
      {
        channel: 'linkedin', found: true, handle: 'greenscape-landscaping', url: 'linkedin.com/company/greenscape-landscaping',
        followers: 210, postsAnalyzed: 12, daysSinceLastPost: 31, cadence: 'monthly',
        bestFormat: 'commercial project posts', themes: ['commercial contracts', 'hiring'],
        bioComplete: false, hasLinkInBio: true, discoveredVia: 'handle search',
        issues: ['Page description is empty', 'No cover image'],
      },
    ],
  },

  'harborviewrentals.com': {
    brandId: 'b-harbor',
    industry: 'house_rentals',
    site: {
      platform: f('Squarespace 7.1', 'meta', 'generator meta tag'),
      businessName: f('Harborview Rentals', 'jsonld', 'schema.org RealEstateAgent'),
      tagline: f('Live a walk from the water', 'meta', '<title>'),
      description: f('Long-term residential rentals in Portsmouth and the New Hampshire seacoast.', 'meta', 'meta description'),
      services: f(
        [
          { name: 'Long-term rentals', description: '12-month leases on apartments and single-family homes.', priceHint: '$1,650–$3,200/mo', season: 'year_round' },
          { name: 'Property management', description: 'Tenant placement, maintenance, and rent collection for owners.', priceHint: '8% of monthly rent', season: 'year_round' },
        ],
        'page',
        '/what-we-do'
      ),
      address: f('88 Market St, Portsmouth, NH 03801', 'footer', 'site footer'),
      phone: f('(603) 555-0121', 'footer', 'site footer'),
      serviceArea: f('Portsmouth, Newington, Kittery, and the seacoast', 'page', '/areas'),
      hours: f('Tours by appointment, Mon–Sat', 'page', '/contact'),
      liveOffers: f(['First month half off on 12-month leases'], 'page', 'homepage banner'),
      testimonials: f(
        [{ quote: 'They answered every question before we even asked it.', attribution: 'A. Bello, tenant', rating: 5 }],
        'page',
        '/about'
      ),
      voice: f(
        { register: 'professional', usesEmoji: false, usesFirstPerson: true, avgSentenceWords: 17, signaturePhrases: ['steps from the waterfront', 'available now', 'book a tour'] },
        'inferred',
        'tone analysis across 7 pages',
        0.68
      ),
      palette: f(['#2563eb', '#1e3a8a', '#f8fafc'], 'page', 'stylesheet custom properties'),
      conversionUrl: f('https://harborviewrentals.com/book-a-tour', 'page', 'primary nav CTA'),
      imagesFound: 63,
      pagesCrawled: 7,
    },
    profiles: [
      {
        channel: 'facebook', found: true, handle: 'harborviewrentals', url: 'facebook.com/harborviewrentals',
        followers: 640, postsAnalyzed: 40, daysSinceLastPost: 3, cadence: 'twice a week',
        bestFormat: 'listing photo sets', themes: ['new listings', 'open houses', 'neighborhood features'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link', issues: [],
      },
      {
        channel: 'instagram', found: true, handle: 'harborviewrentals', url: 'instagram.com/harborviewrentals',
        followers: 1120, postsAnalyzed: 45, daysSinceLastPost: 4, cadence: 'twice a week',
        bestFormat: 'walkthrough Reels', themes: ['interiors', 'harbor views', 'tour clips'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link', issues: [],
      },
      {
        channel: 'pinterest', found: false, handle: null, url: null, followers: null, postsAnalyzed: 0,
        daysSinceLastPost: null, cadence: null, bestFormat: null, themes: [],
        bioComplete: false, hasLinkInBio: false, discoveredVia: null,
        issues: ['No account — interiors have a long half-life on Pinterest and every Pin links back'],
      },
      {
        channel: 'google_business', found: true, handle: 'Harborview Rentals', url: 'g.page/harborviewrentals',
        followers: null, postsAnalyzed: 9, daysSinceLastPost: 21, cadence: 'monthly',
        bestFormat: 'listing updates', themes: ['availability'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'name + address match', issues: [],
      },
    ],
  },

  'velvetroomstudio.com': {
    brandId: 'b-velvet',
    industry: 'music_studio',
    site: {
      platform: f('Custom (Next.js)', 'meta', 'x-powered-by header'),
      businessName: f('Velvet Room Studio', 'jsonld', 'schema.org MusicVenue'),
      tagline: f('Analog warmth, modern turnaround', 'meta', '<title>'),
      description: f('Recording, mixing, and mastering studio in East Nashville. Two rooms, vintage console, same-week turnaround.', 'meta', 'meta description'),
      services: f(
        [
          { name: 'Tracking sessions', description: 'Studio A with the Neve console and live room, engineer included.', priceHint: '$85/hr', season: 'year_round' },
          { name: 'Mixing & mastering', description: 'Per-song mixing with two revision passes.', priceHint: '$350/song', season: 'year_round' },
          { name: 'Podcast recording', description: 'Multi-mic podcast setup with same-day edited audio.', priceHint: '$120/session', season: 'year_round' },
        ],
        'page',
        '/rates'
      ),
      address: f('1204 Woodland St, Nashville, TN 37206', 'jsonld', 'schema.org PostalAddress'),
      phone: f('(615) 555-0177', 'footer', 'site footer'),
      serviceArea: f('East Nashville', 'inferred', 'address + copy', 0.6),
      hours: f('Sessions 10:00–02:00 daily, by booking', 'page', '/book'),
      liveOffers: f(['10% off the first session for new artists'], 'page', '/book'),
      testimonials: f(
        [
          { quote: 'Best sounding room in Nashville for the price.', attribution: 'R. Whitfield', rating: 5 },
          { quote: 'Mira tracked her whole EP here in four days.', attribution: 'Bandcamp feature', rating: null },
        ],
        'page',
        '/'
      ),
      voice: f(
        { register: 'casual', usesEmoji: true, usesFirstPerson: true, avgSentenceWords: 11, signaturePhrases: ['the room', 'tracked here', 'book a session', 'tape machine'] },
        'inferred',
        'tone analysis across 6 pages',
        0.75
      ),
      palette: f(['#7c3aed', '#312e81', '#0f0f14'], 'page', 'stylesheet custom properties'),
      conversionUrl: f('https://velvetroomstudio.com/book', 'page', 'primary nav CTA'),
      imagesFound: 38,
      pagesCrawled: 6,
    },
    profiles: [
      {
        channel: 'instagram', found: true, handle: 'velvetroomstudio', url: 'instagram.com/velvetroomstudio',
        followers: 4300, postsAnalyzed: 60, daysSinceLastPost: 6, cadence: 'twice a week',
        bestFormat: 'artist session Reels', themes: ['artists at work', 'gear', 'snippets'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link', issues: [],
      },
      {
        channel: 'tiktok', found: true, handle: 'velvetroomstudio', url: 'tiktok.com/@velvetroomstudio',
        followers: 2100, postsAnalyzed: 22, daysSinceLastPost: 44, cadence: 'sporadic',
        bestFormat: 'gear demos', themes: ['gear', 'studio tours'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'handle search',
        issues: ['No post in 44 days despite 2.1k followers — the audience is there and idle'],
      },
      {
        channel: 'youtube', found: false, handle: null, url: null, followers: null, postsAnalyzed: 0,
        daysSinceLastPost: null, cadence: null, bestFormat: null, themes: [],
        bioComplete: false, hasLinkInBio: false, discoveredVia: null,
        issues: ['No channel — session videos already being cut for Reels would carry over directly'],
      },
      {
        channel: 'facebook', found: true, handle: 'velvetroomstudio', url: 'facebook.com/velvetroomstudio',
        followers: 780, postsAnalyzed: 30, daysSinceLastPost: 6, cadence: 'weekly',
        bestFormat: 'session photos', themes: ['sessions', 'events'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link', issues: [],
      },
    ],
  },

  'loopwise.app': {
    brandId: 'b-loop',
    industry: 'software',
    site: {
      platform: f('Custom (Next.js) + HubSpot forms', 'meta', 'script hosts'),
      businessName: f('Loopwise', 'jsonld', 'schema.org SoftwareApplication'),
      tagline: f('Operations software for teams that outgrew spreadsheets', 'meta', '<title>'),
      description: f('Intake, routing, and reporting for 10–50 person operations teams.', 'meta', 'meta description'),
      services: f(
        [
          { name: 'Intake & routing', description: 'Turn requests from any channel into tracked, assigned work.', priceHint: '$18/user/mo', season: 'year_round' },
          { name: 'Reporting', description: 'Live dashboards on throughput, backlog, and SLA.', priceHint: 'included', season: 'year_round' },
        ],
        'page',
        '/product'
      ),
      address: f(null, 'inferred', 'no physical address published', 0.9),
      phone: f(null, 'inferred', 'no phone published', 0.9),
      serviceArea: f('Remote — US and Canada', 'page', '/contact'),
      hours: f(null, 'inferred', 'not applicable', 0.9),
      liveOffers: f(['14-day free trial, no card', 'Live onboarding webinar Oct 22'], 'page', 'homepage hero'),
      testimonials: f(
        [{ quote: 'We cut intake time in half in the first month.', attribution: 'G. Okafor, Ops Lead', rating: null }],
        'page',
        '/customers'
      ),
      voice: f(
        { register: 'professional', usesEmoji: false, usesFirstPerson: true, avgSentenceWords: 16, signaturePhrases: ['in 45 minutes', 'no card required', 'outgrew spreadsheets'] },
        'inferred',
        'tone analysis across 9 pages',
        0.7
      ),
      palette: f(['#0d9488', '#134e4a', '#f8fafc'], 'page', 'stylesheet custom properties'),
      conversionUrl: f('https://loopwise.app/trial', 'page', 'primary nav CTA'),
      imagesFound: 21,
      pagesCrawled: 9,
    },
    profiles: [
      {
        channel: 'linkedin', found: true, handle: 'loopwise', url: 'linkedin.com/company/loopwise',
        followers: 3400, postsAnalyzed: 50, daysSinceLastPost: 7, cadence: 'twice a week',
        bestFormat: 'customer-result posts', themes: ['product updates', 'customer stories', 'webinars'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link', issues: [],
      },
      {
        channel: 'x', found: true, handle: 'loopwiseapp', url: 'x.com/loopwiseapp',
        followers: 1250, postsAnalyzed: 40, daysSinceLastPost: 19, cadence: 'sporadic',
        bestFormat: 'changelog threads', themes: ['changelog', 'tips'],
        bioComplete: true, hasLinkInBio: true, discoveredVia: 'footer link',
        issues: ['Quiet for 19 days while shipping weekly — the changelog is already written'],
      },
      {
        channel: 'youtube', found: true, handle: 'loopwise', url: 'youtube.com/@loopwise',
        followers: 340, postsAnalyzed: 8, daysSinceLastPost: 96, cadence: 'rarely',
        bestFormat: 'feature walkthroughs', themes: ['demos'],
        bioComplete: false, hasLinkInBio: true, discoveredVia: 'handle search',
        issues: ['No upload in 96 days', 'Webinar recordings are never posted here'],
      },
      {
        channel: 'bluesky', found: false, handle: null, url: null, followers: null, postsAnalyzed: 0,
        daysSinceLastPost: null, cadence: null, bestFormat: null, themes: [],
        bioComplete: false, hasLinkInBio: false, discoveredVia: null,
        issues: ['No account — open protocol, no API review, cheapest channel to add'],
      },
    ],
  },
};

/** Domains the prototype can analyze, offered as examples in the UI. */
export const KNOWN_DOMAINS = Object.keys(FIXTURES);

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// ---------------------------------------------------------------------------
// Media audit
// ---------------------------------------------------------------------------

/** Channels that only accept vertical video/imagery for their primary format. */
const VERTICAL_ONLY: Channel[] = ['tiktok', 'snapchat'];

export function auditMedia(assets: MediaAsset[], usedIds: Set<string>): MediaAudit {
  const ratios: Record<string, number> = {};
  const tagCounts = new Map<string, number>();

  for (const a of assets) {
    ratios[a.aspectRatio] = (ratios[a.aspectRatio] ?? 0) + 1;
    for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  const has = (r: string) => (ratios[r] ?? 0) > 0;
  const ratioGapsFor: Channel[] = [];
  if (!has('9:16')) ratioGapsFor.push(...VERTICAL_ONLY);
  if (!has('1:1') && !has('4:5')) ratioGapsFor.push('instagram');
  if (!has('2:3') && !has('4:5')) ratioGapsFor.push('pinterest');

  return {
    total: assets.length,
    unused: assets.filter((a) => !usedIds.has(a.id) && a.kind !== 'logo'),
    missingAltText: assets.filter((a) => a.kind === 'image' && !a.altText),
    ratios,
    ratioGapsFor,
    videoCount: assets.filter((a) => a.kind === 'video').length,
    topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

function detectGaps(site: SiteIntel, profiles: ProfileIntel[], media: MediaAudit): DiscoveryGap[] {
  const gaps: DiscoveryGap[] = [];

  for (const p of profiles) {
    if (!p.found) {
      gaps.push({
        severity: 'medium',
        title: `No ${CHANNEL_META[p.channel].label} presence`,
        detail: p.issues[0] ?? 'No account found for this business.',
        action: 'Connect or create it',
      });
      continue;
    }
    if (p.daysSinceLastPost !== null && p.daysSinceLastPost > 30) {
      gaps.push({
        severity: p.followers && p.followers > 1000 ? 'high' : 'medium',
        title: `${CHANNEL_META[p.channel].label} has been quiet for ${p.daysSinceLastPost} days`,
        detail:
          p.followers !== null
            ? `${p.followers.toLocaleString('en-US')} followers with nothing new to see.`
            : 'Dormant profiles lose reach and rank.',
        action: 'Schedule a reactivation post',
      });
    }
    for (const issue of p.issues) {
      if (issue.includes('link in bio')) {
        gaps.push({ severity: 'high', title: 'Instagram bio has no link', detail: issue, action: 'Add the campaign landing page' });
      }
      if (issue.includes('reviews with no owner response')) {
        gaps.push({ severity: 'medium', title: 'Unanswered reviews', detail: issue, action: 'Reply from the Inbox' });
      }
    }
  }

  if (media.missingAltText.length > 0) {
    gaps.push({
      severity: 'low',
      title: `${media.missingAltText.length} images missing alt text`,
      detail: 'Posts using them will be held by preflight until it is added.',
      action: 'Fix in the Media Library',
    });
  }
  if (media.unused.length >= 3) {
    gaps.push({
      severity: 'medium',
      title: `${media.unused.length} unused assets sitting idle`,
      detail: 'Already shot, already approved, never posted.',
      action: 'Use them in the suggestions below',
    });
  }
  if (site.liveOffers.value.length > 0) {
    gaps.push({
      severity: 'high',
      title: 'A live offer on the site is not being promoted',
      detail: `"${site.liveOffers.value[0]}" appears on the website but in none of the scheduled posts.`,
      action: 'Build a campaign around it',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return gaps.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------------------
// The analyzer
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
  domain: string;
  assets: MediaAsset[];
  usedMediaIds: Set<string>;
  today: string;
}

export type AnalyzeResult =
  | { ok: true; intel: BrandIntel }
  | { ok: false; reason: string; suggestions: string[] };

/**
 * Analyze a business from its domain.
 *
 * Production: fetch with a real user agent and a robots.txt check, parse
 * JSON-LD → OpenGraph → DOM in that order of trust, follow the sitemap for
 * service pages, resolve social profiles from footer/rel=me links then
 * verified handle search, and pull profile stats through each connector's
 * already-authenticated read scopes.
 */
export function analyze(input: AnalyzeInput): AnalyzeResult {
  const domain = normalizeDomain(input.domain);
  const fixture = FIXTURES[domain];

  if (!fixture) {
    return {
      ok: false,
      reason: `Couldn't reach ${domain || 'that address'}.`,
      suggestions: KNOWN_DOMAINS,
    };
  }

  const brandAssets = input.assets.filter((a) => a.brandId === fixture.brandId);
  const media = auditMedia(brandAssets, input.usedMediaIds);
  const site: SiteIntel = { domain, reachable: true, ...fixture.site };
  const gaps = detectGaps(site, fixture.profiles, media);

  return {
    ok: true,
    intel: {
      brandId: fixture.brandId,
      industry: fixture.industry,
      site,
      profiles: fixture.profiles,
      media,
      gaps,
      analyzedAt: input.today,
    },
  };
}

/** Map a workspace brand to the domain discovery knows about. */
export function domainForBrand(brand: Brand): string {
  return normalizeDomain(brand.website);
}
