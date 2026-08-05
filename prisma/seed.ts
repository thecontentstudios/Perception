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
    TRUNCATE TABLE "AuditEvent","Conversion","LinkClick","TrackedLink","Metric","Conversation","EmailDelivery",
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

  await seedHistory();

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
    trackedLinks: await db.trackedLink.count(),
    clicks: await db.linkClick.count(),
    conversions: await db.conversion.count(),
  };
  console.log('Seeded:', counts);
}

/**
 * Eight weeks of back catalogue, so there is something to learn from.
 *
 * Twelve weeks of it: enough that each brand — not just the one with two
 * campaigns — has a bucket that clears the sample floor. Deliberately boring content — these exist to
 * carry results, and the calendar shows them in past months where they belong.
 */
async function seedBackCatalogue(): Promise<
  { id: string; contentItemId: string; channel: string; format: string; publishedAt: string }[]
> {
  const FORMATS: [string, string][] = [
    ['post', 'instagram'], ['reel', 'instagram'], ['post', 'facebook'],
    ['update', 'google_business'], ['email', 'email'], ['reel', 'tiktok'],
  ];
  const HOURS = [8, 10, 12, 15, 17, 19];
  const out: { id: string; contentItemId: string; channel: string; format: string; publishedAt: string }[] = [];

  // Anchor to the demo clock so the history always sits just behind "today".
  const today = new Date('2026-10-08T00:00:00Z');

  let n = 0;
  for (const [ci, campaign] of CAMPAIGNS.entries()) {
    const item = CONTENT_ITEMS.find((i) => i.campaignId === campaign.id);
    if (!item) continue;

    for (let week = 1; week <= 12; week++) {
      const [format, channel] = FORMATS[n % FORMATS.length];
      // Stride 5 is coprime with 6, so this walks all six hours. Stride 3
      // would only ever hit two of them — which produced a history where
      // every brand's "best time" was identical, and no afternoon at all.
      // Offsetting by campaign keeps the brands from converging on one answer.
      const hour = HOURS[(n * 5 + ci * 2) % HOURS.length];
      const at = new Date(today);
      at.setUTCDate(at.getUTCDate() - week * 7 - (n % 5));
      at.setUTCHours(hour, 0, 0, 0);

      const id = `v-hist-${n}`;
      await db.channelVariation.create({
        data: {
          id, contentItemId: item.id, channel: chan(channel), format,
          status: 'PUBLISHED', publishedAt: at, scheduledAt: at,
          body: `${item.coreMessage}`,
          hashtags: [], hasUnsubscribeFooter: format === 'email',
          ctaLabel: campaign.cta.label, ctaUrl: campaign.cta.url,
        },
      });
      await db.publishedPost.create({
        data: { variationId: id, externalId: `hist-${id}`, publishedAt: at },
      });
      out.push({ id, contentItemId: item.id, channel, format, publishedAt: at.toISOString().slice(0, 16) });
      n++;
    }
  }
  return out;
}

/**
 * Click and conversion history for the posts that already went out.
 *
 * Phase 3 learns from results, and a learning loop with nothing to learn from
 * can only be tested by asserting it returns nothing. So the demo workspace
 * gets a history — and a deliberately *patterned* one:
 *
 *   - reels convert about three times better than plain posts
 *   - late afternoon beats first thing in the morning
 *
 * Those two facts are planted here and nowhere else. The learning query has to
 * rediscover them from the rows, which is a much stronger test than checking
 * it produces a well-formed answer.
 *
 * Deterministic on purpose: a hash of the variation id stands in for
 * randomness, so a reseed produces the same history and a failing test means
 * the code changed rather than the dice.
 */
async function seedHistory() {
  // The fixtures' sixteen published posts are a *snapshot* — one campaign
  // mid-flight. A learning loop needs a *history*, and sixteen posts spread
  // over two weeks cannot fill even one bucket past the sample floor, which is
  // the loop correctly declining to answer rather than a bug.
  //
  // So the demo workspace gets the couple of months of back catalogue a real
  // account would have: posts across every format and time of day, going back
  // eight weeks, one per brand's campaigns.
  const historical = await seedBackCatalogue();
  const published = [...VARIATIONS.filter((v) => v.publishedAt), ...historical];

  // Cheap stable hash → the same post always gets the same numbers.
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return Math.abs(h);
  };

  for (const v of published) {
    const item = CONTENT_ITEMS.find((i) => i.id === v.contentItemId);
    if (!item) continue;
    const publishedAt = date(v.publishedAt!);
    const hour = publishedAt.getUTCHours();

    const link = await db.trackedLink.create({
      data: {
        code: `seed${hash(v.id) % 100000}`,
        variationId: v.id,
        campaignId: item.campaignId,
        targetUrl: CAMPAIGNS.find((c) => c.id === item.campaignId)?.cta.url ?? 'https://example.com',
      },
    });

    const clicks = 18 + (hash(v.id) % 40);
    // The planted pattern. Everything else about the post is irrelevant to it,
    // so a query that finds it has genuinely found it.
    const formatLift = v.format === 'reel' ? 3 : v.format === 'update' ? 1.5 : 1;

    // Each business peaks at a different time, because real ones do — a
    // landscaper's customers browse after work, a recording studio's are up
    // late, a B2B tool's are at their desks. Without this the learning loop
    // gives every brand the same answer, which is true to the data but makes
    // the demo look like a global default wearing a per-brand label.
    const brandId = CAMPAIGNS.find((c) => c.id === item.campaignId)?.brandId ?? '';
    const peak: Record<string, number> = {
      'b-green': 17, 'b-harbor': 12, 'b-velvet': 19, 'b-northwind': 10,
    };
    const distance = Math.abs(hour - (peak[brandId] ?? 15));
    const hourLift = distance <= 1 ? 2.4 : distance <= 3 ? 1.3 : 0.6;
    const conversions = Math.round(clicks * 0.06 * formatLift * hourLift);

    for (let i = 0; i < clicks; i++) {
      const at = new Date(publishedAt.getTime() + (i * 37 + (hash(v.id + i) % 900)) * 60_000);
      const click = await db.linkClick.create({
        data: {
          linkId: link.id,
          visitorId: `seed-visitor-${hash(v.id + ':' + i) % 5000}`,
          clickedAt: at,
          repeat: false,
          referrer: null,
        },
      });

      if (i < conversions) {
        const kind = i % 5 === 0 ? 'booking' : i % 7 === 0 ? 'call' : 'quote_request';
        await db.conversion.create({
          data: {
            organizationId: ORG.id,
            campaignId: item.campaignId,
            variationId: v.id,
            clickId: click.id,
            kind,
            channel: chan(v.channel),
            valueCents: kind === 'booking' ? 48000 : kind === 'call' ? 0 : 32000,
            occurredAt: new Date(at.getTime() + 20 * 60_000),
            externalId: `seed:${v.id}:${i}`,
            attribution: { basis: 'click', seeded: true },
          },
        });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
