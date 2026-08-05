/**
 * Seed the demo workspace into Postgres.
 *
 * The fixtures in src/lib/demo-data.ts stop being the product's source of
 * truth here and become what they should always have been: seed data. The
 * same four businesses, five campaigns, and mid-flight Fall Cleanup story,
 * now in rows that survive a reload.
 *
 *   npm run db:seed
 */
import { PrismaClient, type Channel as PChannel } from '@prisma/client';
import {
  ACCOUNTS, APPROVALS, AUDIT, BRANDS, CAMPAIGNS, CONTACTS, CONTENT_ITEMS,
  CONVERSATIONS, DESTINATIONS, MEDIA, ORG, SEGMENTS, USERS, VARIATIONS,
} from '../src/lib/demo-data';

const db = new PrismaClient();

/** Domain uses lower_snake; the database enum is SCREAMING_SNAKE. */
const chan = (c: string): PChannel => c.toUpperCase() as PChannel;
const upper = <T,>(s: string): T => s.toUpperCase() as T;

/** 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm' both parse; keep them UTC-stable. */
const date = (s: string): Date => new Date(s.length > 10 ? `${s}:00Z` : `${s}T00:00:00Z`);

async function main() {
  // Order matters: children reference parents. Truncate for a repeatable seed.
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditEvent","Conversion","Metric","Conversation","EmailDelivery",
      "EmailTemplate","SegmentMember","AudienceSegment","Contact","PublishedPost",
      "PublicationAttempt","Approval","VariationMedia","MediaAsset","ChannelVariation",
      "ContentItem","Campaign","ConnectedAccount","Membership","User","Location",
      "Brand","Organization" RESTART IDENTITY CASCADE;
  `);

  await db.organization.create({
    data: { id: ORG.id, name: ORG.name, plan: ORG.plan },
  });

  await db.user.createMany({
    data: USERS.map((u) => ({
      id: u.id, email: u.email, name: u.name, twoFactorEnabled: u.twoFactorEnabled,
    })),
  });

  await db.membership.createMany({
    data: USERS.map((u) => ({
      organizationId: ORG.id, userId: u.id, role: upper(u.role) as never,
    })),
  });

  await db.brand.createMany({
    data: BRANDS.map((b) => ({
      id: b.id, organizationId: ORG.id, name: b.name, industry: b.industry,
      website: b.website, colorIndex: b.colorIndex,
    })),
  });

  await db.location.createMany({
    data: BRANDS.map((b) => ({
      id: `loc-${b.id}`, brandId: b.id, name: b.name, address: b.location,
    })),
  });

  await db.connectedAccount.createMany({
    data: ACCOUNTS.map((a) => ({
      id: a.id, organizationId: ORG.id, channel: chan(a.channel),
      status: upper(a.status) as never,
      displayName: a.displayName, destinationKind: a.destinationKind,
      scopes: a.scopes,
      expiresAt: a.expiresAt ? date(a.expiresAt) : null,
      lastSyncAt: a.lastSyncAt ? date(a.lastSyncAt) : null,
      connectedById: a.connectedByUserId,
    })),
  });

  await db.campaign.createMany({
    data: CAMPAIGNS.map((c) => ({
      id: c.id, organizationId: ORG.id, brandId: c.brandId, name: c.name,
      status: upper(c.status) as never,
      goal: c.goal, audience: c.audience,
      startDate: date(c.startDate), endDate: date(c.endDate),
      offer: c.offer, ctaLabel: c.cta.label, ctaUrl: c.cta.url,
      colorIndex: c.colorIndex, utmCode: c.utmCode, description: c.description,
      templateId: c.templateId, createdById: c.createdByUserId,
    })),
  });

  await db.contentItem.createMany({
    data: CONTENT_ITEMS.map((i) => ({
      id: i.id, campaignId: i.campaignId, title: i.title, kind: i.kind,
      coreMessage: i.coreMessage,
    })),
  });

  await db.mediaAsset.createMany({
    data: MEDIA.map((m) => ({
      id: m.id, organizationId: ORG.id, brandId: m.brandId, kind: m.kind,
      // The prototype renders a gradient + glyph rather than a file; keep that
      // in storageKey so the seeded library looks identical until real uploads
      // land in Phase 4.
      storageKey: `demo://${m.gradient[0]}|${m.gradient[1]}|${m.glyph}|${m.aspectRatio}`,
      fileName: m.name, mimeType: m.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      sizeBytes: m.sizeKB * 1000, durationSec: m.durationSec,
      altText: m.altText, tags: m.tags, createdAt: date(m.uploadedAt),
    })),
  });

  await db.publishDestination.createMany({
    data: DESTINATIONS.map((d) => ({
      id: d.id, accountId: d.accountId, channel: chan(d.channel), name: d.name,
      kind: d.kind, externalId: d.externalId, brandId: d.brandId,
      enabled: d.enabled, followers: d.followers, issues: d.issues, hue: d.hue,
    })),
  });

  await db.channelVariation.createMany({
    data: VARIATIONS.map((v) => ({
      id: v.id, contentItemId: v.contentItemId, channel: chan(v.channel),
      accountId: ACCOUNTS.find((a) => a.channel === v.channel)?.id ?? null,
      destinationId: v.destinationId ?? null,
      format: v.format, status: upper(v.status) as never,
      scheduledAt: v.scheduledAt ? date(v.scheduledAt) : null,
      publishedAt: v.publishedAt ? date(v.publishedAt) : null,
      body: v.body, subject: v.subject, preheader: v.preheader,
      hasUnsubscribeFooter: v.hasUnsubscribeFooter,
      ctaLabel: v.cta?.label ?? null, ctaUrl: v.cta?.url ?? null,
      hashtags: v.hashtags, assigneeId: v.assigneeUserId, overridden: v.overridden,
    })),
  });

  await db.variationMedia.createMany({
    data: VARIATIONS.flatMap((v) =>
      v.mediaIds.map((assetId, position) => ({ variationId: v.id, assetId, position }))
    ),
  });

  // The one failed publish in the demo, as a real attempt row.
  await db.publicationAttempt.createMany({
    data: VARIATIONS.filter((v) => v.failure).map((v) => ({
      variationId: v.id,
      idempotencyKey: `seed:${v.id}`,
      attemptNumber: v.failure!.attempts,
      success: false,
      errorCode: v.failure!.code,
      errorMessage: v.failure!.message,
      willRetry: v.failure!.willRetry,
      finishedAt: date(v.failure!.lastTriedAt),
    })),
  });

  await db.publishedPost.createMany({
    data: VARIATIONS.filter((v) => v.publishedAt).map((v) => ({
      variationId: v.id,
      externalId: `seed-${v.id}`,
      publishedAt: date(v.publishedAt!),
    })),
  });

  await db.approval.createMany({
    data: APPROVALS.map((a) => ({
      id: a.id, variationId: a.variationId, requestedById: a.requestedByUserId,
      approverId: a.approverUserId, decision: upper(a.decision) as never,
      note: a.note, requestedAt: date(a.requestedAt),
      decidedAt: a.decidedAt ? date(a.decidedAt) : null,
    })),
  });

  await db.contact.createMany({
    data: CONTACTS.map((c) => ({
      id: c.id, organizationId: ORG.id, brandId: c.brandId, name: c.name,
      email: c.email, phone: c.phone,
      emailConsent: upper(c.emailConsent) as never,
      smsConsent: upper(c.smsConsent) as never,
      source: c.source, createdAt: date(c.addedAt),
    })),
  });

  await db.audienceSegment.createMany({
    data: SEGMENTS.map((s) => ({
      id: s.id, organizationId: ORG.id, brandId: s.brandId, name: s.name,
      description: s.description,
    })),
  });

  await db.segmentMember.createMany({
    data: CONTACTS.flatMap((c) => c.segmentIds.map((segmentId) => ({ segmentId, contactId: c.id }))),
  });

  await db.conversation.createMany({
    data: CONVERSATIONS.map((c) => ({
      id: c.id, organizationId: ORG.id, brandId: c.brandId, channel: chan(c.channel),
      kind: c.kind, fromName: c.fromName, excerpt: c.excerpt, rating: c.rating,
      status: c.status, assigneeId: c.assigneeUserId, campaignId: c.campaignId,
      receivedAt: date(c.receivedAt),
    })),
  });

  await db.auditEvent.createMany({
    data: AUDIT.map((e) => ({
      id: e.id, organizationId: ORG.id, actorUserId: e.actorUserId,
      action: e.action, target: e.target, detail: e.detail, at: date(e.at),
    })),
  });

  const counts = {
    brands: await db.brand.count(),
    campaigns: await db.campaign.count(),
    items: await db.contentItem.count(),
    variations: await db.channelVariation.count(),
    media: await db.mediaAsset.count(),
    contacts: await db.contact.count(),
    conversations: await db.conversation.count(),
    approvals: await db.approval.count(),
    published: await db.publishedPost.count(),
    failedAttempts: await db.publicationAttempt.count(),
    destinations: await db.publishDestination.count(),
  };
  console.log('Seeded:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
