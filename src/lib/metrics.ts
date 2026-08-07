import { db } from './db';
import { canPublish, publisherFor } from './publishers/registry';
import type { Channel } from './types';

/**
 * Getting real numbers into the reporting.
 *
 * Two readers, and the difference between them is the reason this file has a
 * shape rather than being one function.
 *
 * **Platform numbers must be snapshotted.** Bluesky will tell you a post has
 * 14 likes *now*. Ask again tomorrow and it says 19, and there is no way to
 * ask what it was on Tuesday — the history does not exist anywhere but in
 * whatever we wrote down. So each reading becomes a `Metric` row, and the
 * series is ours.
 *
 * **Our own numbers must not be.** How many emails were delivered, opened and
 * paid for is computable exactly from `EmailDelivery` and `SpendEntry` at any
 * moment, for any window. Snapshotting those would introduce staleness in
 * exchange for nothing: a cached count that disagrees with the rows is just a
 * bug waiting to be reported as a discrepancy.
 *
 * The rule: **store what you can only observe once, compute what you own.**
 */

export interface PlatformRefresh {
  attempted: number;
  written: number;
  missing: number;
  failed: { variationId: string; channel: Channel; error: string }[];
  /** Channels skipped because nothing is connected — not an error. */
  skipped: Channel[];
}

/**
 * Ask each platform what happened to the posts we put there.
 *
 * Only touches variations with a `PublishedPost`, because an external id is
 * the only thing that makes the question askable. Posts already recorded as
 * gone are left alone — a deleted post does not come back, and re-asking is
 * a request per post per run that can only ever 404.
 */
export async function refreshPlatformMetrics(
  organizationId: string,
  opts: { limit?: number; since?: Date } = {}
): Promise<PlatformRefresh> {
  const out: PlatformRefresh = { attempted: 0, written: 0, missing: 0, failed: [], skipped: [] };

  const posts = await db.publishedPost.findMany({
    where: {
      variation: {
        contentItem: { campaign: { organizationId } },
        ...(opts.since ? { publishedAt: { gte: opts.since } } : {}),
      },
    },
    select: { externalId: true, variationId: true, variation: { select: { channel: true } } },
    orderBy: { publishedAt: 'desc' },
    take: opts.limit ?? 200,
  });

  // Prior readings, in one query rather than N: which posts we have already
  // recorded as gone, and which we have ever read successfully. The second set
  // is what makes a 404 interpretable — see the `missing` branch below.
  const priorReadings = await db.metric.findMany({
    where: { variationId: { in: posts.map((p) => p.variationId) } },
    select: { variationId: true, postMissing: true },
  });
  const goneIds = new Set(priorReadings.filter((m) => m.postMissing).map((m) => m.variationId));
  const seenAlive = new Set(priorReadings.filter((m) => !m.postMissing).map((m) => m.variationId));

  const skipped = new Set<Channel>();

  for (const post of posts) {
    const channel = post.variation.channel.toLowerCase() as Channel;
    if (goneIds.has(post.variationId)) continue;

    const publisher = publisherFor(channel);
    if (!publisher?.fetchMetrics) {
      // Not a failure. Most channels have no reader, and reporting that as
      // an error every run would bury the real ones.
      skipped.add(channel);
      continue;
    }
    if (!canPublish(channel)) {
      // A reader with no grant is the not_connected case, not an error: the
      // owner disconnecting Facebook must not turn every old post into a
      // failure row on the next refresh.
      skipped.add(channel);
      continue;
    }

    out.attempted += 1;
    const r = await publisher.fetchMetrics(post.externalId);

    if (!r.ok || !r.metrics) {
      out.failed.push({ variationId: post.variationId, channel, error: r.error ?? 'No metrics returned.' });
      continue;
    }

    if (r.metrics.missing) {
      // A 404 is only conclusive for a post we have read successfully before.
      //
      // Otherwise it is far more likely to be our fault than the owner's: a
      // wrong id, the wrong host, an endpoint we are calling incorrectly, or
      // an instance running a version without it. All of those return 404, and
      // treating the first one as "deleted" writes a permanent tombstone that
      // stops us ever reading that post again — a self-inflicted silence that
      // looks exactly like a post nobody engaged with.
      //
      // Found by a test: the stand-in was an older build without the endpoint,
      // every post was marked gone on the first pass, and the failure surfaced
      // as zero readings rather than as an error.
      if (!seenAlive.has(post.variationId)) {
        out.failed.push({
          variationId: post.variationId,
          channel,
          error: 'The platform has no record of this post, and we have never read it successfully. Treating as an error rather than a deletion.',
        });
        continue;
      }

      out.missing += 1;
      await db.metric.create({
        data: {
          variationId: post.variationId,
          source: channel,
          impressions: null,
          engagements: null,
          clicks: null,
          postMissing: true,
        },
      });
      continue;
    }

    await db.metric.create({
      data: {
        variationId: post.variationId,
        source: channel,
        // Passed through as nulls when the platform did not say. Coercing to
        // 0 here would undo the entire point of the nullable columns.
        impressions: r.metrics.impressions,
        engagements: r.metrics.engagements,
        clicks: r.metrics.clicks,
      },
    });
    out.written += 1;
  }

  out.skipped = [...skipped];

  // The visible last-run. Refresh moving into the worker is only safe if a
  // stale number looks stale — this row is what "as of" on the screen reads.
  await db.auditEvent.create({
    data: {
      organizationId,
      actorUserId: null,
      action: 'metrics.refreshed',
      target: out.skipped.join(',') || 'all',
      detail: `read ${out.written} of ${out.attempted}${out.missing ? `, ${out.missing} gone` : ''}${out.failed.length ? `, ${out.failed.length} failed` : ''}`,
    },
  });
  return out;
}

