import { db } from './db';
import { measurabilityOf, summarise, type Metric as MetricName, type MetricAvailability } from './measurability';
import { reconcileClicks, type ClickReconciliation } from './metrics';
import { canPublish } from './publishers/registry';
import type { Campaign, CampaignGoal, CampaignPerformance, Channel, ChannelMetrics } from './types';

/**
 * Campaign performance, computed from rows.
 *
 * This is the step the whole measurement phase was for. Until now every number
 * on `/analytics` came from a fixture, which meant the product's central claim
 * — "this campaign generated N quote requests" — was a sentence someone typed.
 * Now it is a `COUNT`.
 *
 * **The honest part is what this cannot compute** — and for two phases that
 * honesty was applied too broadly. Clicks, leads, conversions and revenue come
 * from rows we own. Impressions, engagements and spend were reported as
 * unmeasured on *every* channel, which was true for Facebook and false for
 * email: Phases 7, 8 and 10 give us the exact number delivered, the exact
 * number opened, and the cost to the cent. The screen said "Needs a platform
 * metrics connection" about the channel we measure best.
 *
 * The tempting move is still to leave the rest as `0`, and it is still a lie
 * with a number on it: an owner reading "0 impressions" concludes their post
 * was not seen. So unmeasured metrics stay `null` — but the *reason* is now
 * carried alongside, per channel and per metric, because "connect your
 * Instagram" and "Bluesky does not count views, ever" are different sentences
 * and only one of them is worth acting on.
 */

/** Which conversion kinds count toward which campaign goal. */
const GOAL_KINDS: Record<CampaignGoal, string[]> = {
  quote_requests: ['quote_request', 'form_submission'],
  bookings: ['booking'],
  rental_inquiries: ['form_submission', 'call'],
  trial_signups: ['trial_signup'],
  purchases: ['purchase'],
  email_signups: ['form_submission'],
  calls: ['call'],
  // Awareness has no conversion event by definition — that is what makes it
  // an awareness campaign. Every tracked result counts toward it.
  awareness: [],
};

export interface PerformanceMeta {
  /**
   * Why each blank is blank, per channel and per metric.
   *
   * This replaced two global arrays of metric names. Those said "impressions
   * are unmeasured" about every channel alike, which was wrong for email —
   * where we know exactly how many were delivered — and unhelpfully vague for
   * Bluesky, where the number is not a gap but an absence: the platform does
   * not publish it to anybody.
   */
  availability: Record<string, Partial<Record<MetricName, MetricAvailability>>>;
  /** One sentence built from the channels actually in this report. */
  summary: string;
  /** How many conversions we could trace to a post, out of the total. */
  attributedConversions: number;
  totalConversions: number;
  /** Two independent click counts, shown side by side rather than merged. */
  clickReconciliation?: ClickReconciliation;
}

export interface ComputedPerformance {
  performance: CampaignPerformance[];
  meta: PerformanceMeta;
}

/** Metrics an availability answer exists for. */
const REPORTED: MetricName[] = ['impressions', 'engagements', 'spend', 'clicks', 'leads', 'conversions', 'revenue'];

/**
 * Add readings, keeping "nobody said" distinct from "they said zero".
 *
 * Returns null when every value was null — which is the Bluesky and Mastodon
 * case for impressions, permanently. A `reduce` with `?? 0` would turn a
 * column nobody reports into a confident zero, which is the single most
 * misleading number this file could produce.
 */
function sum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** Monday of the week containing `d`, as 'YYYY-MM-DD'. */
function weekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - (day === 0 ? 6 : day - 1));
  return x.toISOString().slice(0, 10);
}

