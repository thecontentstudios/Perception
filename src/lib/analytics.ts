import { db } from './db';
import type { Campaign, CampaignGoal, CampaignPerformance, Channel, ChannelMetrics } from './types';

/**
 * Campaign performance, computed from rows.
 *
 * This is the step the whole measurement phase was for. Until now every number
 * on `/analytics` came from a fixture, which meant the product's central claim
 * — "this campaign generated N quote requests" — was a sentence someone typed.
 * Now it is a `COUNT`.
 *
 * **The honest part is what this cannot compute.** Clicks, leads, conversions,
 * and revenue all come from rows we own: `LinkClick` and `Conversion`.
 * Impressions, engagements, and ad spend do not — they live behind platform
 * metrics APIs and ad accounts this product does not read yet.
 *
 * The tempting move is to leave those as `0`. That is a lie with a number on
 * it: an owner reading "0 impressions" concludes their post was not seen,
 * which is a different and much worse claim than "we don't know". So the
 * unmeasured metrics are `null`, the UI renders them as "not measured", and
 * `measured` says plainly which is which.
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
  /** Metrics backed by rows we own, versus ones that need a platform API. */
  measured: (keyof ChannelMetrics)[];
  unmeasured: (keyof ChannelMetrics)[];
  /** How many conversions we could trace to a post, out of the total. */
  attributedConversions: number;
  totalConversions: number;
}

export interface ComputedPerformance {
  performance: CampaignPerformance[];
  meta: PerformanceMeta;
}

const MEASURED: (keyof ChannelMetrics)[] = ['clicks', 'leads', 'conversions', 'revenue'];
const UNMEASURED: (keyof ChannelMetrics)[] = ['impressions', 'engagements', 'spend'];

/** Monday of the week containing `d`, as 'YYYY-MM-DD'. */
function weekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - (day === 0 ? 6 : day - 1));
  return x.toISOString().slice(0, 10);
}

export async function computePerformance(organizationId: string): Promise<ComputedPerformance> {
  const [campaigns, clicks, conversions] = await Promise.all([
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
  ]);

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

    const byChannel: ChannelMetrics[] = [...channels].map((ch) => {
      const conv = cConv.filter((x) => x.channel?.toLowerCase() === ch);
      return {
        channel: ch,
        impressions: null,
        engagements: null,
        spend: null,
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

  return {
    performance,
    meta: {
      measured: MEASURED,
      unmeasured: UNMEASURED,
      attributedConversions: conversions.filter((x) => x.campaignId).length,
      totalConversions: conversions.length,
    },
  };
}

/** Campaigns with any tracked activity at all — used to say so when there is none. */
export function hasResults(p: CampaignPerformance): boolean {
  return p.byChannel.length > 0;
}

export type { Campaign };
