import type { Channel } from './types';

/**
 * Why a number is missing.
 *
 * `analytics.ts` has, since Phase 2, split every metric into `MEASURED` and
 * `UNMEASURED` — two global arrays of metric names, applied to every channel
 * alike. That was the right instinct at the time and it is now wrong in both
 * directions at once.
 *
 * It **under-claims**: impressions, engagements and spend are reported as
 * unmeasured for *email*, where Phases 7, 8 and 10 give us the exact number
 * delivered, the exact number opened, and the exact cost to the cent. The
 * screen says "Needs a platform metrics connection" about the one channel we
 * measure best.
 *
 * And it **flattens**: "not measured" is one label covering four situations an
 * owner would act on differently.
 *
 *   - We have the number.
 *   - The platform would tell us, but no account is connected. *Connect it.*
 *   - The platform would tell us and we have not written the reader yet.
 *     *Our problem, not yours.*
 *   - **The platform does not publish this number to anybody.** Nothing anyone
 *     does will produce it.
 *
 * The last one is the one that matters most and the one a single "unmeasured"
 * flag destroys. Bluesky's API returns likes, reposts and replies, and no view
 * count — not a restricted view count, not one behind a paid tier: the number
 * does not exist in the response. An owner comparing channels on "impressions"
 * needs to know that the blank is permanent, because otherwise they wait for
 * it, or they read the blank as zero and conclude nobody saw the post.
 */

export type Metric = 'impressions' | 'engagements' | 'clicks' | 'spend' | 'leads' | 'conversions' | 'revenue';

export type Measurability =
  /** We hold rows for it. */
  | 'measured'
  /** The platform reports it; nothing is connected. Actionable by the owner. */
  | 'not_connected'
  /** The platform reports it; we have not built the reader. Actionable by us. */
  | 'not_ingested'
  /** The platform does not publish this number. Actionable by nobody. */
  | 'unavailable';

export interface MetricAvailability {
  state: Measurability;
  /** One sentence, in the owner's language, for the tooltip and the table. */
  reason: string;
}

/**
 * What each platform actually publishes, independent of what we have built.
 *
 * This is a statement about the *API*, not about our progress, which is why it
 * is a separate table from the publisher registry. `false` here means the
 * number is not obtainable, and no amount of work on our side changes that.
 */
interface PlatformReports {
  impressions: boolean;
  engagements: boolean;
  /** Clicks the *platform* counts, which is never the same as ours. */
  clicks: boolean;
  spend: boolean;
}

const REPORTS: Record<Channel, PlatformReports> = {
  // The two we can publish to. Both report engagement and neither reports
  // reach — checked against the actual response shapes, not assumed.
  //   Bluesky  app.bsky.feed.getPosts → likeCount, repostCount, replyCount
  //   Mastodon GET /api/v1/statuses/:id → favourites_count, reblogs_count, replies_count
  bluesky: { impressions: false, engagements: true, clicks: false, spend: false },
  mastodon: { impressions: false, engagements: true, clicks: false, spend: false },

  // Ours end to end. No platform involved, so nothing is withheld: we know
  // what we sent, what came back, and what it cost.
  email: { impressions: true, engagements: true, clicks: true, spend: true },
  sms: { impressions: true, engagements: false, clicks: false, spend: true },

  // A visit to a site carrying our snippet is measured by us, the same way.
  // There is no impression to count — nobody "sees" a website without
  // arriving at it, so reach and visits are the same event.
  website: { impressions: false, engagements: false, clicks: true, spend: false },

  // Modelled, not wired. These genuinely do publish the numbers — the blank is
  // ours to close, and saying so keeps the pressure in the right place.
  facebook: { impressions: true, engagements: true, clicks: true, spend: true },
  instagram: { impressions: true, engagements: true, clicks: true, spend: true },
  linkedin: { impressions: true, engagements: true, clicks: true, spend: true },
  tiktok: { impressions: true, engagements: true, clicks: true, spend: true },
  youtube: { impressions: true, engagements: true, clicks: true, spend: true },
  google_business: { impressions: true, engagements: true, clicks: true, spend: true },
  pinterest: { impressions: true, engagements: true, clicks: true, spend: true },
  snapchat: { impressions: true, engagements: true, clicks: true, spend: true },
  x: { impressions: true, engagements: true, clicks: true, spend: true },

  // Threads' API returns views and interactions per post but no click count.
  threads: { impressions: true, engagements: true, clicks: false, spend: false },

  // Reddit gives a score and a comment count. `view_count` exists on the
  // object and is null for everyone but the subreddit's own moderators.
  reddit: { impressions: false, engagements: true, clicks: false, spend: true },

  // Nextdoor has no public post-metrics API at all outside its ad product.
  nextdoor: { impressions: false, engagements: false, clicks: false, spend: true },

  // WhatsApp Business reports delivery and read receipts per message — the
  // same shape as email, and the reason `impressions` is true here: a
  // delivered message is a guaranteed impression in a way a feed post is not.
  whatsapp: { impressions: true, engagements: false, clicks: false, spend: true },
};