export async function computePerformance(organizationId: string): Promise<ComputedPerformance> {
  const [campaigns, clicks, conversions, platform] = await Promise.all([
    db.campaign.findMany({ where: { organizationId } }),
    // Clicks reach a channel through the link's variation. Grouping in SQL
    // would need a three-table join for a handful of rows; pulling the pairs
    // and counting here is clearer and, at this size, no slower.
    db.linkClick.findMany({
      where: { link: { campaign: { organizationId } } },
      select: {
        clickedAt: true,
        link: { select: { campaignId: true, variation: { select: { channel: true } } } },
      },
    }),
    db.conversion.findMany({
      where: { organizationId },
      select: { campaignId: true, channel: true, kind: true, valueCents: true, occurredAt: true },
    }),
    // The platform readings, newest first. Only the newest per variation is
    // current — the older rows are the series, which a trend chart wants and
    // a "how is this post doing" table does not.
    db.metric.findMany({
      where: { variation: { contentItem: { campaign: { organizationId } } } },
      select: {
        variationId: true,
        impressions: true,
        engagements: true,
        clicks: true,
        postMissing: true,
        capturedAt: true,
        variation: { select: { channel: true, contentItem: { select: { campaignId: true } } } },
      },
      orderBy: { capturedAt: 'desc' },
    }),
  ]);

  // Newest reading per variation. A campaign's engagement is the sum of its
  // posts' current figures, not the sum of every reading ever taken — adding
  // the series would multiply a post's likes by how often we asked.
  const latest = new Map<string, (typeof platform)[number]>();
  for (const m of platform) if (!latest.has(m.variationId)) latest.set(m.variationId, m);
  const current = [...latest.values()].filter((m) => !m.postMissing);

  // Email and SMS numbers come from the send rows, aggregated in JS the same
  // way clicks and conversions already are. `EmailDelivery.variationId` is a
  // plain column rather than a foreign key, so the campaign cannot be reached
  // by a join at all — it goes through a lookup built from the org's own
  // variations, which also means a delivery pointing at a variation that no
  // longer exists is excluded rather than crashing the whole report.
  const variations = await db.channelVariation.findMany({
    where: { contentItem: { campaign: { organizationId } } },
    select: { id: true, contentItem: { select: { campaignId: true } } },
  });
  const campaignOfVariation = new Map(variations.map((v) => [v.id, v.contentItem.campaignId]));

  const [emails, texts, spend] = await Promise.all([
    db.emailDelivery.findMany({
      // Scoped through the contact, which is a real relation and always
      // present. The batch is nullable and would drop rows.
      where: { contact: { organizationId } },
      select: { status: true, openedAt: true, clickedAt: true, variationId: true },
    }),
    db.smsDelivery.findMany({
      where: { contact: { organizationId } },
      select: { status: true, variationId: true },
    }),
    db.spendEntry.findMany({
      where: { organizationId, campaignId: { not: null } },
      select: { campaignId: true, channel: true, cents: true },
    }),
  ]);

  const DELIVERED = ['DELIVERED', 'OPENED', 'CLICKED'];
  const connected = (['bluesky', 'mastodon'] as Channel[]).filter((c) => canPublish(c));
  const ctx = { connected };

  const performance: CampaignPerformance[] = campaigns.map((c) => {
    const cClicks = clicks.filter((x) => x.link.campaignId === c.id);
    const cConv = conversions.filter((x) => x.campaignId === c.id);

    // One row per channel that actually did something. A channel with no
    // clicks and no conversions is absent rather than a row of zeros — a table
    // full of zeros reads as failure when it usually means "not used".
    const channels = new Set<Channel>([
      ...cClicks.map((x) => x.link.variation.channel.toLowerCase() as Channel),
      ...cConv.filter((x) => x.channel).map((x) => x.channel!.toLowerCase() as Channel),
    ]);


    // Channels that sent or published for this campaign but produced no click
    // are still channels that did something, and a report that omits them
    // cannot show what an email cost. Added after the click/conversion set.
    const cEmails = emails.filter((x) => campaignOfVariation.get(x.variationId) === c.id);
    const cTexts = texts.filter((x) => campaignOfVariation.get(x.variationId) === c.id);
    const cMetrics = current.filter((m) => m.variation.contentItem.campaignId === c.id);
    if (cEmails.length > 0) channels.add('email');
    if (cTexts.length > 0) channels.add('sms');
    for (const m of cMetrics) channels.add(m.variation.channel.toLowerCase() as Channel);

    const byChannel: ChannelMetrics[] = [...channels].map((ch) => {
      const conv = cConv.filter((x) => x.channel?.toLowerCase() === ch);
      const chSpend = spend.filter((s) => s.campaignId === c.id && s.channel.toLowerCase() === ch);
      const chMetrics = cMetrics.filter((m) => m.variation.channel.toLowerCase() === ch);

      // A delivered message is the one impression in this product that is not
      // an estimate: it is in a mailbox or on a handset. A feed "reach" figure
      // counts people who scrolled past. Both land in this column because the
      // table has one, and the availability map is what stops them being read
      // as the same measurement.
      //
      // **No delivery rows at all means null, not zero.** Counting an empty
      // set gives 0, and "0 delivered, 117 clicks" is not a report — it is two
      // statements that cannot both be true. Zero rows means we hold no send
      // records for this campaign on this channel, which is the same kind of
      // blank as an unconnected platform, not a measurement of nothing.
      const sends = ch === 'email' ? cEmails : ch === 'sms' ? cTexts : null;
      const delivered =
        sends === null || sends.length === 0
          ? null
          : sends.filter((x) => DELIVERED.includes(x.status)).length;

      // Platform impressions stay null unless a platform actually said a
      // number. `sum` returns null when every reading was null, which is the
      // Bluesky and Mastodon case and must not become 0.
      const platformImpressions = sum(chMetrics.map((m) => m.impressions));
      const platformEngagements = sum(chMetrics.map((m) => m.engagements));

      return {
        channel: ch,
        impressions: delivered ?? platformImpressions,
        // Opens are the email equivalent of a like: the recipient did
        // something beyond receiving it.
        engagements:
          ch === 'email'
            ? cEmails.length === 0
              ? null
              : cEmails.filter((x) => x.openedAt !== null).length
            : ch === 'sms'
              ? null // a text has no open event; nobody can tell us
              : platformEngagements,
        spend: chSpend.length > 0 ? chSpend.reduce((s, x) => s + x.cents, 0) / 100 : null,
        clicks: cClicks.filter((x) => x.link.variation.channel.toLowerCase() === ch).length,
        leads: conv.length,
        // A "conversion" in the owner's sense is a completed outcome — money
        // or a booking — not any tracked event. Counting every form fill as a
        // conversion is how these dashboards stop meaning anything.
        conversions: conv.filter((x) => x.kind === 'purchase' || x.kind === 'booking').length,
        revenue: conv.reduce((s, x) => s + x.valueCents, 0) / 100,
      };
    });

    const goalKinds = GOAL_KINDS[c.goal as CampaignGoal] ?? [];
    const outcomes = [
      {
        kind: c.goal as CampaignGoal,
        count: goalKinds.length > 0 ? cConv.filter((x) => goalKinds.includes(x.kind)).length : cConv.length,
      },
    ];

    // Weekly buckets across the campaign's own window, so a chart has a
    // continuous x-axis instead of holes where a week had no leads.
    const weeks: { weekOf: string; leads: number }[] = [];
    for (let d = new Date(c.startDate); d <= c.endDate; d.setUTCDate(d.getUTCDate() + 7)) {
      const w = weekOf(d);
      if (!weeks.some((x) => x.weekOf === w)) weeks.push({ weekOf: w, leads: 0 });
    }
    for (const x of cConv) {
      const w = weeks.find((y) => y.weekOf === weekOf(x.occurredAt));
      if (w) w.leads += 1;
    }

    const leads = cConv.length;
    const revenue = cConv.reduce((s, x) => s + x.valueCents, 0) / 100;
    const top = [...byChannel].sort((a, b) => b.leads - a.leads)[0];

    return {
      campaignId: c.id,
      outcomes,
      byChannel,
      weeklyLeads: weeks,
      headline:
        leads === 0
          ? 'No tracked results yet. Results appear here once a published post’s link is clicked.'
          : `${leads} ${leads === 1 ? 'result' : 'results'} so far${
              revenue > 0 ? `, worth $${revenue.toLocaleString('en-US')}` : ''
            }${top ? `. ${top.channel.replace('_', ' ')} is doing the most work.` : '.'}`,
    };
  });

  // Availability is answered for the channels that appear in this report, not
  // for all eighteen. A table explaining why Snapchat impressions are missing
  // when nobody used Snapchat is noise.
  const used = [...new Set(performance.flatMap((p) => p.byChannel.map((c) => c.channel)))];
  const availability: PerformanceMeta['availability'] = {};
  for (const ch of used) {
    availability[ch] = {};
    for (const m of REPORTED) availability[ch][m] = measurabilityOf(ch, m, ctx);
  }

  return {
    performance,
    meta: {
      availability,
      summary: summarise(used, ctx),
      attributedConversions: conversions.filter((x) => x.campaignId).length,
      totalConversions: conversions.length,
      // Only worth computing, and only meaningful, when email was used.
      clickReconciliation: used.includes('email') ? await reconcileClicks(organizationId) : undefined,
    },
  };
}

/** Campaigns with any tracked activity at all — used to say so when there is none. */
export function hasResults(p: CampaignPerformance): boolean {
  return p.byChannel.length > 0;
}

export type { Campaign };
