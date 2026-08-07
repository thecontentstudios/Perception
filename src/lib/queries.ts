import { db } from './db';
import type {
  Approval, AuditEvent, Campaign, ChannelVariation, ConnectedAccount, Contact,
  ContentItem, Conversation, MediaAsset, PublishDestination,
} from './types';

/**
 * The read path: database rows → the domain shapes the UI already speaks.
 *
 * Deliberately a translation layer rather than a rewrite. Every screen was
 * built against `src/lib/types.ts`, and those types are good; the job here is
 * to satisfy them from Postgres instead of from fixtures. Nothing downstream
 * needs to know where the data came from.
 *
 * The one real friction is dates: Prisma hands back `Date`, the domain uses
 * timezone-stable `'YYYY-MM-DD'` and `'YYYY-MM-DDTHH:mm'` strings so the
 * calendar renders identically on every machine. Converting at this boundary
 * keeps that guarantee in one place.
 */

const lower = <T extends string>(s: string): T => s.toLowerCase() as T;

/** Date → 'YYYY-MM-DD', read in UTC to match how the seed wrote it. */
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
/** Date → 'YYYY-MM-DDTHH:mm' */
const minuteOf = (d: Date): string => d.toISOString().slice(0, 16);

export interface Workspace {
  campaigns: Campaign[];
  items: ContentItem[];
  variations: ChannelVariation[];
  media: MediaAsset[];
  accounts: ConnectedAccount[];
  destinations: PublishDestination[];
  contacts: Contact[];
  conversations: Conversation[];
  approvals: Approval[];
  audit: AuditEvent[];
}

/**
 * Load an organization's whole workspace.
 *
 * One round trip per collection rather than a deep nested include: the
 * collections are small (tens to low hundreds of rows), the UI wants them flat
 * anyway, and a single `include` tree deep enough to cover this produces a
 * cartesian result set that is slower and harder to read.
 */
