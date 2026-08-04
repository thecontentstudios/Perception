import type {
  Approval,
  AudienceSegment,
  AuditEvent,
  Brand,
  Campaign,
  CampaignPerformance,
  CampaignTemplate,
  ChannelVariation,
  ConnectedAccount,
  Contact,
  ContentItem,
  Conversation,
  MediaAsset,
  Organization,
  User,
} from './types';

/**
 * Demo workspace for the clickable prototype.
 *
 * The demo clock is pinned to Thursday, October 8, 2026 so the flagship
 * example from the product blueprint — the Fall Cleanup Promotion running
 * September 15 – October 31 with 21 quote requests so far — is live
 * mid-flight: published posts with results behind it, scheduled work ahead of
 * it, one failed publish to fix, and approvals waiting.
 */
export const TODAY = '2026-10-08';
export const NOW = '2026-10-08T09:45';

// ---------------------------------------------------------------------------
// Campaign color palette (calendar coding)
// ---------------------------------------------------------------------------

export const CAMPAIGN_COLORS = [
  { name: 'Amber', solid: '#b45309', soft: 'rgba(217,119,6,.14)', line: '#d97706' },
  { name: 'Blue', solid: '#1d4ed8', soft: 'rgba(37,99,235,.13)', line: '#2563eb' },
  { name: 'Violet', solid: '#6d28d9', soft: 'rgba(124,58,237,.13)', line: '#7c3aed' },
  { name: 'Teal', solid: '#0f766e', soft: 'rgba(13,148,136,.14)', line: '#0d9488' },
  { name: 'Rose', solid: '#be123c', soft: 'rgba(225,29,72,.12)', line: '#e11d48' },
  { name: 'Green', solid: '#15803d', soft: 'rgba(22,163,74,.14)', line: '#16a34a' },
];

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const ORG: Organization = {
  id: 'org-1',
  name: 'Summit Local',
  plan: 'Growth',
  brandIds: ['b-green', 'b-harbor', 'b-velvet', 'b-loop'],
};

export const USERS: User[] = [
  { id: 'u-dana', name: 'Dana Reyes', initials: 'DR', role: 'owner', email: 'dana@summitlocal.co', twoFactorEnabled: true },
  { id: 'u-sam', name: 'Sam Patel', initials: 'SP', role: 'manager', email: 'sam@summitlocal.co', twoFactorEnabled: true },
  { id: 'u-alex', name: 'Alex Kim', initials: 'AK', role: 'creator', email: 'alex@summitlocal.co', twoFactorEnabled: false },
  { id: 'u-jordan', name: 'Jordan Lee', initials: 'JL', role: 'approver', email: 'jordan@harborviewrentals.com', twoFactorEnabled: true },
];

export const BRANDS: Brand[] = [
  { id: 'b-green', name: 'GreenScape Landscaping', industry: 'landscaping', colorIndex: 5, location: 'Maplewood, NJ', website: 'greenscapenj.com' },
  { id: 'b-harbor', name: 'Harborview Rentals', industry: 'house_rentals', colorIndex: 1, location: 'Portsmouth, NH', website: 'harborviewrentals.com' },
  { id: 'b-velvet', name: 'Velvet Room Studio', industry: 'music_studio', colorIndex: 2, location: 'Nashville, TN', website: 'velvetroomstudio.com' },
  { id: 'b-loop', name: 'Loopwise Software', industry: 'software', colorIndex: 3, location: 'Austin, TX', website: 'loopwise.app' },
];

// ---------------------------------------------------------------------------
// Connected accounts (workspace-level in the prototype)
// ---------------------------------------------------------------------------

