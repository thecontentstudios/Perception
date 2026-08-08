import { randomUUID } from 'node:crypto';
import { db } from './db';
import { AD_RATES } from './pricing';
import type { Channel } from './types';

/**
 * Ad campaigns: planned here, bought there, and the money honest throughout.
 *
 * This file is the product taking a position. Full API integration with
 * eleven ad platforms is a year of work, most of it approval queues, and a
 * "Launch" button wired to none of it would be the ledger lie of Phase 7 all
 * over again at a hundred times the price. What a small business actually
 * needs is the part the platforms are bad at: deciding how much to spend and
 * on what, being told what that buys *as a range*, getting a brief they can
 * execute in the platform's own tool in ten minutes, and having the money
 * land in the same ledger as every other channel afterwards.
 *
 * So a flight has money states, not delivery states: `planned` → `handed_off`
 * → `settled`. The platform runs the ad; we keep the books. Spend imported
 * mid-flight is written `certainty: 'estimated'`, because a screenshot of a
 * dashboard is not an invoice — and settling replaces belief with fact, in
 * place, leaving the history intact.
 */

export interface FlightPlan {
  channel: Channel;
  objective: string;
  audience: string;
  headline?: string;
  body: string;
  destinationUrl: string;
  dailyCents: number;
  days: number;
  campaignId?: string;
  brandId?: string;
}

export interface PlanProblem {
  field: string;
  message: string;
}

/**
 * Validate a plan against the platform's own posted floor.
 *
 * The daily minimum is not ours: below it, auction platforms never leave the
 * learning phase and the money is spent teaching an algorithm rather than
 * reaching anyone. Refusing to plan an un-runnable flight is cheaper than the
 * owner discovering it inside the ads manager.
 */