// ---------------------------------------------------------------------------
// Numbers we own
// ---------------------------------------------------------------------------

export interface OwnedMetrics {
  /** Messages the provider confirmed it delivered. */
  delivered: number;
  /** Distinct recipients who opened. Email only — a text has no open event. */
  opened: number | null;
  /** Clicks the *provider* counted, which is not our tracked-link count. */
  providerClicks: number | null;
  spendCents: number;
}

/**
 * Email and SMS results, from the rows we already hold.
 *
 * This is the correction at the centre of the phase. Since Phase 2 the
 * reporting has said "not measured" about impressions, engagement and spend
 * for **every** channel — including these two, where we know precisely what
 * was sent, what came back and what it cost, because we sent it ourselves and
 * charged for it to the cent.
 *
 * A delivered message is the one honest impression in the product. A feed post
 * that "reached" 4,000 people means an unknown number of them scrolled past
 * without looking; a delivered email is in a mailbox. Counting them under one
 * heading is the unit mixing `routes.ts` refuses to do, so the caller gets
 * them separately and labels them.
 */
/**
 * Where a delivery belongs, given that it cannot be joined to one.
 *
 * `EmailDelivery.variationId` and `SmsDelivery.variationId` are plain columns
 * with no foreign key, so there is no relation to filter on. The org is
 * reachable through the contact; the campaign is not reachable at all without
 * first resolving which variations belong to it.
 */
async function deliveryScope(organizationId: string, campaignId?: string) {
  if (!campaignId) return { contact: { organizationId } };
  const variations = await db.channelVariation.findMany({
    where: { contentItem: { campaignId } },
    select: { id: true },
  });
  return { contact: { organizationId }, variationId: { in: variations.map((v) => v.id) } };
}

export async function ownedMetrics(
  organizationId: string,
  channel: 'email' | 'sms',
  campaignId?: string
): Promise<OwnedMetrics> {
  const scope = await deliveryScope(organizationId, campaignId);

  const spend = await db.spendEntry.aggregate({
    where: { organizationId, channel: channel.toUpperCase() as never, ...(campaignId ? { campaignId } : {}) },
    _sum: { cents: true },
  });

  if (channel === 'sms') {
    const [delivered] = await Promise.all([
      db.smsDelivery.count({ where: { ...scope, status: { in: ['DELIVERED', 'OPENED', 'CLICKED'] } } }),
    ]);
    return {
      delivered,
      // A text has no open event and no provider click count. Null, not zero:
      // nobody can tell us, so we do not claim nobody opened it.
      opened: null,
      providerClicks: null,
      spendCents: spend._sum.cents ?? 0,
    };
  }

  const [delivered, opened, clicked] = await Promise.all([
    db.emailDelivery.count({
      where: { ...scope, status: { in: ['DELIVERED', 'OPENED', 'CLICKED'] } },
    }),
    db.emailDelivery.count({ where: { ...scope, openedAt: { not: null } } }),
    db.emailDelivery.count({ where: { ...scope, clickedAt: { not: null } } }),
  ]);

  return { delivered, opened, providerClicks: clicked, spendCents: spend._sum.cents ?? 0 };
}

// ---------------------------------------------------------------------------
// Two click counts that disagree
// ---------------------------------------------------------------------------

export interface ClickReconciliation {
  /** What the email provider counted. */
  provider: number;
  /** What our own /r/<code> redirect counted. */
  tracked: number;
  /** provider − tracked. Positive is the normal direction. */
  gap: number;
  /** Whether the gap is large enough to be worth an owner's attention. */
  notable: boolean;
  explanation: string;
}

/**
 * Reconcile the provider's click count against our own, and **show both**.
 *
 * These two numbers will not match, and picking one to display would hide the
 * most useful thing in the comparison. Corporate mail scanners follow every
 * link in every message before delivering it, so a provider's click count on a
 * list with business addresses in it runs high — sometimes by a lot. Our
 * tracked-link count is closer to human behaviour but misses anyone who
 * clicked a link we did not mint.
 *
 * Averaging them produces a number that is nobody's measurement. Picking the
 * bigger one flatters the report. Showing both, with the gap named, lets an
 * owner see the shape of their own list.
 */
export async function reconcileClicks(
  organizationId: string,
  campaignId?: string
): Promise<ClickReconciliation> {
  const scope = await deliveryScope(organizationId, campaignId);

  const [provider, tracked] = await Promise.all([
    db.emailDelivery.count({ where: { ...scope, clickedAt: { not: null } } }),
    db.linkClick.count({
      where: campaignId
        ? { link: { campaignId } }
        : { link: { campaign: { organizationId } } },
    }),
  ]);

  const gap = provider - tracked;
  // A gap only means something once there is enough traffic for a ratio to be
  // stable. Two clicks against one is not a finding, it is two clicks.
  const notable = provider + tracked >= 20 && Math.abs(gap) >= Math.max(5, 0.2 * Math.max(provider, tracked));

  return {
    provider,
    tracked,
    gap,
    notable,
    explanation:
      gap > 0
        ? 'Your email provider counted more clicks than our own links did. That is usually security scanners on business addresses opening every link before the message is delivered — the provider counts those, we do not.'
        : gap < 0
          ? 'Our own links counted more clicks than your email provider did. That happens when people click a link we track on a page the provider never saw, or forward the message on.'
          : 'Both counts agree.',
  };
}