export const ACCOUNTS: ConnectedAccount[] = [
  {
    id: 'a-fb', channel: 'facebook', displayName: 'Facebook — 4 Pages', destinationKind: 'Pages',
    status: 'connected', brandId: null, connectedByUserId: 'u-dana',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_messaging'],
    expiresAt: '2026-12-04', lastSyncAt: '2026-10-08T07:40',
  },
  {
    id: 'a-ig', channel: 'instagram', displayName: 'Instagram — 3 professional accounts', destinationKind: 'Business accounts',
    status: 'connected', brandId: null, connectedByUserId: 'u-dana',
    scopes: ['instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights'],
    expiresAt: '2026-12-04', lastSyncAt: '2026-10-08T07:40',
  },
  {
    id: 'a-li', channel: 'linkedin', displayName: 'LinkedIn — 2 company pages', destinationKind: 'Company pages',
    status: 'needs_reconnect', brandId: null, connectedByUserId: 'u-dana',
    scopes: ['w_organization_social', 'r_organization_social'],
    expiresAt: '2026-10-06', lastSyncAt: '2026-10-06T02:10',
  },
  {
    id: 'a-gbp', channel: 'google_business', displayName: 'Google Business Profile — 3 locations', destinationKind: 'Locations',
    status: 'connected', brandId: null, connectedByUserId: 'u-sam',
    scopes: ['business.manage'],
    expiresAt: null, lastSyncAt: '2026-10-08T06:15',
  },
  {
    id: 'a-em', channel: 'email', displayName: 'hello@summitlocal.co — verified sender domain', destinationKind: 'Sender domain',
    status: 'connected', brandId: null, connectedByUserId: 'u-dana',
    scopes: ['SPF ✓', 'DKIM ✓', 'DMARC ✓'],
    expiresAt: null, lastSyncAt: '2026-10-08T05:00',
  },
  {
    id: 'a-web', channel: 'website', displayName: 'greenscapenj.com (WordPress) + 2 more', destinationKind: 'Sites',
    status: 'connected', brandId: null, connectedByUserId: 'u-sam',
    scopes: ['posts.write', 'pages.write'],
    expiresAt: null, lastSyncAt: '2026-10-07T22:30',
  },
  {
    id: 'a-x', channel: 'x', displayName: '@loopwise — X', destinationKind: 'Accounts',
    status: 'connected', brandId: 'b-loop', connectedByUserId: 'u-sam',
    scopes: ['tweet.read', 'tweet.write', 'users.read'],
    expiresAt: null, lastSyncAt: '2026-10-08T07:40',
  },
  { id: 'a-tt', channel: 'tiktok', displayName: 'TikTok', destinationKind: 'Accounts', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-yt', channel: 'youtube', displayName: 'YouTube', destinationKind: 'Channels', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-th', channel: 'threads', displayName: 'Threads', destinationKind: 'Profiles', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-bsky', channel: 'bluesky', displayName: 'Bluesky', destinationKind: 'Accounts', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-pin', channel: 'pinterest', displayName: 'Pinterest', destinationKind: 'Business accounts', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-rdt', channel: 'reddit', displayName: 'Reddit', destinationKind: 'Accounts', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-nd', channel: 'nextdoor', displayName: 'Nextdoor', destinationKind: 'Business pages', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-sc', channel: 'snapchat', displayName: 'Snapchat', destinationKind: 'Public profiles', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-wa', channel: 'whatsapp', displayName: 'WhatsApp Business', destinationKind: 'Business numbers', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
  { id: 'a-sms', channel: 'sms', displayName: 'SMS', destinationKind: 'Sending numbers', status: 'not_connected', brandId: null, connectedByUserId: null, scopes: [], expiresAt: null, lastSyncAt: null },
];

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export const MEDIA: MediaAsset[] = [
  { id: 'm-fallpromo', kind: 'image', name: 'Fall promo graphic', gradient: ['#d97706', '#92400e'], glyph: '🍁', altText: 'Fall Cleanup Promotion — free estimates through October 31', durationSec: null, aspectRatio: '1:1', tags: ['fall-cleanup', 'promo'], brandId: 'b-green', uploadedAt: '2026-09-12', sizeKB: 420 },
  { id: 'm-leaves', kind: 'image', name: 'Backyard leaf blanket', gradient: ['#f59e0b', '#7c2d12'], glyph: '🍂', altText: 'Lawn covered in autumn leaves before cleanup', durationSec: null, aspectRatio: '3:2', tags: ['fall-cleanup', 'before'], brandId: 'b-green', uploadedAt: '2026-09-14', sizeKB: 610 },
  { id: 'm-beforeafter', kind: 'image', name: 'Before & after — Maple Ave', gradient: ['#16a34a', '#166534'], glyph: '🏡', altText: 'Side-by-side of a yard before and after fall cleanup', durationSec: null, aspectRatio: '1:1', tags: ['fall-cleanup', 'results'], brandId: 'b-green', uploadedAt: '2026-09-28', sizeKB: 540 },
  { id: 'm-crew', kind: 'image', name: 'Crew raking (vertical)', gradient: ['#ea580c', '#78350f'], glyph: '🧹', altText: 'GreenScape crew raking leaves into tarps', durationSec: null, aspectRatio: '9:16', tags: ['crew', 'fall-cleanup'], brandId: 'b-green', uploadedAt: '2026-10-01', sizeKB: 480 },
  { id: 'm-timelapse', kind: 'video', name: 'Leaf cleanup time-lapse', gradient: ['#b45309', '#451a03'], glyph: '🎬', altText: null, durationSec: 52, aspectRatio: '9:16', tags: ['fall-cleanup', 'video'], brandId: 'b-green', uploadedAt: '2026-10-03', sizeKB: 18400 },
  { id: 'm-hendersons', kind: 'image', name: 'Henderson front yard', gradient: ['#65a30d', '#14532d'], glyph: '🌳', altText: null, durationSec: null, aspectRatio: '4:5', tags: ['testimonial'], brandId: 'b-green', uploadedAt: '2026-10-05', sizeKB: 505 },
  { id: 'm-frost', kind: 'image', name: 'Frost on lawn', gradient: ['#93c5fd', '#1e3a8a'], glyph: '❄️', altText: null, durationSec: null, aspectRatio: '3:2', tags: ['winter-prep'], brandId: 'b-green', uploadedAt: '2026-10-06', sizeKB: 380 },
  { id: 'm-harbor-ext', kind: 'image', name: '12 Harbor Lane exterior', gradient: ['#2563eb', '#1e3a8a'], glyph: '🏠', altText: 'Gray shingle two-bedroom cottage at 12 Harbor Lane', durationSec: null, aspectRatio: '3:2', tags: ['harbor-lane', 'listing'], brandId: 'b-harbor', uploadedAt: '2026-10-02', sizeKB: 720 },
  { id: 'm-harbor-kitchen', kind: 'image', name: 'Harbor Lane kitchen', gradient: ['#0ea5e9', '#0c4a6e'], glyph: '🛋️', altText: 'Renovated kitchen with harbor view window', durationSec: null, aspectRatio: '1:1', tags: ['harbor-lane', 'interior'], brandId: 'b-harbor', uploadedAt: '2026-10-02', sizeKB: 615 },
  { id: 'm-walkthrough', kind: 'video', name: 'Harbor Lane walkthrough', gradient: ['#3b82f6', '#1e40af'], glyph: '🎥', altText: null, durationSec: 118, aspectRatio: '9:16', tags: ['harbor-lane', 'video'], brandId: 'b-harbor', uploadedAt: '2026-10-04', sizeKB: 42100 },
  { id: 'm-mira', kind: 'image', name: 'Mira Vance session', gradient: ['#7c3aed', '#4c1d95'], glyph: '🎙️', altText: 'Mira Vance recording vocals in Studio A', durationSec: null, aspectRatio: '4:5', tags: ['artists', 'studio-a'], brandId: 'b-velvet', uploadedAt: '2026-09-30', sizeKB: 495 },
  { id: 'm-console', kind: 'image', name: 'Studio console', gradient: ['#8b5cf6', '#312e81'], glyph: '🎚️', altText: 'Mixing console with tape machine in Studio A', durationSec: null, aspectRatio: '16:9', tags: ['gear'], brandId: 'b-velvet', uploadedAt: '2026-09-20', sizeKB: 530 },
  { id: 'm-webinar', kind: 'image', name: 'Webinar cover', gradient: ['#0d9488', '#134e4a'], glyph: '💻', altText: 'Autumn onboarding webinar — October 22, 1 PM ET', durationSec: null, aspectRatio: '16:9', tags: ['webinar'], brandId: 'b-loop', uploadedAt: '2026-09-26', sizeKB: 310 },
  { id: 'm-logo-green', kind: 'logo', name: 'GreenScape logo', gradient: ['#16a34a', '#052e16'], glyph: '🌿', altText: 'GreenScape Landscaping logo', durationSec: null, aspectRatio: '1:1', tags: ['brand'], brandId: 'b-green', uploadedAt: '2026-06-01', sizeKB: 88 },
];

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'c-fall', brandId: 'b-green', name: 'Fall Cleanup Promotion', status: 'active',
    goal: 'quote_requests', audience: 'Homeowners within 25 miles of Maplewood',
    startDate: '2026-09-15', endDate: '2026-10-31',
    offer: 'Free estimate', cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
    colorIndex: 0, utmCode: 'fall-cleanup-2026', createdByUserId: 'u-dana', templateId: 't-land-seasonal',
    description: 'Book fall cleanups before the November freeze: leaf removal, gutter clearing, and bed winterization with a free estimate.',
  },
  {
    id: 'c-openhouse', brandId: 'b-harbor', name: 'Open House: 12 Harbor Lane', status: 'scheduled',
    goal: 'rental_inquiries', audience: 'Renters searching the Portsmouth waterfront',
    startDate: '2026-10-10', endDate: '2026-10-18',
    offer: 'First month half off on 12-month leases', cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
    colorIndex: 1, utmCode: 'harbor-lane-open-house', createdByUserId: 'u-sam', templateId: 't-rent-openhouse',
    description: 'New two-bedroom listing with an open house weekend October 17–18.',
  },
  {
    id: 'c-sessions', brandId: 'b-velvet', name: 'Fall Session Openings', status: 'active',
    goal: 'bookings', audience: 'Local artists, producers, and podcasters',
    startDate: '2026-09-29', endDate: '2026-11-07',
    offer: '10% off first session', cta: { label: 'Book Studio Time', url: 'https://velvetroomstudio.com/book' },
    colorIndex: 2, utmCode: 'fall-sessions-2026', createdByUserId: 'u-alex', templateId: 't-music-openings',
    description: 'Fill October and early-November studio slots with artist spotlights and open-slot announcements.',
  },
  {
    id: 'c-webinar', brandId: 'b-loop', name: 'Autumn Onboarding Webinar', status: 'active',
    goal: 'trial_signups', audience: 'Ops managers at 10–50 person companies',
    startDate: '2026-10-01', endDate: '2026-10-22',
    offer: 'Live Q&A + template pack for attendees', cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
    colorIndex: 3, utmCode: 'autumn-webinar-2026', createdByUserId: 'u-sam', templateId: 't-soft-webinar',
    description: 'Drive registrations for the October 22 live onboarding webinar; convert registrants to trials.',
  },
  {
    id: 'c-summer', brandId: 'b-green', name: 'Summer Maintenance Special', status: 'completed',
    goal: 'quote_requests', audience: 'Homeowners within 25 miles of Maplewood',
    startDate: '2026-06-15', endDate: '2026-08-31',
    offer: '15% off season-long maintenance plans', cta: { label: 'Get a Quote', url: 'https://greenscapenj.com/summer' },
    colorIndex: 5, utmCode: 'summer-maintenance-2026', createdByUserId: 'u-dana', templateId: 't-land-seasonal',
    description: 'Season-long mowing, edging, and bed maintenance plans. Completed August 31.',
  },
];

