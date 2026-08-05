import { db } from './db';
import type { Channel, ContentFormat } from './types';

/**
 * The learning loop.
 *
 * Phase 2 made the reporting true. This is what that was *for*: a product that
 * gets better at a specific business the longer it runs, and can say why.
 *
 * Every number here is a join from a published post to the results it caused —
 * `ChannelVariation` → `TrackedLink` → `LinkClick` → `Conversion` — grouped by
 * the things an owner can actually change: what format the post was, which
 * channel it went to, which day, what time.
 *
 * **The discipline that matters is refusing to answer.** Two posts is not a
 * pattern. A finding drawn from three clicks is noise wearing a percentage
 * sign, and a product that states it confidently teaches people to distrust
 * everything else it says. So every comparison carries the sample it came from
 * and anything below the floor is withheld rather than hedged.
 */

/** Below this many posts in a bucket, we don't have an opinion. */
export const MIN_POSTS = 3;
/** Below this many clicks, a conversion rate is meaningless. */
export const MIN_CLICKS = 25;
/** Smaller than this and the "difference" is rounding. */
export const MIN_LIFT = 1.25;

export interface Bucket {
  key: string;
  label: string;
  posts: number;
  clicks: number;
  conversions: number;
  /** Conversions per click. Null when the sample is too small to divide. */
  rate: number | null;
  revenue: number;
}

export interface Finding {
  /** What was compared: format, channel, weekday, hour. */
  dimension: 'format' | 'channel' | 'weekday' | 'hour';
  best: Bucket;
  /** What it beat. Null when only one bucket cleared the sample floor. */
  versus: Bucket | null;
  /** best.rate / versus.rate — the number a suggestion is allowed to quote. */
  lift: number | null;
  /** The claim, in the owner's words, with the evidence in it. */
  sentence: string;
}