/** Metrics computed from rows we own on every channel, with no platform involved. */
const OURS: Metric[] = ['leads', 'conversions', 'revenue'];

/**
 * Whether we have written the reader for a channel yet.
 *
 * Deliberately separate from `REPORTS`. Merging them would collapse "the
 * platform will not say" into "we have not asked", which is the exact
 * distinction this file exists to preserve.
 */
const INGESTED: Channel[] = ['email', 'sms', 'bluesky', 'mastodon', 'website', 'facebook'];

export interface MeasurabilityContext {
  /** Channels holding a live grant right now. */
  connected: Channel[];
}

/**
 * What we can say about one metric on one channel.
 *
 * Ordered deliberately: `unavailable` is checked before `not_connected`,
 * because connecting an account that will never report the number is a waste
 * of an owner's afternoon and the product should not imply otherwise.
 */
export function measurabilityOf(
  channel: Channel,
  metric: Metric,
  ctx: MeasurabilityContext
): MetricAvailability {
  if (OURS.includes(metric)) {
    return { state: 'measured', reason: 'Counted from conversions on your own site.' };
  }

  // Our own tracked links work on every channel that can carry a link, whoever
  // owns the platform — that is the entire point of minting one per variation.
  if (metric === 'clicks') {
    return { state: 'measured', reason: 'Counted from clicks on our own tracked link.' };
  }

  const reports = REPORTS[channel];
  if (!reports) {
    return { state: 'unavailable', reason: 'We do not model this channel.' };
  }

  const key = metric as keyof PlatformReports;
  if (!reports[key]) {
    return { state: 'unavailable', reason: `${label(channel)} does not report ${plain(metric)} to anyone.` };
  }

  if (!INGESTED.includes(channel)) {
    return { state: 'not_ingested', reason: `${label(channel)} reports ${plain(metric)}; we do not read it yet.` };
  }

  // Email and SMS are ours: there is no account to connect, and the numbers
  // exist the moment something is sent.
  if (channel === 'email' || channel === 'sms' || channel === 'website') {
    return { state: 'measured', reason: `Counted from what we sent and what came back.` };
  }

  if (!ctx.connected.includes(channel)) {
    return { state: 'not_connected', reason: `Connect ${label(channel)} and this fills in.` };
  }

  return { state: 'measured', reason: `Read from ${label(channel)} after each post.` };
}

/** True when a blank in this cell is nobody's fault and will never fill. */
export function isPermanentBlank(a: MetricAvailability): boolean {
  return a.state === 'unavailable';
}

/**
 * The one-line summary under a report.
 *
 * Built from the actual channels in the report rather than a fixed sentence,
 * because "impressions need a platform connection" is false when the only
 * channel used was email and misleading when it was Bluesky.
 */
export function summarise(channels: Channel[], ctx: MeasurabilityContext): string {
  if (channels.length === 0) return 'Nothing has run yet.';

  const metrics: Metric[] = ['impressions', 'engagements', 'spend'];
  const connectable = new Set<string>();
  const permanent = new Set<string>();
  const pending = new Set<string>();

  for (const ch of channels) {
    for (const m of metrics) {
      const a = measurabilityOf(ch, m, ctx);
      if (a.state === 'not_connected') connectable.add(label(ch));
      else if (a.state === 'not_ingested') pending.add(label(ch));
      else if (a.state === 'unavailable') permanent.add(`${plain(m)} on ${label(ch)}`);
    }
  }

  const parts: string[] = ['Clicks, leads and revenue are measured on every channel.'];
  if (connectable.size > 0) parts.push(`Connect ${list([...connectable])} to fill in the rest.`);
  if (pending.size > 0) parts.push(`We do not read ${list([...pending])} metrics yet.`);
  if (permanent.size > 0) parts.push(`${cap(list([...permanent]))} ${permanent.size === 1 ? 'is' : 'are'} never reported by the platform.`);
  return parts.join(' ');
}

function list(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plain(metric: Metric): string {
  return metric === 'impressions' ? 'how many people saw it' : metric === 'engagements' ? 'likes and shares' : metric;
}

const LABELS: Partial<Record<Channel, string>> = {
  google_business: 'Google Business',
  x: 'X',
  sms: 'Text messages',
  email: 'Email',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

export function label(channel: Channel): string {
  return LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}