// ---------------------------------------------------------------------------
// Content items
// ---------------------------------------------------------------------------

export const CONTENT_ITEMS: ContentItem[] = [
  { id: 'ci-fall-announce', campaignId: 'c-fall', title: 'Cleanup announcement', kind: 'social', coreMessage: 'Fall cleanup season is here. Leaf removal, gutter clearing, and bed winterization — free estimates through October 31.' },
  { id: 'ci-fall-before', campaignId: 'c-fall', title: 'Before & after: Maple Ave', kind: 'social', coreMessage: 'One afternoon, one crew, one very different yard. See what a full fall cleanup looks like.' },
  { id: 'ci-fall-reel', campaignId: 'c-fall', title: 'Leaf time-lapse Reel', kind: 'social', coreMessage: 'Four hours of cleanup in 52 seconds.' },
  { id: 'ci-fall-li2', campaignId: 'c-fall', title: 'Commercial properties: fall prep', kind: 'social', coreMessage: 'Property managers: fall cleanup slots for commercial lots are open — schedule before the November freeze.' },
  { id: 'ci-fall-tips', campaignId: 'c-fall', title: '5 signs your yard needs a cleanup', kind: 'social', coreMessage: 'Matted leaves smother turf and invite mold. Five signs it’s time — and what a cleanup includes.' },
  { id: 'ci-fall-email1', campaignId: 'c-fall', title: 'Announcement email', kind: 'email', coreMessage: 'Fall cleanup is booking fast — free estimates through October.' },
  { id: 'ci-fall-email2', campaignId: 'c-fall', title: 'Last-call follow-up email', kind: 'email', coreMessage: 'Last call: free fall cleanup estimates end October 31.' },
  { id: 'ci-fall-testimonial', campaignId: 'c-fall', title: 'Customer testimonial: the Hendersons', kind: 'social', coreMessage: '“The yard looked better than the day we moved in.” — the Hendersons, Maplewood' },
  { id: 'ci-fall-banner', campaignId: 'c-fall', title: 'Website banner', kind: 'website', coreMessage: 'Fall Cleanup Promotion — free estimates through Oct 31.' },
  { id: 'ci-fall-landing', campaignId: 'c-fall', title: 'Fall cleanup landing page', kind: 'website', coreMessage: 'Request a free fall cleanup estimate.' },
  { id: 'ci-fall-gbp2', campaignId: 'c-fall', title: 'October GBP update', kind: 'social', coreMessage: 'October cleanup slots are filling — free estimates through the 31st.' },
  { id: 'ci-fall-frost', campaignId: 'c-fall', title: 'Frost prep checklist', kind: 'social', coreMessage: 'First frost is coming. A five-point checklist to get beds and turf ready.' },

  { id: 'ci-oh-listing', campaignId: 'c-openhouse', title: 'Listing announcement', kind: 'social', coreMessage: 'Just listed: 12 Harbor Lane — a renovated two-bedroom steps from the waterfront. Open house Oct 17–18.' },
  { id: 'ci-oh-tour', campaignId: 'c-openhouse', title: 'Video walkthrough', kind: 'social', coreMessage: '60 seconds inside 12 Harbor Lane.' },
  { id: 'ci-oh-openday', campaignId: 'c-openhouse', title: 'Open house weekend', kind: 'social', coreMessage: 'Open house this weekend at 12 Harbor Lane, 10 AM – 2 PM. First month half off on 12-month leases.' },

  { id: 'ci-ss-spotlight', campaignId: 'c-sessions', title: 'Artist spotlight: Mira Vance', kind: 'social', coreMessage: 'Mira Vance tracked her new single in Studio A last week. Fall slots are open — first session 10% off.' },
  { id: 'ci-ss-slots', campaignId: 'c-sessions', title: 'October open slots', kind: 'social', coreMessage: 'Three October evenings just opened in Studio A. First-time artists get 10% off.' },
  { id: 'ci-ss-gear', campaignId: 'c-sessions', title: 'Gear tour Reel', kind: 'social', coreMessage: 'The console, the tape machine, the mic locker — 45 seconds in Studio A.' },

  { id: 'ci-wb-announce', campaignId: 'c-webinar', title: 'Webinar announcement', kind: 'social', coreMessage: 'Live onboarding webinar, October 22 at 1 PM ET: set up Loopwise in 45 minutes, plus a template pack for attendees.' },
  { id: 'ci-wb-reminder', campaignId: 'c-webinar', title: 'One-week reminder', kind: 'social', coreMessage: 'One week out: the live onboarding webinar is October 22. Seats are limited — save yours.' },
  { id: 'ci-wb-day', campaignId: 'c-webinar', title: 'Day-of push', kind: 'social', coreMessage: 'We’re live at 1 PM ET today. Last chance to grab a seat.' },

  { id: 'ci-sm-wrap', campaignId: 'c-summer', title: 'Summer wrap-up', kind: 'social', coreMessage: 'Summer maintenance season wrap: 34 new maintenance plans. Thank you, Maplewood.' },
  { id: 'ci-sm-email', campaignId: 'c-summer', title: 'Summer announcement email', kind: 'email', coreMessage: '15% off season-long maintenance plans.' },
];

// ---------------------------------------------------------------------------
// Channel variations
// ---------------------------------------------------------------------------

type V = ChannelVariation;
const base = {
  subject: null, preheader: null, hasUnsubscribeFooter: true, mediaIds: [] as string[],
  cta: null, hashtags: [] as string[], assigneeUserId: null, overridden: false,
  failure: null, publishedAt: null, scheduledAt: null,
} satisfies Partial<V>;

