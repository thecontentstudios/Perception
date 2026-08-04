/**
 * Perception — core domain model.
 *
 * The campaign is the central object of the product. A Campaign owns
 * ContentItems (the shared message), and each ContentItem owns
 * ChannelVariations (the platform-specific adaptations). Keeping these three
 * separate lets a user edit the common message while retaining specialized
 * Instagram, LinkedIn, and email versions.
 *
 * This file is the single source of truth for the prototype UI. The
 * production persistence model lives in prisma/schema.prisma and mirrors
 * these shapes.
 */

// ---------------------------------------------------------------------------
// Channels & formats
// ---------------------------------------------------------------------------

export type Channel =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'google_business'
  | 'x'
  | 'threads'
  | 'bluesky'
  | 'pinterest'
  | 'reddit'
  | 'nextdoor'
  | 'snapchat'
  | 'whatsapp'
  | 'email'
  | 'sms'
  | 'website';

export type ContentFormat =
  | 'post' // feed post (FB, IG, LinkedIn)
  | 'reel' // short vertical video (IG Reel, TikTok)
  | 'story'
  | 'video' // long-form (YouTube)
  | 'update' // Google Business Profile local post
  | 'pin' // Pinterest
  | 'message' // WhatsApp broadcast / template message
  | 'email'
  | 'sms'
  | 'banner' // website banner
  | 'blog'
  | 'landing_page';

export type AspectRatio = '1:1' | '4:5' | '4:3' | '2:3' | '16:9' | '9:16' | '1.91:1' | '3:2';

// ---------------------------------------------------------------------------
// Workspace: organization, brands, users
// ---------------------------------------------------------------------------

export type Role =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'creator'
  | 'approver'
  | 'analyst'
  | 'guest';

export interface User {
  id: string;
  name: string;
  initials: string;
  role: Role;
  email: string;
  twoFactorEnabled: boolean;
}

export interface Brand {
  id: string;
  name: string;
  industry: 'landscaping' | 'house_rentals' | 'music_studio' | 'software';
  /** index into the campaign color palette used for brand accents */
  colorIndex: number;
  location: string;
  website: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: string;
  brandIds: string[];
}

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | 'connected'
  | 'needs_reconnect'
  | 'expiring'
  | 'not_connected';

export interface ConnectedAccount {
  id: string;
  channel: Channel;
  /** e.g. "GreenScape Landscaping — Facebook Page" */
  displayName: string;
  destinationKind: string; // Page, Business account, Company page, Channel, Sender domain…
  status: ConnectionStatus;
  brandId: string | null;
  connectedByUserId: string | null;
  scopes: string[];
  expiresAt: string | null; // ISO date
  lastSyncAt: string | null;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video' | 'logo' | 'document';
  name: string;
  /** Placeholder rendering: two CSS colors + an emoji glyph instead of a real file. */
  gradient: [string, string];
  glyph: string;
  altText: string | null;
  durationSec: number | null; // videos only
  aspectRatio: AspectRatio;
  tags: string[];
  brandId: string;
  uploadedAt: string;
  sizeKB: number;
}

// ---------------------------------------------------------------------------
// Campaigns, content items, channel variations
// ---------------------------------------------------------------------------

export type CampaignGoal =
  | 'quote_requests'
  | 'bookings'
  | 'rental_inquiries'
  | 'trial_signups'
  | 'purchases'
  | 'email_signups'
  | 'calls'
  | 'awareness';

export const GOAL_LABELS: Record<CampaignGoal, string> = {
  quote_requests: 'Quote requests',
  bookings: 'Bookings',
  rental_inquiries: 'Rental inquiries',
  trial_signups: 'Trial registrations',
  purchases: 'Purchases',
  email_signups: 'Email signups',
  calls: 'Calls',
  awareness: 'Awareness',
};

export type CampaignStatus =
  | 'draft'
  | 'in_review'
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'archived';

export interface CallToAction {
  label: string;
  url: string;
}

export interface Campaign {
  id: string;
  brandId: string;
  name: string;
  status: CampaignStatus;
  goal: CampaignGoal;
  audience: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  offer: string | null;
  cta: CallToAction;
  /** index into the shared campaign color palette (calendar coding) */
  colorIndex: number;
  /** utm_campaign value applied to every tracked link in the campaign */
  utmCode: string;
  createdByUserId: string;
  templateId: string | null;
  description: string;
}