export async function loadWorkspace(organizationId: string): Promise<Workspace> {
  const [
    campaigns, items, variations, media, accounts, destinations,
    contacts, conversations, approvals, audit,
  ] = await Promise.all([
    db.campaign.findMany({ where: { organizationId }, orderBy: { startDate: 'desc' } }),
    db.contentItem.findMany({ where: { campaign: { organizationId } } }),
    db.channelVariation.findMany({
      where: { contentItem: { campaign: { organizationId } } },
      include: { media: { orderBy: { position: 'asc' } }, attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
    }),
    db.mediaAsset.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    db.connectedAccount.findMany({ where: { organizationId } }),
    db.publishDestination.findMany({ where: { account: { organizationId } } }),
    db.contact.findMany({ where: { organizationId }, include: { segments: true } }),
    db.conversation.findMany({ where: { organizationId }, orderBy: { receivedAt: 'desc' } }),
    db.approval.findMany({ where: { variation: { contentItem: { campaign: { organizationId } } } } }),
    db.auditEvent.findMany({ where: { organizationId }, orderBy: { at: 'desc' }, take: 40 }),
  ]);

  return {
    campaigns: campaigns.map((c) => ({
      id: c.id, brandId: c.brandId, name: c.name, status: lower(c.status),
      goal: c.goal as Campaign['goal'], audience: c.audience ?? '',
      startDate: dayOf(c.startDate), endDate: dayOf(c.endDate),
      offer: c.offer, cta: { label: c.ctaLabel, url: c.ctaUrl },
      colorIndex: c.colorIndex, utmCode: c.utmCode,
      createdByUserId: c.createdById, templateId: c.templateId,
      description: c.description ?? '',
    })),

    items: items.map((i) => ({
      id: i.id, campaignId: i.campaignId, title: i.title,
      kind: i.kind as ContentItem['kind'], coreMessage: i.coreMessage,
    })),

    variations: variations.map((v) => {
      // Only the most recent attempt matters to the UI, and only when it lost.
      const last = v.attempts[0];
      return {
        id: v.id, contentItemId: v.contentItemId,
        // The UI groups by campaign; resolve it through the content item.
        campaignId: items.find((i) => i.id === v.contentItemId)?.campaignId ?? '',
        channel: lower(v.channel), destinationId: v.destinationId,
        format: v.format as ChannelVariation['format'],
        status: lower(v.status),
        scheduledAt: v.scheduledAt ? minuteOf(v.scheduledAt) : null,
        publishedAt: v.publishedAt ? minuteOf(v.publishedAt) : null,
        body: v.body, subject: v.subject, preheader: v.preheader,
        hasUnsubscribeFooter: v.hasUnsubscribeFooter,
        mediaIds: v.media.map((m) => m.assetId),
        cta: v.ctaLabel ? { label: v.ctaLabel, url: v.ctaUrl ?? '' } : null,
        hashtags: v.hashtags, assigneeUserId: v.assigneeId,
        overridden: v.overridden,
        failure:
          last && last.success === false
            ? {
                code: last.errorCode ?? 'unknown',
                message: last.errorMessage ?? 'Publish failed.',
                attempts: last.attemptNumber,
                lastTriedAt: minuteOf(last.finishedAt ?? last.startedAt),
                willRetry: last.willRetry,
              }
            : null,
      };
    }),

    media: media.map((m) => {
      // The seed encodes the prototype's gradient/glyph placeholder in
      // storageKey; real uploads in Phase 4 will carry a URL instead.
      const [, spec = ''] = m.storageKey.split('demo://');
      const [g1, g2, glyph, ratio] = spec.split('|');
      return {
        id: m.id, kind: m.kind as MediaAsset['kind'], name: m.fileName,
        gradient: [g1 || '#64748b', g2 || '#1e293b'] as [string, string],
        glyph: glyph || '🖼️',
        altText: m.altText, durationSec: m.durationSec,
        aspectRatio: (ratio || '1:1') as MediaAsset['aspectRatio'],
        tags: m.tags, brandId: m.brandId ?? '',
        uploadedAt: dayOf(m.createdAt), sizeKB: Math.round(m.sizeBytes / 1000),
      };
    }),

    accounts: accounts.map((a) => ({
      id: a.id, channel: lower(a.channel), displayName: a.displayName,
      destinationKind: a.destinationKind, status: lower(a.status),
      brandId: null, connectedByUserId: a.connectedById, scopes: a.scopes,
      expiresAt: a.expiresAt ? dayOf(a.expiresAt) : null,
      lastSyncAt: a.lastSyncAt ? minuteOf(a.lastSyncAt) : null,
    })),

    destinations: destinations.map((d) => ({
      id: d.id, accountId: d.accountId, channel: lower(d.channel), name: d.name,
      kind: d.kind, externalId: d.externalId, brandId: d.brandId,
      enabled: d.enabled, followers: d.followers, issues: d.issues, hue: d.hue,
    })),

    contacts: contacts.map((c) => ({
      id: c.id, name: c.name, email: c.email ?? '', phone: c.phone,
      brandId: c.brandId ?? '', segmentIds: c.segments.map((s) => s.segmentId),
      emailConsent: lower(c.emailConsent), smsConsent: lower(c.smsConsent),
      source: c.source ?? '', addedAt: dayOf(c.createdAt),
      lastActivity: '',
    })),

    conversations: conversations.map((c) => ({
      id: c.id, channel: lower(c.channel), kind: c.kind as Conversation['kind'],
      fromName: c.fromName, excerpt: c.excerpt, receivedAt: minuteOf(c.receivedAt),
      status: c.status as Conversation['status'], assigneeUserId: c.assigneeId,
      campaignId: c.campaignId, rating: c.rating, brandId: c.brandId ?? '',
    })),

    approvals: approvals.map((a) => ({
      id: a.id, variationId: a.variationId, requestedByUserId: a.requestedById,
      requestedAt: minuteOf(a.requestedAt), approverUserId: a.approverId,
      decidedAt: a.decidedAt ? minuteOf(a.decidedAt) : null,
      decision: lower(a.decision), note: a.note,
    })),

    audit: audit.map((e) => ({
      id: e.id, at: minuteOf(e.at), actorUserId: e.actorUserId,
      action: e.action, target: e.target, detail: e.detail ?? '',
    })),
  };
}