export const VARIATIONS: ChannelVariation[] = [
  // --- Fall Cleanup Promotion -------------------------------------------------
  {
    ...base, id: 'v-fb-1', contentItemId: 'ci-fall-announce', campaignId: 'c-fall', channel: 'facebook', format: 'post',
    status: 'published', scheduledAt: '2026-09-16T10:00', publishedAt: '2026-09-16T10:00',
    body: 'Fall cleanup season is officially here 🍂 Leaf removal, gutter clearing, and bed winterization — done in one visit, before the first freeze. We’re offering free estimates through October 31. Tap below to request yours.',
    mediaIds: ['m-fallpromo'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-ig-1', contentItemId: 'ci-fall-announce', campaignId: 'c-fall', channel: 'instagram', format: 'post',
    status: 'published', scheduledAt: '2026-09-16T10:00', publishedAt: '2026-09-16T10:00',
    body: 'Fall cleanup season is here 🍂 One visit: leaves gone, gutters clear, beds tucked in for winter. Free estimates through Oct 31 — link in bio.',
    mediaIds: ['m-fallpromo'], hashtags: ['fallcleanup', 'landscaping', 'maplewoodnj', 'lawncare'],
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-li-1', contentItemId: 'ci-fall-announce', campaignId: 'c-fall', channel: 'linkedin', format: 'post',
    status: 'published', scheduledAt: '2026-09-17T09:00', publishedAt: '2026-09-17T09:00',
    body: 'Fall cleanup scheduling is open. For HOAs and property managers in Essex County: leaf removal, gutter clearing, and winterization handled in one coordinated visit, with photos on completion. Free estimates through October 31.',
    mediaIds: ['m-leaves'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' }, overridden: true,
  },
  {
    ...base, id: 'v-gbp-1', contentItemId: 'ci-fall-announce', campaignId: 'c-fall', channel: 'google_business', format: 'update',
    status: 'published', scheduledAt: '2026-09-18T11:00', publishedAt: '2026-09-18T11:00',
    body: 'Fall cleanup season is here. Leaf removal, gutter clearing, and bed winterization — free estimates through October 31.',
    mediaIds: ['m-fallpromo'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-ig-2', contentItemId: 'ci-fall-before', campaignId: 'c-fall', channel: 'instagram', format: 'post',
    status: 'published', scheduledAt: '2026-09-30T12:30', publishedAt: '2026-09-30T12:30',
    body: 'One afternoon on Maple Ave 🏡 Swipe for the before. Full cleanup: leaves, gutters, beds, haul-away. Free estimates through Oct 31 — link in bio.',
    mediaIds: ['m-beforeafter'], hashtags: ['beforeandafter', 'fallcleanup', 'maplewoodnj'],
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-fb-2', contentItemId: 'ci-fall-before', campaignId: 'c-fall', channel: 'facebook', format: 'post',
    status: 'published', scheduledAt: '2026-09-30T12:30', publishedAt: '2026-09-30T12:30',
    body: 'One afternoon, one crew, one very different yard. This Maple Ave cleanup included leaf removal, gutter clearing, and bed winterization. Want yours on the schedule? Free estimates through October 31.',
    mediaIds: ['m-beforeafter'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-ig-reel', contentItemId: 'ci-fall-reel', campaignId: 'c-fall', channel: 'instagram', format: 'reel',
    status: 'scheduled', scheduledAt: '2026-10-09T17:00',
    body: 'Four hours of cleanup in 52 seconds 🍂⏱️ Free estimates through Oct 31 — link in bio.',
    mediaIds: ['m-timelapse'], hashtags: ['fallcleanup', 'timelapse', 'satisfying'],
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' }, assigneeUserId: 'u-alex',
  },
  {
    ...base, id: 'v-li-2', contentItemId: 'ci-fall-li2', campaignId: 'c-fall', channel: 'linkedin', format: 'post',
    status: 'failed', scheduledAt: '2026-10-07T09:00',
    body: 'Property managers: commercial fall cleanup slots are open. Multi-lot scheduling, photo documentation, and one invoice. Book before the November freeze.',
    mediaIds: ['m-leaves'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
    failure: { code: 'auth_expired', message: 'LinkedIn session expired — reconnect to resume publishing.', attempts: 3, lastTriedAt: '2026-10-07T09:24', willRetry: false },
  },
  {
    ...base, id: 'v-fb-3', contentItemId: 'ci-fall-tips', campaignId: 'c-fall', channel: 'facebook', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-10T09:30',
    body: 'Matted leaves smother turf and invite snow mold. Five signs your yard needs a cleanup before winter — and what a full visit includes. Free estimates through October 31.',
    mediaIds: ['m-leaves'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-blog-1', contentItemId: 'ci-fall-tips', campaignId: 'c-fall', channel: 'website', format: 'blog',
    status: 'approved', scheduledAt: '2026-10-14T08:00',
    body: '5 Signs Your Yard Needs a Fall Cleanup (and What “Full Cleanup” Actually Includes) — 900-word post covering matted leaves, clogged gutters, snow mold risk, perennial bed prep, and haul-away.',
    mediaIds: ['m-leaves'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' }, assigneeUserId: 'u-alex',
  },
  {
    ...base, id: 'v-em-1', contentItemId: 'ci-fall-email1', campaignId: 'c-fall', channel: 'email', format: 'email',
    status: 'published', scheduledAt: '2026-09-22T08:00', publishedAt: '2026-09-22T08:00',
    subject: 'Fall cleanup is booking fast — free estimates through October',
    preheader: 'Leaf removal, gutters, and winterization in one visit.',
    body: 'Hi {{first_name}},\n\nThe leaves are ahead of schedule this year — our crews are already booking into late October.\n\nA GreenScape fall cleanup covers leaf removal and haul-away, gutter clearing, and perennial bed winterization in a single visit.\n\nEstimates are free through October 31, and October Saturdays go first.',
    mediaIds: ['m-fallpromo'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-em-2', contentItemId: 'ci-fall-email2', campaignId: 'c-fall', channel: 'email', format: 'email',
    status: 'review', scheduledAt: '2026-10-20T08:00',
    subject: 'Last call: free fall cleanup estimates end Oct 31',
    preheader: null,
    hasUnsubscribeFooter: false,
    body: 'Hi {{first_name}},\n\nQuick heads-up: free fall cleanup estimates end October 31, and the last October crew slots are going now.\n\nIf you’ve been waiting for the leaves to finish falling — this is the week to lock in a spot.',
    mediaIds: ['m-leaves'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' }, assigneeUserId: 'u-sam',
  },
  {
    ...base, id: 'v-ig-3', contentItemId: 'ci-fall-testimonial', campaignId: 'c-fall', channel: 'instagram', format: 'post',
    status: 'review', scheduledAt: '2026-10-13T12:00',
    body: '“The yard looked better than the day we moved in.” 🌳 Thank you, Henderson family! October slots are almost full — free estimates through the 31st, link in bio.',
    mediaIds: ['m-hendersons'], hashtags: ['customerlove', 'fallcleanup', 'maplewoodnj'],
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' }, assigneeUserId: 'u-alex',
  },
  {
    ...base, id: 'v-banner-1', contentItemId: 'ci-fall-banner', campaignId: 'c-fall', channel: 'website', format: 'banner',
    status: 'published', scheduledAt: '2026-09-15T08:00', publishedAt: '2026-09-15T08:00',
    body: 'Fall Cleanup Promotion — free estimates through Oct 31.',
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-landing-1', contentItemId: 'ci-fall-landing', campaignId: 'c-fall', channel: 'website', format: 'landing_page',
    status: 'published', scheduledAt: '2026-09-15T08:00', publishedAt: '2026-09-15T08:00',
    body: 'Fall cleanup landing page: offer, checklist of what’s included, six photos, testimonial block, and the quote-request form. Tracked link + QR code active.',
    cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-gbp-2', contentItemId: 'ci-fall-gbp2', campaignId: 'c-fall', channel: 'google_business', format: 'update',
    status: 'draft', scheduledAt: '2026-10-15T10:00',
    body: 'October cleanup slots are filling. Free estimates through the 31st — request yours online.',
    mediaIds: ['m-crew'], cta: { label: 'Request a Quote', url: 'https://greenscapenj.com/fall-cleanup' },
  },
  {
    ...base, id: 'v-idea-frost', contentItemId: 'ci-fall-frost', campaignId: 'c-fall', channel: 'instagram', format: 'post',
    status: 'idea', body: 'First frost is coming ❄️ Five things to do before it lands — save this checklist.',
    mediaIds: ['m-frost'], assigneeUserId: 'u-alex',
  },

  // --- Open House: 12 Harbor Lane --------------------------------------------
  {
    ...base, id: 'v-oh-fb', contentItemId: 'ci-oh-listing', campaignId: 'c-openhouse', channel: 'facebook', format: 'post',
    status: 'approved', scheduledAt: '2026-10-10T12:00',
    body: 'Just listed 🏠 12 Harbor Lane — renovated two-bedroom, in-unit laundry, three blocks from the waterfront. Open house Oct 17–18, 10 AM–2 PM. First month half off on 12-month leases.',
    mediaIds: ['m-harbor-ext'], cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
  },
  {
    ...base, id: 'v-oh-ig', contentItemId: 'ci-oh-listing', campaignId: 'c-openhouse', channel: 'instagram', format: 'post',
    status: 'approved', scheduledAt: '2026-10-10T12:00',
    body: 'Just listed: 12 Harbor Lane ⚓ Renovated 2BR, three blocks to the water. Open house Oct 17–18 — book a private tour at the link in bio.',
    mediaIds: ['m-harbor-kitchen'], hashtags: ['portsmouthnh', 'forrent', 'openhouse'],
    cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
  },
  {
    ...base, id: 'v-oh-em', contentItemId: 'ci-oh-listing', campaignId: 'c-openhouse', channel: 'email', format: 'email',
    status: 'approved', scheduledAt: '2026-10-12T09:00',
    subject: 'New listing: 12 Harbor Lane — open house Oct 17–18',
    preheader: 'Renovated 2BR near the waterfront. Waitlist gets first pick.',
    body: 'Hi {{first_name}},\n\nYou asked to hear when something opened near the waterfront — 12 Harbor Lane just listed.\n\nRenovated two-bedroom, in-unit laundry, small-pet friendly. Open house October 17–18, 10 AM–2 PM, and waitlist members can book private tours first.',
    mediaIds: ['m-harbor-ext'], cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
  },
  {
    ...base, id: 'v-oh-reel', contentItemId: 'ci-oh-tour', campaignId: 'c-openhouse', channel: 'instagram', format: 'reel',
    status: 'draft', scheduledAt: '2026-10-14T17:30',
    body: '60 seconds inside 12 Harbor Lane ⚓ Open house this weekend — link in bio.',
    mediaIds: ['m-walkthrough'], hashtags: ['apartmenttour', 'portsmouthnh'],
    cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' }, assigneeUserId: 'u-alex',
  },
  {
    ...base, id: 'v-oh-gbp', contentItemId: 'ci-oh-openday', campaignId: 'c-openhouse', channel: 'google_business', format: 'update',
    status: 'scheduled', scheduledAt: '2026-10-16T10:00',
    body: 'Open house this weekend: 12 Harbor Lane, Saturday–Sunday 10 AM–2 PM. Renovated two-bedroom near the waterfront.',
    mediaIds: ['m-harbor-ext'], cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
  },
  {
    ...base, id: 'v-oh-fb2', contentItemId: 'ci-oh-openday', campaignId: 'c-openhouse', channel: 'facebook', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-17T08:00',
    body: 'Open house TODAY at 12 Harbor Lane, 10 AM–2 PM ⚓ Come see the renovated kitchen and the three-block walk to the water. First month half off on 12-month leases.',
    mediaIds: ['m-harbor-kitchen'], cta: { label: 'Book a Tour', url: 'https://harborviewrentals.com/12-harbor-lane' },
  },

  // --- Fall Session Openings ---------------------------------------------------
  {
    ...base, id: 'v-ss-ig', contentItemId: 'ci-ss-spotlight', campaignId: 'c-sessions', channel: 'instagram', format: 'post',
    status: 'published', scheduledAt: '2026-10-02T18:00', publishedAt: '2026-10-02T18:00',
    body: 'Mira Vance tracking her new single in Studio A 🎙️ Fall slots are open — first-time artists get 10% off. Book at the link in bio.',
    mediaIds: ['m-mira'], hashtags: ['nashvillestudio', 'recordingstudio', 'newmusic'],
    cta: { label: 'Book Studio Time', url: 'https://velvetroomstudio.com/book' },
  },
  {
    ...base, id: 'v-ss-fb', contentItemId: 'ci-ss-spotlight', campaignId: 'c-sessions', channel: 'facebook', format: 'post',
    status: 'published', scheduledAt: '2026-10-02T18:00', publishedAt: '2026-10-02T18:00',
    body: 'Mira Vance was in Studio A last week tracking her new single. Fall session slots are open now — first session is 10% off for new artists.',
    mediaIds: ['m-mira'], cta: { label: 'Book Studio Time', url: 'https://velvetroomstudio.com/book' },
  },
  {
    ...base, id: 'v-ss-ig2', contentItemId: 'ci-ss-slots', campaignId: 'c-sessions', channel: 'instagram', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-09T11:00',
    body: 'Three October evenings just opened in Studio A 🎚️ First-time artists get 10% off. Grab one before they’re gone — link in bio.',
    mediaIds: ['m-console'], hashtags: ['nashvillestudio', 'studiotime'],
    cta: { label: 'Book Studio Time', url: 'https://velvetroomstudio.com/book' },
  },
  {
    ...base, id: 'v-ss-em', contentItemId: 'ci-ss-slots', campaignId: 'c-sessions', channel: 'email', format: 'email',
    status: 'approved', scheduledAt: '2026-10-15T10:00',
    subject: 'Three October evenings just opened in Studio A',
    preheader: 'First session 10% off for new artists.',
    body: 'Hey {{first_name}},\n\nThree October evening slots just opened up in Studio A — the room with the console and the tape machine.\n\nIf you’ve been sitting on demos, this is the nudge. First session is 10% off for new artists.',
    mediaIds: ['m-console'], cta: { label: 'Book Studio Time', url: 'https://velvetroomstudio.com/book' },
  },
  {
    ...base, id: 'v-ss-idea', contentItemId: 'ci-ss-gear', campaignId: 'c-sessions', channel: 'instagram', format: 'reel',
    status: 'idea', body: 'The console, the tape machine, the mic locker — 45 seconds in Studio A.',
    mediaIds: ['m-console'],
  },

  // --- Autumn Onboarding Webinar ----------------------------------------------
  {
    ...base, id: 'v-wb-li', contentItemId: 'ci-wb-announce', campaignId: 'c-webinar', channel: 'linkedin', format: 'post',
    status: 'published', scheduledAt: '2026-10-01T09:00', publishedAt: '2026-10-01T09:00',
    body: 'We’re running a live onboarding webinar on October 22 (1 PM ET): set up Loopwise for your team in 45 minutes, with live Q&A. Attendees get our ops template pack. Seats are limited.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-em', contentItemId: 'ci-wb-announce', campaignId: 'c-webinar', channel: 'email', format: 'email',
    status: 'published', scheduledAt: '2026-10-02T08:00', publishedAt: '2026-10-02T08:00',
    subject: 'Live onboarding webinar — Oct 22, 1 PM ET',
    preheader: 'Set up Loopwise in 45 minutes. Template pack included.',
    body: 'Hi {{first_name}},\n\nWe’re hosting a live onboarding webinar on October 22 at 1 PM ET.\n\nIn 45 minutes we’ll set up a real workspace end to end — intake, routing, reporting — and take live questions. Everyone who attends gets the ops template pack.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-x1', contentItemId: 'ci-wb-announce', campaignId: 'c-webinar', channel: 'x', format: 'post',
    status: 'published', scheduledAt: '2026-10-01T09:15', publishedAt: '2026-10-01T09:15',
    body: 'Live onboarding webinar, Oct 22 at 1 PM ET: a real Loopwise workspace set up end to end in 45 minutes, live Q&A, template pack for attendees. Seats are limited 🧵',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' }, overridden: true,
  },
  {
    ...base, id: 'v-wb-x2', contentItemId: 'ci-wb-reminder', campaignId: 'c-webinar', channel: 'x', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-15T09:15',
    body: 'One week out: live onboarding webinar Oct 22, 1 PM ET. 45 minutes, real workspace, live Q&A, template pack. Save your seat →',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-li2', contentItemId: 'ci-wb-reminder', campaignId: 'c-webinar', channel: 'linkedin', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-15T09:00',
    body: 'One week out: our live onboarding webinar is October 22 at 1 PM ET. 45 minutes, a real workspace built end to end, live Q&A, template pack for attendees.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-em2', contentItemId: 'ci-wb-reminder', campaignId: 'c-webinar', channel: 'email', format: 'email',
    status: 'approved', scheduledAt: '2026-10-15T08:00',
    subject: 'One week left — save your webinar seat',
    preheader: 'Oct 22, 1 PM ET. Live setup + Q&A.',
    body: 'Hi {{first_name}},\n\nOne week to go: the live onboarding webinar is Wednesday, October 22 at 1 PM ET.\n\nWe’ll build a working Loopwise workspace live — and you’ll leave with the template pack.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-fb', contentItemId: 'ci-wb-reminder', campaignId: 'c-webinar', channel: 'facebook', format: 'post',
    status: 'scheduled', scheduledAt: '2026-10-15T09:30',
    body: 'One week out: live Loopwise onboarding webinar, October 22 at 1 PM ET. Watch a real workspace get set up in 45 minutes and take home the template pack.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },
  {
    ...base, id: 'v-wb-li3', contentItemId: 'ci-wb-day', campaignId: 'c-webinar', channel: 'linkedin', format: 'post',
    status: 'draft', scheduledAt: '2026-10-22T08:30',
    body: 'We’re live at 1 PM ET today — final call for the onboarding webinar. Live setup, live Q&A, template pack for attendees.',
    mediaIds: ['m-webinar'], cta: { label: 'Save Your Seat', url: 'https://loopwise.app/webinar-fall' },
  },

  // --- Summer Maintenance Special (completed) ---------------------------------
  {
    ...base, id: 'v-sm-fb', contentItemId: 'ci-sm-wrap', campaignId: 'c-summer', channel: 'facebook', format: 'post',
    status: 'published', scheduledAt: '2026-08-28T10:00', publishedAt: '2026-08-28T10:00',
    body: 'Summer maintenance season wrap: 34 new season-long plans. Thank you, Maplewood — see you for fall cleanup.',
    mediaIds: ['m-logo-green'],
  },
  {
    ...base, id: 'v-sm-em', contentItemId: 'ci-sm-email', campaignId: 'c-summer', channel: 'email', format: 'email',
    status: 'published', scheduledAt: '2026-06-15T08:00', publishedAt: '2026-06-15T08:00',
    subject: '15% off season-long maintenance plans',
    preheader: 'Mowing, edging, and beds — handled all summer.',
    body: 'Hi {{first_name}},\n\nSummer maintenance plans are open: weekly mowing, edging, and bed upkeep, one flat monthly rate — 15% off if you book by June 30.',
    mediaIds: ['m-logo-green'], cta: { label: 'Get a Quote', url: 'https://greenscapenj.com/summer' },
  },
];

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export const APPROVALS: Approval[] = [
  { id: 'ap-1', variationId: 'v-em-2', requestedByUserId: 'u-sam', requestedAt: '2026-10-06T15:20', approverUserId: 'u-dana', decidedAt: null, decision: 'pending', note: 'Last-call email — needs the unsubscribe footer added before it can go.' },
  { id: 'ap-2', variationId: 'v-ig-3', requestedByUserId: 'u-alex', requestedAt: '2026-10-07T11:05', approverUserId: 'u-dana', decidedAt: null, decision: 'pending', note: 'Henderson testimonial — confirm we have photo permission on file.' },
  { id: 'ap-3', variationId: 'v-oh-fb', requestedByUserId: 'u-sam', requestedAt: '2026-10-05T09:40', approverUserId: 'u-jordan', decidedAt: '2026-10-06T10:12', decision: 'approved', note: 'Listing copy approved by Harborview.' },
];

// ---------------------------------------------------------------------------
// Contacts & segments
// ---------------------------------------------------------------------------

export const SEGMENTS: AudienceSegment[] = [
  { id: 's-north', brandId: 'b-green', name: 'Homeowners — North Side', description: 'Quote requests and past estimates north of Springfield Ave.', contactCount: 412 },
  { id: 's-past', brandId: 'b-green', name: 'Past Clients', description: 'Completed at least one job in the last 24 months.', contactCount: 168 },
  { id: 's-news', brandId: 'b-green', name: 'Newsletter', description: 'Monthly tips list from the website signup form.', contactCount: 1240 },
  { id: 's-wait', brandId: 'b-harbor', name: 'Harbor Lane Waitlist', description: 'Asked to be notified about waterfront-area openings.', contactCount: 57 },
  { id: 's-trials', brandId: 'b-loop', name: 'Trial Users', description: 'Started a trial in the last 90 days.', contactCount: 389 },
];

export const CONTACTS: Contact[] = [
  { id: 'ct-1', name: 'Priya Natarajan', email: 'priya.n@example.com', phone: '(973) 555-0142', brandId: 'b-green', segmentIds: ['s-north', 's-news'], emailConsent: 'subscribed', smsConsent: 'pending', source: 'Quote form', addedAt: '2026-09-21', lastActivity: 'Opened “Fall cleanup is booking fast” · Oct 2' },
  { id: 'ct-2', name: 'Marcus Webb', email: 'marcus.webb@example.com', phone: '(973) 555-0173', brandId: 'b-green', segmentIds: ['s-past', 's-news'], emailConsent: 'subscribed', smsConsent: 'subscribed', source: 'Past client import', addedAt: '2025-04-11', lastActivity: 'Clicked Request a Quote · Oct 4' },
  { id: 'ct-3', name: 'Elena Sørensen', email: 'elena.s@example.com', phone: null, brandId: 'b-green', segmentIds: ['s-news'], emailConsent: 'unsubscribed', smsConsent: 'pending', source: 'Website signup', addedAt: '2026-03-08', lastActivity: 'Unsubscribed · Sep 24' },
  { id: 'ct-4', name: 'The Henderson Family', email: 'hendersons@example.com', phone: '(973) 555-0119', brandId: 'b-green', segmentIds: ['s-past'], emailConsent: 'subscribed', smsConsent: 'pending', source: 'Completed job', addedAt: '2026-05-19', lastActivity: 'Left testimonial · Oct 5' },
  { id: 'ct-5', name: 'Tomás Rivera', email: 'tomas.r@example.com', phone: '(603) 555-0187', brandId: 'b-harbor', segmentIds: ['s-wait'], emailConsent: 'subscribed', smsConsent: 'subscribed', source: 'Waitlist form', addedAt: '2026-08-30', lastActivity: 'Replied asking about pets · Oct 7' },
  { id: 'ct-6', name: 'Aisha Bello', email: 'aisha.b@example.com', phone: null, brandId: 'b-harbor', segmentIds: ['s-wait'], emailConsent: 'subscribed', smsConsent: 'pending', source: 'Open house RSVP', addedAt: '2026-10-04', lastActivity: 'Booked a tour · Oct 6' },
  { id: 'ct-7', name: 'Mira Vance', email: 'mira@example.com', phone: '(615) 555-0128', brandId: 'b-velvet', segmentIds: [], emailConsent: 'subscribed', smsConsent: 'subscribed', source: 'Booking system', addedAt: '2026-09-14', lastActivity: 'Session completed · Oct 1' },
  { id: 'ct-8', name: 'Grant Okafor', email: 'grant.o@example.com', phone: null, brandId: 'b-loop', segmentIds: ['s-trials'], emailConsent: 'subscribed', smsConsent: 'pending', source: 'Trial signup', addedAt: '2026-10-03', lastActivity: 'Registered for webinar · Oct 5' },
];

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export const CONVERSATIONS: Conversation[] = [
  { id: 'cv-1', channel: 'instagram', kind: 'comment', fromName: '@maplewood_mom', excerpt: 'How much would a half-acre lot with two big oaks run?', receivedAt: '2026-10-08T08:12', status: 'open', assigneeUserId: null, campaignId: 'c-fall', rating: null, brandId: 'b-green' },
  { id: 'cv-2', channel: 'facebook', kind: 'dm', fromName: 'Dave Kowalski', excerpt: 'Do you handle gutter cleaning on its own, or only with a full cleanup?', receivedAt: '2026-10-08T07:48', status: 'open', assigneeUserId: null, campaignId: 'c-fall', rating: null, brandId: 'b-green' },
  { id: 'cv-3', channel: 'google_business', kind: 'review', fromName: 'R. Whitfield', excerpt: 'Best sounding room in Nashville for the price. Booked three more sessions.', receivedAt: '2026-10-07T21:30', status: 'open', assigneeUserId: null, campaignId: null, rating: 5, brandId: 'b-velvet' },
  { id: 'cv-4', channel: 'linkedin', kind: 'comment', fromName: 'Hannah Pruitt', excerpt: 'Will there be a recording for people who can’t make it live?', receivedAt: '2026-10-07T16:05', status: 'open', assigneeUserId: 'u-sam', campaignId: 'c-webinar', rating: null, brandId: 'b-loop' },
  { id: 'cv-5', channel: 'facebook', kind: 'comment', fromName: 'Lauren Choi', excerpt: 'Is the Harbor Lane unit pet-friendly? We have a corgi.', receivedAt: '2026-10-07T14:22', status: 'open', assigneeUserId: 'u-sam', campaignId: 'c-openhouse', rating: null, brandId: 'b-harbor' },
  { id: 'cv-6', channel: 'email', kind: 'email_reply', fromName: 'Priya Natarajan', excerpt: 'Could the estimate visit happen Thursday instead of Wednesday?', receivedAt: '2026-10-07T10:15', status: 'replied', assigneeUserId: 'u-sam', campaignId: 'c-fall', rating: null, brandId: 'b-green' },
  { id: 'cv-7', channel: 'google_business', kind: 'review', fromName: 'M. DiStefano', excerpt: 'Great cleanup crew — one scheduling hiccup but they made it right.', receivedAt: '2026-10-06T18:40', status: 'open', assigneeUserId: null, campaignId: 'c-fall', rating: 4, brandId: 'b-green' },
  { id: 'cv-8', channel: 'instagram', kind: 'comment', fromName: '@essexcountyliving', excerpt: 'Love the before & after 😍 Do you travel to South Orange?', receivedAt: '2026-10-06T12:33', status: 'done', assigneeUserId: 'u-alex', campaignId: 'c-fall', rating: null, brandId: 'b-green' },
  { id: 'cv-9', channel: 'instagram', kind: 'mention', fromName: '@miravancemusic', excerpt: 'Session at @velvetroomstudio was unreal. New single soon 👀', receivedAt: '2026-10-05T20:11', status: 'done', assigneeUserId: null, campaignId: 'c-sessions', rating: null, brandId: 'b-velvet' },
  { id: 'cv-10', channel: 'email', kind: 'email_reply', fromName: 'Grant Okafor', excerpt: 'Does the trial include the template pack, or only for webinar attendees?', receivedAt: '2026-10-05T15:47', status: 'open', assigneeUserId: null, campaignId: 'c-webinar', rating: null, brandId: 'b-loop' },
];

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const PERFORMANCE: CampaignPerformance[] = [
  {
    campaignId: 'c-fall',
    outcomes: [
      { kind: 'quote_requests', count: 21 },
      { kind: 'calls', count: 9 },
      { kind: 'email_signups', count: 34 },
    ],
    byChannel: [
      { channel: 'instagram', impressions: 18400, clicks: 412, engagements: 1290, leads: 9, conversions: 3, revenue: 3690, spend: 0 },
      { channel: 'email', impressions: 2320, clicks: 186, engagements: 0, leads: 6, conversions: 4, revenue: 4280, spend: 0 },
      { channel: 'facebook', impressions: 12100, clicks: 238, engagements: 640, leads: 4, conversions: 1, revenue: 980, spend: 120 },
      { channel: 'google_business', impressions: 3900, clicks: 145, engagements: 88, leads: 2, conversions: 1, revenue: 890, spend: 0 },
    ],
    weeklyLeads: [
      { weekOf: '2026-09-14', leads: 3 },
      { weekOf: '2026-09-21', leads: 5 },
      { weekOf: '2026-09-28', leads: 8 },
      { weekOf: '2026-10-05', leads: 5 },
    ],
    headline:
      'The Fall Cleanup campaign has generated 21 quote requests so far. Instagram produced the most interest, while email had the highest conversion rate.',
  },
  {
    campaignId: 'c-webinar',
    outcomes: [
      { kind: 'email_signups', count: 58 },
      { kind: 'trial_signups', count: 17 },
    ],
    byChannel: [
      { channel: 'linkedin', impressions: 9800, clicks: 310, engagements: 205, leads: 28, conversions: 7, revenue: 0, spend: 0 },
      { channel: 'email', impressions: 1480, clicks: 172, engagements: 0, leads: 24, conversions: 9, revenue: 0, spend: 0 },
      { channel: 'facebook', impressions: 4100, clicks: 66, engagements: 120, leads: 6, conversions: 1, revenue: 0, spend: 0 },
      { channel: 'x', impressions: 5200, clicks: 84, engagements: 310, leads: 0, conversions: 0, revenue: 0, spend: 0 },
    ],
    weeklyLeads: [
      { weekOf: '2026-09-28', leads: 11 },
      { weekOf: '2026-10-05', leads: 19 },
      { weekOf: '2026-10-12', leads: 17 },
      { weekOf: '2026-10-19', leads: 11 },
    ],
    headline:
      '58 webinar registrations so far. LinkedIn drives the volume; email converts registrants into trials at the best rate.',
  },
  {
    campaignId: 'c-sessions',
    outcomes: [
      { kind: 'bookings', count: 12 },
      { kind: 'calls', count: 5 },
    ],
    byChannel: [
      { channel: 'instagram', impressions: 7600, clicks: 198, engagements: 540, leads: 7, conversions: 7, revenue: 665, spend: 0 },
      { channel: 'email', impressions: 640, clicks: 58, engagements: 0, leads: 3, conversions: 3, revenue: 285, spend: 0 },
      { channel: 'google_business', impressions: 1900, clicks: 61, engagements: 30, leads: 2, conversions: 2, revenue: 190, spend: 0 },
    ],
    weeklyLeads: [
      { weekOf: '2026-09-28', leads: 4 },
      { weekOf: '2026-10-05', leads: 8 },
    ],
    headline: '12 studio sessions booked — the Mira Vance spotlight on Instagram did the heavy lifting.',
  },
  {
    campaignId: 'c-openhouse',
    outcomes: [{ kind: 'rental_inquiries', count: 4 }],
    byChannel: [
      { channel: 'email', impressions: 57, clicks: 19, engagements: 0, leads: 4, conversions: 2, revenue: 0, spend: 0 },
    ],
    weeklyLeads: [{ weekOf: '2026-10-05', leads: 4 }],
    headline: '4 tour requests before launch — all from the waitlist email.',
  },
  {
    campaignId: 'c-summer',
    outcomes: [
      { kind: 'quote_requests', count: 34 },
      { kind: 'purchases', count: 19 },
    ],
    byChannel: [
      { channel: 'facebook', impressions: 28400, clicks: 590, engagements: 1420, leads: 14, conversions: 8, revenue: 6900, spend: 240 },
      { channel: 'email', impressions: 3600, clicks: 310, engagements: 0, leads: 12, conversions: 8, revenue: 6200, spend: 0 },
      { channel: 'instagram', impressions: 15900, clicks: 350, engagements: 980, leads: 8, conversions: 3, revenue: 2500, spend: 0 },
    ],
    weeklyLeads: [
      { weekOf: '2026-06-15', leads: 6 },
      { weekOf: '2026-06-29', leads: 9 },
      { weekOf: '2026-07-13', leads: 8 },
      { weekOf: '2026-07-27', leads: 7 },
      { weekOf: '2026-08-10', leads: 4 },
    ],
    headline: 'Closed August 31 with 34 quote requests and $15.6k in attributed revenue.',
  },
];

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const AUDIT: AuditEvent[] = [
  { id: 'ae-1', at: '2026-10-08T07:40', actorUserId: null, action: 'metrics.sync', target: 'Instagram · Facebook', detail: 'Pulled post metrics for 12 published items.' },
  { id: 'ae-2', at: '2026-10-07T11:05', actorUserId: 'u-alex', action: 'approval.requested', target: 'Henderson testimonial (Instagram)', detail: 'Sent to Dana Reyes for approval.' },
  { id: 'ae-3', at: '2026-10-07T09:24', actorUserId: null, action: 'publish.failed', target: 'Commercial fall prep (LinkedIn)', detail: 'auth_expired after 3 attempts — automatic retries stopped, reconnection required.' },
  { id: 'ae-4', at: '2026-10-06T15:20', actorUserId: 'u-sam', action: 'approval.requested', target: 'Last-call email', detail: 'Sent to Dana Reyes for approval.' },
  { id: 'ae-5', at: '2026-10-06T10:12', actorUserId: 'u-jordan', action: 'approval.approved', target: 'Harbor Lane listing (Facebook)', detail: 'Approved with note: “Listing copy approved by Harborview.”' },
  { id: 'ae-6', at: '2026-10-06T02:10', actorUserId: null, action: 'connection.expired', target: 'LinkedIn — 2 company pages', detail: 'Refresh token expired; owner notified by email.' },
  { id: 'ae-7', at: '2026-10-02T18:00', actorUserId: null, action: 'publish.succeeded', target: 'Artist spotlight (Instagram + Facebook)', detail: 'Published on schedule; idempotency key ss-spotlight-1002.' },
  { id: 'ae-8', at: '2026-10-01T09:00', actorUserId: null, action: 'publish.succeeded', target: 'Webinar announcement (LinkedIn)', detail: 'Published on schedule.' },
];

// ---------------------------------------------------------------------------
// Campaign templates (industry onboarding)
// ---------------------------------------------------------------------------

export const TEMPLATES: CampaignTemplate[] = [
  { id: 't-land-seasonal', industry: 'landscaping', name: 'Seasonal promotion', goal: 'quote_requests', recommendedChannels: ['facebook', 'instagram', 'google_business', 'email', 'website'], cadence: '2 posts/week for 6 weeks + 2 emails', mediaChecklist: ['Before/after photo', 'Crew action shot', 'Vertical time-lapse video', 'Offer graphic'], suggestedCta: 'Request a Quote', emailSequence: ['Announcement', 'Social proof mid-run', 'Last call'], measuredBy: 'Quote requests from tagged links and calls' },
  { id: 't-land-showcase', industry: 'landscaping', name: 'Project showcase', goal: 'quote_requests', recommendedChannels: ['instagram', 'facebook', 'website'], cadence: '1 project/week', mediaChecklist: ['Before/after pair', '3–5 detail shots'], suggestedCta: 'Request a Quote', emailSequence: [], measuredBy: 'Quote requests + saves/shares' },
  { id: 't-land-reminder', industry: 'landscaping', name: 'Maintenance reminder', goal: 'calls', recommendedChannels: ['email', 'google_business', 'sms'], cadence: 'Monthly', mediaChecklist: ['Seasonal checklist graphic'], suggestedCta: 'Call to Schedule', emailSequence: ['Reminder'], measuredBy: 'Calls and repeat bookings' },
  { id: 't-rent-listing', industry: 'house_rentals', name: 'New listing', goal: 'rental_inquiries', recommendedChannels: ['facebook', 'instagram', 'email', 'website', 'google_business'], cadence: 'Launch burst: 3 posts in week 1', mediaChecklist: ['Exterior photo', 'Kitchen photo', '9:16 walkthrough video ≤ 90s'], suggestedCta: 'Book a Tour', emailSequence: ['Waitlist first-look', 'Open house invite'], measuredBy: 'Tour bookings and applications' },
  { id: 't-rent-openhouse', industry: 'house_rentals', name: 'Open house', goal: 'rental_inquiries', recommendedChannels: ['facebook', 'instagram', 'email', 'google_business'], cadence: '1 week runway + day-of posts', mediaChecklist: ['Exterior + interior photos', 'Walkthrough video'], suggestedCta: 'Book a Tour', emailSequence: ['Invite', 'Day-before reminder'], measuredBy: 'RSVPs and tours completed' },
  { id: 't-music-release', industry: 'music_studio', name: 'New release', goal: 'awareness', recommendedChannels: ['instagram', 'tiktok', 'youtube', 'email'], cadence: 'Teaser, release day, week-after', mediaChecklist: ['Cover art 1:1', 'Vertical teaser clip', 'Session photos'], suggestedCta: 'Listen Now', emailSequence: ['Release announcement'], measuredBy: 'Streams and link clicks' },
  { id: 't-music-openings', industry: 'music_studio', name: 'Session openings', goal: 'bookings', recommendedChannels: ['instagram', 'facebook', 'email', 'google_business'], cadence: 'Weekly while slots remain', mediaChecklist: ['Studio room photo', 'Artist-at-work photo'], suggestedCta: 'Book Studio Time', emailSequence: ['Open-slots note'], measuredBy: 'Sessions booked' },
  { id: 't-soft-launch', industry: 'software', name: 'Product launch', goal: 'trial_signups', recommendedChannels: ['linkedin', 'email', 'website', 'facebook'], cadence: '2-week runway + launch week daily', mediaChecklist: ['Product screenshot set', 'Launch graphic 16:9', 'Demo clip'], suggestedCta: 'Start Free Trial', emailSequence: ['Teaser', 'Launch', 'Feature deep-dive', 'Social proof'], measuredBy: 'Trials started, attributed revenue' },
  { id: 't-soft-webinar', industry: 'software', name: 'Webinar', goal: 'trial_signups', recommendedChannels: ['linkedin', 'email', 'facebook'], cadence: '3-week runway: announce, remind, day-of', mediaChecklist: ['Cover graphic 16:9', 'Speaker headshot'], suggestedCta: 'Save Your Seat', emailSequence: ['Announcement', 'One-week reminder', 'Day-before', 'Replay + trial offer'], measuredBy: 'Registrations → trials started' },
];