export type VariationStatus =
  | 'idea'
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'failed';

export interface PublicationFailure {
  code: string;
  message: string;
  attempts: number;
  lastTriedAt: string;
  /** true when the scheduler will retry automatically */
  willRetry: boolean;
}

/**
 * One platform-specific rendition of a content item. This is what appears on
 * the calendar and what the publishing workers consume.
 */
export interface ChannelVariation {
  id: string;
  contentItemId: string;
  campaignId: string;
  channel: Channel;
  format: ContentFormat;
  status: VariationStatus;
  /** ISO datetime (minutes precision) or null while unscheduled */
  scheduledAt: string | null;
  publishedAt: string | null;
  /** caption / body / email HTML-ish text */
  body: string;
  subject: string | null; // email
  preheader: string | null; // email
  /** email only: the footer block with postal address + unsubscribe link */
  hasUnsubscribeFooter: boolean;
  mediaIds: string[];
  cta: CallToAction | null;
  hashtags: string[];
  assigneeUserId: string | null;
  /** diverged from the shared campaign message (manual override) */
  overridden: boolean;
  failure: PublicationFailure | null;
}

export interface ContentItem {
  id: string;
  campaignId: string;
  title: string;
  kind: 'social' | 'email' | 'website' | 'sms';
  /** the shared message the owner writes once */
  coreMessage: string;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export interface Approval {
  id: string;
  variationId: string;
  requestedByUserId: string;
  requestedAt: string;
  approverUserId: string;
  decidedAt: string | null;
  decision: 'pending' | 'approved' | 'changes_requested';
  note: string | null;
}

// ---------------------------------------------------------------------------
// Contacts & audience
// ---------------------------------------------------------------------------

export type ConsentState = 'subscribed' | 'unsubscribed' | 'pending';

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  brandId: string;
  segmentIds: string[];
  emailConsent: ConsentState;
  smsConsent: ConsentState;
  source: string;
  addedAt: string;
  lastActivity: string;
}

export interface AudienceSegment {
  id: string;
  brandId: string;
  name: string;
  description: string;
  contactCount: number;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export type ConversationKind =
  | 'comment'
  | 'dm'
  | 'mention'
  | 'review'
  | 'email_reply';

export interface Conversation {
  id: string;
  channel: Channel;
  kind: ConversationKind;
  fromName: string;
  excerpt: string;
  receivedAt: string;
  status: 'open' | 'replied' | 'done';
  assigneeUserId: string | null;
  campaignId: string | null;
  rating: number | null; // reviews
  brandId: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface ChannelMetrics {
  channel: Channel;
  impressions: number;
  clicks: number;
  engagements: number;
  /** goal events attributed to this channel via tracked links */
  leads: number;
  /** completed outcome (booked, purchased, signed up…) */
  conversions: number;
  revenue: number;
  spend: number;
}

export interface OutcomeCount {
  kind: CampaignGoal;
  count: number;
}

export interface CampaignPerformance {
  campaignId: string;
  outcomes: OutcomeCount[];
  byChannel: ChannelMetrics[];
  /** weekly lead counts, oldest first, for trend charts */
  weeklyLeads: { weekOf: string; leads: number }[];
  /** the plain-language summary sentence shown to the owner */
  headline: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  at: string;
  actorUserId: string | null; // null = system
  action: string;
  target: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Preflight warnings (intelligent safeguards)
// ---------------------------------------------------------------------------

export type WarningSeverity = 'block' | 'warn' | 'info';

export interface PreflightWarning {
  id: string;
  severity: WarningSeverity;
  /** human-readable, e.g. "Instagram requires a different image ratio." */
  message: string;
  fix: string | null;
}

// ---------------------------------------------------------------------------
// Campaign templates (small-business onboarding)
// ---------------------------------------------------------------------------

export interface CampaignTemplate {
  id: string;
  industry: Brand['industry'];
  name: string;
  goal: CampaignGoal;
  recommendedChannels: Channel[];
  cadence: string;
  mediaChecklist: string[];
  suggestedCta: string;
  emailSequence: string[];
  measuredBy: string;
}