export function validatePlan(plan: FlightPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const rate = AD_RATES[plan.channel];

  if (!rate) {
    problems.push({ field: 'channel', message: `We do not model buying ads on ${plan.channel}.` });
    return problems;
  }
  if (plan.dailyCents < rate.minDailyCents) {
    problems.push({
      field: 'dailyCents',
      message: `${label(plan.channel)} needs about $${(rate.minDailyCents / 100).toFixed(0)}/day to leave the learning phase. Below that the budget teaches the algorithm and reaches almost nobody.`,
    });
  }
  if (plan.days < 1) problems.push({ field: 'days', message: 'A flight needs at least one day.' });
  if (plan.days > 90) {
    problems.push({ field: 'days', message: 'Plan at most 90 days at a time — rates drift, and a quarter-old estimate is a guess about a guess.' });
  }
  if (!plan.objective.trim()) problems.push({ field: 'objective', message: 'Say what this flight is supposed to cause.' });
  if (!plan.audience.trim()) problems.push({ field: 'audience', message: 'Say who this should reach.' });
  if (!plan.body.trim()) problems.push({ field: 'body', message: 'The ad needs body text.' });
  try {
    const u = new URL(plan.destinationUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
  } catch {
    problems.push({ field: 'destinationUrl', message: 'The destination must be a working web address.' });
  }
  return problems;
}

/**
 * What the budget buys, at posted rates. The spend is exact — the owner sets
 * it — and the outcome is the estimate. Kept as the range the rates imply
 * rather than a midpoint, because the width is the information.
 */
export function estimateOutcome(channel: Channel, totalCents: number): { low: number; high: number; unit: 'impressions' | 'clicks' } {
  const rate = AD_RATES[channel];
  if (!rate) return { low: 0, high: 0, unit: 'impressions' };
  if (rate.model === 'cpm') {
    return {
      low: Math.floor((totalCents / rate.highCents) * 1000),
      high: Math.floor((totalCents / rate.lowCents) * 1000),
      unit: 'impressions',
    };
  }
  return {
    low: Math.floor(totalCents / rate.highCents),
    high: Math.floor(totalCents / rate.lowCents),
    unit: 'clicks',
  };
}

export async function planFlight(organizationId: string, plan: FlightPlan) {
  const problems = validatePlan(plan);
  if (problems.length > 0) return { ok: false as const, problems };

  const est = estimateOutcome(plan.channel, plan.dailyCents * plan.days);

  // The id is minted before the row so the destination URL can carry it.
  // One shared utm_campaign across flights would make results attributable
  // to "ads, generally" — which is a report about nothing.
  const id = `fl${randomUUID().replace(/-/g, '').slice(0, 22)}`;
  const destination = withUtm(plan.destinationUrl, plan.channel, id);

  const flight = await db.adFlight.create({
    data: {
      id,
      organizationId,
      brandId: plan.brandId ?? null,
      campaignId: plan.campaignId ?? null,
      channel: plan.channel.toUpperCase() as never,
      objective: plan.objective.trim(),
      audience: plan.audience.trim(),
      headline: plan.headline?.trim() || null,
      body: plan.body.trim(),
      destinationUrl: destination,
      dailyCents: plan.dailyCents,
      days: plan.days,
      estImpressionsLow: est.low,
      estImpressionsHigh: est.high,
    },
  });
  return { ok: true as const, flight, estimate: est };
}

/**
 * The destination, already carrying its attribution — **per flight**.
 *
 * Minted at planning time rather than left for the owner to remember inside
 * the ads manager, because a click that arrives without UTMs is a conversion
 * the flight caused and can never be credited with. The campaign tag is the
 * flight's own id: the snippet on the landing page reads it back off the URL
 * and sends it with every conversion, which is the entire mechanism that
 * lets a flight show what it caused.
 */
export function withUtm(url: string, channel: Channel, flightId: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', channel);
  u.searchParams.set('utm_medium', 'paid');
  u.searchParams.set('utm_campaign', `pf_${flightId}`);
  return u.toString();
}

// ---------------------------------------------------------------------------
// What the flight caused
// ---------------------------------------------------------------------------

export interface FlightResults {
  conversions: number;
  revenueCents: number;
  byKind: Record<string, number>;
  /**
   * What one result cost. Null until there is at least one result — a CPA
   * with zero in the denominator is not a big number, it is no number.
   */
  costPerResultCents: number | null;
  /**
   * exact once the invoice settled, estimated while the spend is a dashboard
   * figure. The same word the ledger uses, because it is the same fact.
   */
  certainty: 'exact' | 'estimated' | null;
}

/**
 * Conversions the flight's own UTM tag brought in, joined to its money.
 *
 * The spend side is exact the moment the invoice settles; the results side
 * is only ever what our snippet measured. Cost-per-result divides exact
 * money by measured outcomes and says which it is — never a blend, and
 * never a platform's self-graded "conversions" column.
 */
export async function flightResults(
  organizationId: string,
  flight: { id: string; status: string; settledCents: number | null }
): Promise<FlightResults> {
  const conversions = await db.conversion.findMany({
    where: {
      organizationId,
      attribution: { path: ['utmCampaign'], equals: `pf_${flight.id}` },
    },
    select: { kind: true, valueCents: true },
  });

  const byKind: Record<string, number> = {};
  for (const c of conversions) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

  let spentCents: number | null = null;
  let certainty: 'exact' | 'estimated' | null = null;
  if (flight.status === 'settled' && flight.settledCents != null) {
    spentCents = flight.settledCents;
    certainty = 'exact';
  } else {
    const est = await db.spendEntry.aggregate({ where: { flightId: flight.id }, _sum: { cents: true } });
    if ((est._sum.cents ?? 0) > 0) {
      spentCents = est._sum.cents!;
      certainty = 'estimated';
    }
  }

  return {
    conversions: conversions.length,
    revenueCents: conversions.reduce((a, c) => a + c.valueCents, 0),
    byKind,
    costPerResultCents:
      conversions.length > 0 && spentCents != null ? Math.round(spentCents / conversions.length) : null,
    certainty: conversions.length > 0 && spentCents != null ? certainty : null,
  };
}

// ---------------------------------------------------------------------------
// The handoff
// ---------------------------------------------------------------------------

/** Where the buy actually happens, per platform. */
const ADS_MANAGERS: Partial<Record<Channel, { name: string; url: string }>> = {
  facebook: { name: 'Meta Ads Manager', url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns' },
  instagram: { name: 'Meta Ads Manager', url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns' },
  google_business: { name: 'Google Ads', url: 'https://ads.google.com/aw/campaigns/new' },
  youtube: { name: 'Google Ads', url: 'https://ads.google.com/aw/campaigns/new' },
  tiktok: { name: 'TikTok Ads Manager', url: 'https://ads.tiktok.com/i18n/creation' },
  linkedin: { name: 'LinkedIn Campaign Manager', url: 'https://www.linkedin.com/campaignmanager/' },
  pinterest: { name: 'Pinterest Ads', url: 'https://ads.pinterest.com/' },
  x: { name: 'X Ads', url: 'https://ads.x.com/' },
  reddit: { name: 'Reddit Ads', url: 'https://ads.reddit.com/' },
  nextdoor: { name: 'Nextdoor Ads', url: 'https://ads.nextdoor.com/' },
  snapchat: { name: 'Snapchat Ads Manager', url: 'https://ads.snapchat.com/' },
};

export interface FlightBrief {
  platform: { name: string; url: string };
  /** Plain text an owner can paste next to the ads manager and follow. */
  text: string;
  /** The position, stated where the UI can quote it. */
  statement: string;
}

export function briefFor(flight: {
  channel: string;
  objective: string;
  audience: string;
  headline: string | null;
  body: string;
  destinationUrl: string;
  dailyCents: number;
  days: number;
  estImpressionsLow: number;
  estImpressionsHigh: number;
}, opts: {
  /** File name of a campaign image the ad should use, when one exists. */
  creativeFileName?: string;
} = {}): FlightBrief {
  const ch = flight.channel.toLowerCase() as Channel;
  const manager = ADS_MANAGERS[ch] ?? { name: 'the platform’s ads manager', url: '' };
  const rate = AD_RATES[ch];
  const unit = rate?.model === 'cpc' ? 'clicks' : 'impressions';
  const total = flight.dailyCents * flight.days;

  const lines = [
    `AD BRIEF — ${label(ch)}`,
    ``,
    `Objective: ${flight.objective}`,
    `Audience: ${flight.audience}`,
    ...(opts.creativeFileName
      ? [
          ``,
          `Creative: use "${opts.creativeFileName}" from this campaign's media library — the same image the organic posts carry, so the ad and the feed match.`,
        ]
      : []),
    ``,
    `Budget: $${(flight.dailyCents / 100).toFixed(2)}/day for ${flight.days} days — $${(total / 100).toFixed(2)} total.`,
    `Set the budget as DAILY, not lifetime, and set an end date so it stops on its own.`,
    ``,
    `At posted rates this buys roughly ${flight.estImpressionsLow.toLocaleString('en-US')}–${flight.estImpressionsHigh.toLocaleString('en-US')} ${unit}. Treat that as a range, not a promise.`,
    ``,
    ...(flight.headline ? [`Headline: ${flight.headline}`] : []),
    `Ad text: ${flight.body}`,
    ``,
    `Destination (paste exactly — it carries the tracking that credits results back):`,
    flight.destinationUrl,
    ``,
    `When the platform invoices you, enter the real amount on the flight so the books close.`,
  ];

  return {
    platform: manager,
    text: lines.join('\n'),
    statement: `Perception plans the flight and keeps the books. You place the buy in ${manager.name} — we do not launch ads on your behalf.`,
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Record spend the platform reports mid-flight.
 *
 * `certainty: 'estimated'` is the whole point: a number read off a dashboard
 * is a belief about money, not money — platforms adjust for invalid traffic,
 * currency, and billing thresholds before invoicing. The ledger carries it,
 * the screen shows it in the lighter estimated style, and nothing pretends it
 * is settled.
 *
 * Idempotent per (flight, period): re-importing the same week updates the
 * figure rather than double-counting it.
 */
export async function recordFlightSpend(
  organizationId: string,
  flightId: string,
  cents: number,
  period: string
): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(period)) {
    return { ok: false, error: 'Period must be YYYY-MM or YYYY-MM-DD.' };
  }
  if (cents < 0) return { ok: false, error: 'Spend cannot be negative.' };

  const flight = await db.adFlight.findFirst({ where: { id: flightId, organizationId } });
  if (!flight) return { ok: false, error: 'No such flight.' };
  if (flight.status === 'settled') {
    return { ok: false, error: 'This flight has settled. The invoice is the record now.' };
  }

  const providerRef = `flight:${flightId}:${period}`;
  await db.spendEntry.upsert({
    where: { organizationId_providerRef: { organizationId, providerRef } },
    create: {
      organizationId,
      channel: flight.channel,
      kind: 'ad',
      certainty: 'estimated',
      cents,
      campaignId: flight.campaignId,
      flightId,
      providerRef,
      note: `Platform-reported spend for ${period} — awaiting invoice.`,
    },
    update: { cents },
  });
  return { ok: true };
}

/**
 * The invoice arrives, and belief becomes fact.
 *
 * In one transaction: every estimated entry on the flight flips to exact, and
 * if the invoice total differs from the running estimate, one adjustment row
 * carries the difference — so the ledger sums to the invoice without any
 * history being rewritten or deleted. A negative adjustment is normal;
 * platforms bill less than dashboards show more often than the reverse.
 */
export async function settleFlight(
  organizationId: string,
  flightId: string,
  invoiceCents: number
): Promise<{ ok: boolean; error?: string; adjustmentCents?: number }> {
  if (invoiceCents < 0) return { ok: false, error: 'An invoice cannot be negative.' };

  const flight = await db.adFlight.findFirst({ where: { id: flightId, organizationId } });
  if (!flight) return { ok: false, error: 'No such flight.' };
  if (flight.status === 'settled') return { ok: false, error: 'Already settled.' };

  return db.$transaction(async (tx) => {
    const estimated = await tx.spendEntry.aggregate({
      where: { flightId, certainty: 'estimated' },
      _sum: { cents: true },
    });
    const estimatedCents = estimated._sum.cents ?? 0;
    const adjustmentCents = invoiceCents - estimatedCents;

    await tx.spendEntry.updateMany({
      where: { flightId, certainty: 'estimated' },
      data: { certainty: 'exact' },
    });

    if (adjustmentCents !== 0) {
      await tx.spendEntry.create({
        data: {
          organizationId,
          channel: flight.channel,
          kind: 'ad',
          certainty: 'exact',
          cents: adjustmentCents,
          campaignId: flight.campaignId,
          flightId,
          providerRef: `flight:${flightId}:invoice`,
          note:
            adjustmentCents > 0
              ? 'Invoice adjustment — the platform billed more than its dashboard showed.'
              : 'Invoice adjustment — the platform billed less than its dashboard showed.',
        },
      });
    }

    await tx.adFlight.update({
      where: { id: flightId },
      data: { status: 'settled', settledAt: new Date(), settledCents: invoiceCents },
    });

    return { ok: true, adjustmentCents };
  });
}

function label(channel: Channel): string {
  const LABELS: Partial<Record<Channel, string>> = {
    google_business: 'Google Ads',
    x: 'X',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
  };
  return LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}