interface Row {
  variationId: string;
  brandId: string;
  format: string;
  channel: string;
  publishedAt: Date;
  clicks: number;
  conversions: number;
  revenue: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FORMAT_LABEL: Partial<Record<ContentFormat, string>> = {
  post: 'plain posts',
  reel: 'short videos',
  story: 'stories',
  video: 'long videos',
  update: 'local updates',
  pin: 'pins',
  email: 'emails',
  sms: 'texts',
};

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/**
 * One row per published post, with the results it produced.
 *
 * This is the join the whole phase rests on. Pulled flat rather than
 * aggregated in SQL because every dimension below regroups the same rows a
 * different way, and doing that four times in the database would be four
 * round trips to answer one question.
 */
export async function performanceRows(organizationId: string, brandId?: string): Promise<Row[]> {
  const variations = await db.channelVariation.findMany({
    where: {
      status: 'PUBLISHED',
      contentItem: { campaign: { organizationId, ...(brandId ? { brandId } : {}) } },
    },
    select: {
      id: true, format: true, channel: true, publishedAt: true,
      contentItem: { select: { campaign: { select: { brandId: true } } } },
      trackedLink: { select: { _count: { select: { clicks: true } } } },
      conversions: { select: { valueCents: true } },
    },
  });

  return variations
    .filter((v) => v.publishedAt)
    .map((v) => ({
      variationId: v.id,
      brandId: v.contentItem.campaign.brandId,
      format: v.format,
      channel: v.channel.toLowerCase(),
      publishedAt: v.publishedAt!,
      clicks: v.trackedLink?._count.clicks ?? 0,
      conversions: v.conversions.length,
      revenue: v.conversions.reduce((s, c) => s + c.valueCents, 0) / 100,
    }));
}

/** Group rows into buckets and compute a rate where the sample allows it. */
function bucketize(rows: Row[], key: (r: Row) => string, label: (k: string) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const k = key(r);
    const b = map.get(k) ?? { key: k, label: label(k), posts: 0, clicks: 0, conversions: 0, rate: null, revenue: 0 };
    b.posts += 1;
    b.clicks += r.clicks;
    b.conversions += r.conversions;
    b.revenue += r.revenue;
    map.set(k, b);
  }
  for (const b of map.values()) {
    // A rate needs both enough posts to be a pattern and enough clicks to be
    // a rate. Either one alone is how you get "this format converts at 100%"
    // from a single click.
    b.rate = b.posts >= MIN_POSTS && b.clicks >= MIN_CLICKS ? b.conversions / b.clicks : null;
  }
  return [...map.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

/** The strongest honest claim for one dimension, or null if there isn't one. */
function compare(
  dimension: Finding['dimension'],
  buckets: Bucket[],
  phrase: (best: Bucket, versus: Bucket | null, lift: number | null) => string
): Finding | null {
  const usable = buckets.filter((b) => b.rate !== null);
  if (usable.length === 0) return null;

  const best = usable[0];
  const versus = usable.length > 1 ? usable[usable.length - 1] : null;
  const lift = versus && versus.rate! > 0 ? best.rate! / versus.rate! : null;

  // One bucket above the floor is a fact about that bucket, not a comparison.
  // Reporting it as "your best" when nothing else qualified would be a claim
  // the data does not support.
  if (versus && (lift === null || lift < MIN_LIFT)) return null;

  return { dimension, best, versus, lift, sentence: phrase(best, versus, lift) };
}

export interface Learning {
  brandId: string | null;
  /** Posts that had results to learn from. */
  sample: { posts: number; clicks: number; conversions: number };
  findings: Finding[];
  /** Present when there wasn't enough to say anything, explaining what's missing. */
  notEnoughYet: string | null;
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export async function learn(organizationId: string, brandId?: string): Promise<Learning> {
  const rows = await performanceRows(organizationId, brandId);
  const sample = {
    posts: rows.length,
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
  };

  const findings = [
    compare(
      'format',
      bucketize(rows, (r) => r.format, (k) => FORMAT_LABEL[k as ContentFormat] ?? `${k} posts`),
      (best, versus, lift) =>
        versus && lift
          ? `Your ${best.label} convert ${lift.toFixed(1)}× better than your ${versus.label} — ${pct(best.rate!)} of clicks versus ${pct(versus.rate!)}, across ${best.posts + versus.posts} posts.`
          : `Your ${best.label} convert ${pct(best.rate!)} of clicks, across ${best.posts} posts.`
    ),
    compare(
      'channel',
      bucketize(rows, (r) => r.channel, (k) => k.replace('_', ' ')),
      (best, versus, lift) =>
        versus && lift
          ? `${best.label} is doing ${lift.toFixed(1)}× the work of ${versus.label} — ${best.conversions} results from ${best.clicks} clicks.`
          : `${best.label} is your strongest channel — ${best.conversions} results from ${best.clicks} clicks.`
    ),
    compare(
      'weekday',
      bucketize(rows, (r) => String(r.publishedAt.getUTCDay()), (k) => WEEKDAYS[Number(k)]),
      (best, versus, lift) =>
        versus && lift
          ? `${best.label} posts do ${lift.toFixed(1)}× better than ${versus.label} ones.`
          : `${best.label} is your best day to post.`
    ),
    compare(
      // Grouped into parts of the day, not clock hours: twenty-four buckets
      // over a few dozen posts guarantees every one is too small to use.
      'hour',
      bucketize(
        rows,
        (r) => {
          const h = r.publishedAt.getUTCHours();
          return h < 12 ? 'morning' : h < 16 ? 'midday' : 'afternoon';
        },
        (k) => ({ morning: 'Mornings', midday: 'Midday', afternoon: 'Late afternoons' })[k] ?? k
      ),
      (best, versus, lift) =>
        versus && lift
          ? `${best.label} outperform ${versus.label.toLowerCase()} by ${lift.toFixed(1)}× — ${pct(best.rate!)} of clicks convert versus ${pct(versus.rate!)}.`
          : `${best.label} are your best time to post.`
    ),
  ].filter((f): f is Finding => f !== null);

  return {
    brandId: brandId ?? null,
    sample,
    findings,
    notEnoughYet:
      findings.length > 0
        ? null
        : sample.posts === 0
          ? 'Nothing published yet. Results appear here once posts go out and their links get clicked.'
          : `Not enough yet to draw a conclusion — ${sample.posts} published ${sample.posts === 1 ? 'post' : 'posts'} and ${sample.clicks} clicks so far. We need at least ${MIN_POSTS} posts and ${MIN_CLICKS} clicks in a group before comparing.`,
  };
}

/** Best time to post for a brand, from its own history rather than a global default. */
export interface BestTime {
  /** 'HH:mm', the hour that converted best. */
  time: string;
  weekday: string | null;
  /** Why, in the owner's words. Null when we're falling back to a default. */
  reason: string | null;
  /** True when this came from the brand's own results. */
  learned: boolean;
}

export async function bestTimeFor(organizationId: string, brandId: string): Promise<BestTime> {
  const rows = await performanceRows(organizationId, brandId);

  /**
   * The decision rests on a *part of the day*, not a clock hour.
   *
   * Slicing one brand's history into twenty-four hourly buckets guarantees
   * every one is too small to use — which is the over-slicing this module
   * warns about, and the first version of this function walked straight into
   * it: only the brand with twice the history got an answer at all.
   *
   * So the comparison is across three wide buckets, and the specific hour
   * returned is the best-performing one the brand actually posted in inside
   * the winning bucket. The claim is carried by the bucket; the hour is a
   * representative choice within it, and the reason says so.
   */
  const partOf = (r: Row) => {
    const h = r.publishedAt.getUTCHours();
    return h < 12 ? 'morning' : h < 16 ? 'midday' : 'afternoon';
  };
  const PART_LABEL: Record<string, string> = {
    morning: 'mornings', midday: 'midday', afternoon: 'late afternoons',
  };

  const parts = bucketize(rows, partOf, (k) => PART_LABEL[k] ?? k).filter((b) => b.rate !== null);
  if (parts.length === 0) {
    // A global default is a guess, and it should say so rather than borrow the
    // authority of a learned answer.
    return { time: '09:00', weekday: null, reason: null, learned: false };
  }

  const part = parts[0];
  const inPart = rows.filter((r) => partOf(r) === part.key);
  const hours = bucketize(inPart, (r) => String(r.publishedAt.getUTCHours()), (k) => hourLabel(Number(k)));
  // Inside the winning bucket, order by conversions rather than rate: every
  // hour here is small, and the raw count is the more stable signal.
  const hour = [...hours].sort((a, b) => b.conversions - a.conversions)[0];

  const byDay = bucketize(rows, (r) => String(r.publishedAt.getUTCDay()), (k) => WEEKDAYS[Number(k)]);
  const bestDay = byDay.filter((b) => b.rate !== null)[0] ?? null;

  return {
    time: `${String(hour.key).padStart(2, '0')}:00`,
    weekday: bestDay?.label ?? null,
    reason: `Your ${part.label} convert ${pct(part.rate!)} of clicks across ${part.posts} posts, and ${hour.label} is the slot in that window that has worked best${
      bestDay ? `. ${bestDay.label}s do best overall` : ''
    }.`,
    learned: true,
  };
}
