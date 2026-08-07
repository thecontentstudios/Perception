import type { Channel } from './types';
import {
  AD_RATES,
  EMAIL_RATES,
  FIXED_COSTS,
  SMS_RATES,
  type Certainty,
  type FixedCost,
  amount,
  money,
  range,
} from './pricing';
import { previewSms, type SmsPreview } from './sms';

/**
 * What a plan will cost, before you commit to it.
 *
 * The organising idea here is an inversion most advertising tools get
 * backwards.
 *
 * For **messaging** (email, SMS), the *cost* is uncertain-looking but is
 * actually exact — it is a list size times a rate, computable to the cent —
 * while the *result* is unknowable.
 *
 * For **ads**, it is the other way round. The cost is exactly what you told
 * the platform to spend: a $20/day budget for 14 days costs $280, full stop.
 * The auction does not affect it. What the auction affects is what you *get*
 * for it, and that is the estimate.
 *
 * So this file never produces a single blurry "estimated spend" number. It
 * produces an exact figure for money leaving the account and a range for what
 * that money buys, and it keeps them in separate fields so no downstream code
 * can accidentally add them together.
 */

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

export interface LineItem {
  id: string;
  label: string;
  /** The arithmetic, spelled out. "1,240 contacts × 2 segments × 1.1¢" */
  detail: string;
  cents: number;
  certainty: Certainty;
  kind: 'message' | 'fixed' | 'ad';
  channel: Channel;
  /** Set when this cost recurs rather than being a one-off for this send. */
  cadence?: 'once' | 'monthly';
}

export interface Blocker {
  id: string;
  label: string;
  fix: string;
}

/** What a spend buys, when nobody can say precisely. */
export interface OutcomeRange {
  metric: 'impressions' | 'clicks';
  low: number;
  high: number;
  basis: string;
}

export interface Projection {
  /** Money that will leave the account. Exact, and safe to sum. */
  exactCents: number;
  /** Costs whose amount genuinely cannot be pinned down. Usually empty. */
  estimatedLowCents: number;
  estimatedHighCents: number;
  items: LineItem[];
  /** What the exact spend is expected to produce. Never a single number. */
  outcomes: OutcomeRange[];
  /** Things that stop the send entirely. */
  blockers: Blocker[];
  notes: string[];
}

const empty = (): Projection => ({
  exactCents: 0,
  estimatedLowCents: 0,
  estimatedHighCents: 0,
  items: [],
  outcomes: [],
  blockers: [],
  notes: [],
});

function total(p: Projection): Projection {
  p.exactCents = p.items.filter((i) => i.certainty === 'exact').reduce((s, i) => s + i.cents, 0);
  return p;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface EmailPlan {
  provider: keyof typeof EMAIL_RATES | string;
  /** Contacts who will actually receive it — after consent and suppression. */
  recipients: number;
  /** Sends already made this calendar month, which eat the free allowance. */
  sentThisMonth: number;
  /** False when SPF/DKIM/DMARC are not verified for the sending domain. */
  domainVerified: boolean;
}

/**
 * Email cost, which is almost always smaller than the owner expects and
 * almost always has a free tier boundary hiding in it.
 *
 * The free allowance is the interesting part. A 3,000/month allowance means
 * the first campaign of the month is free and the third one is not, so the
 * same 1,000-contact send costs $0.00 or $0.10 depending on the date. Showing
 * "$0.10" on the first of the month is wrong; showing "free" on the twentieth
 * is worse. So the free allowance is consumed in order and the line item says
 * which part of the send fell outside it.
 */
export function projectEmail(plan: EmailPlan): Projection {
  const p = empty();
  const rate = EMAIL_RATES[plan.provider];
  if (!rate) {
    p.blockers.push({
      id: 'email.no-provider',
      label: 'No email provider connected.',
      fix: 'Connect a sending service on Connections before scheduling an email.',
    });
    return p;
  }

  if (!plan.domainVerified) {
    p.blockers.push({
      id: 'email.domain',
      label: 'Sending domain is not verified.',
      fix: 'Add the SPF, DKIM and DMARC records for your domain. Without them Gmail and Outlook reject bulk mail outright — the send would cost money and reach nobody.',
    });
  }

  const freeLeft = Math.max(0, rate.freeMonthly - plan.sentThisMonth);
  const freeUsed = Math.min(freeLeft, plan.recipients);
  const billable = plan.recipients - freeUsed;
  const cents = Math.round((billable * rate.per1000Cents) / 1000);

  p.items.push({
    id: 'email.send',
    label: `Email to ${plan.recipients.toLocaleString('en-US')} ${plan.recipients === 1 ? 'person' : 'people'}`,
    detail: freeUsed
      ? billable
        ? `${freeUsed.toLocaleString('en-US')} inside this month's free allowance, ${billable.toLocaleString('en-US')} billable at ${money(rate.per1000Cents)}/1,000`
        : `all ${freeUsed.toLocaleString('en-US')} inside this month's free allowance (${(freeLeft - freeUsed).toLocaleString('en-US')} left after this)`
      : `${billable.toLocaleString('en-US')} × ${money(rate.per1000Cents)}/1,000 — free allowance already used this month`,
    cents,
    certainty: 'exact',
    kind: 'message',
    channel: 'email',
  });

  if (freeLeft > 0 && plan.recipients > freeLeft) {
    p.notes.push(
      `This send crosses your ${rate.provider} free allowance. Sending ${freeLeft.toLocaleString('en-US')} today and the rest after the 1st would cost nothing — worth it only if the timing does not matter.`
    );
  }
  return total(p);
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export interface SmsPlan {
  body: string;
  recipients: number;
  country: keyof typeof SMS_RATES | string;
  /** Fixed costs already paid — 10DLC registration, number rental. */
  paidFixedCostIds: string[];
  /** Share of recipients who typically reply, for the inbound estimate. */
  expectedReplyRate?: number;
}

/**
 * SMS cost, which is almost always larger than the owner expects.
 *
 * Three multipliers stack here and only one of them is visible in a normal
 * composer: the list size (visible), the segment count (invisible — see
 * `sms.ts`), and the fixed registration costs (invisible, and the largest of
 * the three for a small list).
 *
 * A 400-contact promotional text feels like it should cost about four dollars.
 * With a curly apostrophe in it, an unpaid 10DLC registration, and a phone
 * number, month one is roughly $64. That gap is the entire reason this
 * function exists.
 */
export function projectSms(plan: SmsPlan): Projection {
  const p = empty();
  const rate = SMS_RATES[plan.country];
  if (!rate) {
    p.blockers.push({
      id: 'sms.no-rate',
      label: `No SMS rate configured for ${plan.country}.`,
      fix: 'Pick a destination country in Settings, or add a negotiated rate.',
    });
    return p;
  }

  const preview = previewSms(plan.body);
  const perRecipient = preview.segments * rate.perSegmentCents;
  const sendCents = Math.round(perRecipient * plan.recipients);

  p.items.push({
    id: 'sms.send',
    label: `Text to ${plan.recipients.toLocaleString('en-US')} ${plan.recipients === 1 ? 'person' : 'people'}`,
    detail: `${plan.recipients.toLocaleString('en-US')} × ${preview.segments} ${preview.segments === 1 ? 'segment' : 'segments'} × ${money(rate.perSegmentCents)} (${preview.encoding})`,
    cents: sendCents,
    certainty: 'exact',
    kind: 'message',
    channel: 'sms',
  });

  // The unpaid fixed costs, which dominate a small list.
  const paid = new Set(plan.paidFixedCostIds);
  for (const f of FIXED_COSTS.sms ?? []) {
    if (paid.has(f.id)) continue;
    p.items.push({
      id: f.id,
      label: f.label,
      detail: f.why,
      cents: f.cents,
      certainty: 'exact',
      kind: 'fixed',
      channel: 'sms',
      cadence: f.cadence === 'yearly' ? 'monthly' : f.cadence,
    });
    if (f.blocking) {
      p.blockers.push({
        id: f.id,
        label: `${f.label} is not set up.`,
        fix: f.why,
      });
    }
  }

  if (plan.expectedReplyRate && rate.perInboundCents > 0) {
    const replies = Math.round(plan.recipients * plan.expectedReplyRate);
    p.items.push({
      id: 'sms.inbound',
      label: `Replies (about ${replies.toLocaleString('en-US')})`,
      detail: `Inbound messages are billed too, at ${money(rate.perInboundCents)} each. A text that invites a reply is a text that costs more than it looks.`,
      cents: Math.round(replies * rate.perInboundCents),
      certainty: 'estimated',
      kind: 'message',
      channel: 'sms',
    });
    const est = Math.round(replies * rate.perInboundCents);
    p.estimatedLowCents += Math.round(est * 0.5);
    p.estimatedHighCents += Math.round(est * 2);
  }

  // The two facts that most change the number, said plainly.
  const fixedCents = p.items.filter((i) => i.kind === 'fixed').reduce((s, i) => s + i.cents, 0);
  if (fixedCents > sendCents && sendCents > 0) {
    p.notes.push(
      `Setup costs ${money(fixedCents)} and the messages cost ${money(sendCents)}. The fixed cost is the real price of starting; it does not repeat, and it stops mattering above about ${Math.ceil(fixedCents / Math.max(1, perRecipient)).toLocaleString('en-US')} recipients.`
    );
  }
  if (preview.encoding === 'UCS-2' && preview.culprits.length) {
    const c = preview.culprits[0];
    const fixable = preview.culprits.filter((x) => x.replacement !== null).length;
    p.notes.push(
      `${c.codePoint} (${c.name}) drops this message to 70 characters per segment instead of 160.` +
        (fixable ? ' Most of these have plain equivalents — swapping them may cut the cost.' : '')
    );
  }
  if (preview.optOutAdded) {
    p.notes.push('"Reply STOP to opt out." was added — required, and counted above.');
  }

  return total(p);
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

export interface AdPlan {
  channel: Channel;
  dailyBudgetCents: number;
  days: number;
}

/**
 * Ad cost, which is the one number in this file that is *not* in doubt.
 *
 * You set a daily budget; the platform spends it. The forecast people
 * actually want — "how many people will see this" — is the estimate, and it
 * is reported as a range because the honest answer is a range. A CPM of $7 and
 * a CPM of $25 are both normal for the same ad in different weeks, and a
 * product that says "12,400 impressions" is inventing four significant figures
 * it does not have.
 */
export function projectAds(plans: AdPlan[]): Projection {
  const p = empty();
  for (const plan of plans) {
    const rate = AD_RATES[plan.channel];
    if (!rate) {
      p.blockers.push({
        id: `ads.${plan.channel}`,
        label: `${plan.channel} does not sell ads through this product yet.`,
        fix: 'Pick a different channel, or run it organically.',
      });
      continue;
    }
    const spend = plan.dailyBudgetCents * plan.days;
    p.items.push({
      id: `ads.${plan.channel}`,
      label: `${labelFor(plan.channel)} ads`,
      detail: `${money(plan.dailyBudgetCents)}/day × ${plan.days} ${plan.days === 1 ? 'day' : 'days'}. You set this; the platform spends exactly it.`,
      cents: spend,
      certainty: 'exact',
      kind: 'ad',
      channel: plan.channel,
    });

    if (plan.dailyBudgetCents < rate.minDailyCents) {
      p.notes.push(
        `${labelFor(plan.channel)} needs roughly ${money(rate.minDailyCents)}/day to get out of the learning phase. Below that the spend still leaves your account, it just buys worse placements — the cheapest way to waste money here is to underfund it.`
      );
    }

    // The estimate lives on the outcome, never on the cost.
    if (rate.model === 'cpm') {
      p.outcomes.push({
        metric: 'impressions',
        low: Math.round((spend / rate.highCents) * 1000),
        high: Math.round((spend / rate.lowCents) * 1000),
        basis: `at ${range(rate)} per 1,000 impressions on ${labelFor(plan.channel)}`,
      });
    } else {
      p.outcomes.push({
        metric: 'clicks',
        low: Math.floor(spend / rate.highCents),
        high: Math.floor(spend / rate.lowCents),
        basis: `at ${range(rate)} per click on ${labelFor(plan.channel)}`,
      });
    }
  }
  return total(p);
}

function labelFor(channel: Channel): string {
  return channel
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------

/** Merge projections without ever merging exact money into estimated money. */
export function combine(...parts: Projection[]): Projection {
  const p = empty();
  for (const part of parts) {
    p.items.push(...part.items);
    p.outcomes.push(...part.outcomes);
    p.blockers.push(...part.blockers);
    p.notes.push(...part.notes);
    p.estimatedLowCents += part.estimatedLowCents;
    p.estimatedHighCents += part.estimatedHighCents;
  }
  return total(p);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetCheck {
  capCents: number;
  spentCents: number;
  projectedCents: number;
  /** Cap minus what is already spent, before this send. */
  headroomCents: number;
  wouldExceed: boolean;
  /** True when the send must be refused rather than merely flagged. */
  blocked: boolean;
  message: string;
}

/**
 * Whether a planned send fits in the month's budget.
 *
 * `hardStop` decides between a warning and a refusal, and the difference
 * matters more than it sounds: a budget that only warns is a budget that gets
 * exceeded, because the warning arrives at the moment someone is busy pressing
 * send. An owner who set a hard cap asked to be stopped, and being stopped is
 * the feature.
 */
export function checkBudget(args: {
  capCents: number;
  spentCents: number;
  projectedCents: number;
  hardStop: boolean;
}): BudgetCheck {
  const headroom = args.capCents - args.spentCents;
  const after = args.spentCents + args.projectedCents;
  const wouldExceed = after > args.capCents;
  const blocked = wouldExceed && args.hardStop;

  let message: string;
  if (!wouldExceed) {
    const pct = args.capCents > 0 ? Math.round((after / args.capCents) * 100) : 0;
    message = `${amount(after)} of ${amount(args.capCents)} this month (${pct}%). ${amount(args.capCents - after)} left after this send.`;
  } else if (blocked) {
    message = `Blocked. This send is ${amount(args.projectedCents)} and only ${amount(Math.max(0, headroom))} is left of the ${amount(args.capCents)} cap. Raise the cap or cut the audience.`;
  } else {
    message = `This send goes ${amount(after - args.capCents)} over the ${amount(args.capCents)} cap. Your cap is set to warn, not to stop, so it will go out.`;
  }
  return {
    capCents: args.capCents,
    spentCents: args.spentCents,
    projectedCents: args.projectedCents,
    headroomCents: headroom,
    wouldExceed,
    blocked,
    message,
  };
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface Forecast {
  spentCents: number;
  /** Committed but not yet charged — scheduled sends, running ad flights. */
  committedCents: number;
  /** Straight-line projection of the rest of the month from the run rate. */
  projectedMonthEndCents: number;
  dayOfMonth: number;
  daysInMonth: number;
  basis: string;
}

/**
 * Where the month ends up if nothing changes.
 *
 * Deliberately naive: spend-to-date, extended at the same daily rate, plus
 * what is already committed. A cleverer model would weight recent days or fit
 * a curve, and would be wrong in a way that is harder to argue with. The
 * arithmetic here is simple enough that an owner can check it, which is worth
 * more than accuracy on a number nobody can verify anyway.
 *
 * Early in the month it says so rather than extrapolating a $12 Tuesday into
 * a $372 forecast.
 */
export function forecastMonth(args: {
  spentCents: number;
  committedCents: number;
  now: Date;
}): Forecast {
  const day = args.now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(args.now.getUTCFullYear(), args.now.getUTCMonth() + 1, 0)).getUTCDate();

  if (day < 5) {
    return {
      spentCents: args.spentCents,
      committedCents: args.committedCents,
      projectedMonthEndCents: args.spentCents + args.committedCents,
      dayOfMonth: day,
      daysInMonth,
      basis:
        day === 1
          ? 'Day one — too early to project a run rate. Showing spend and commitments only.'
          : `Only ${day} days in. A run rate this early swings wildly, so this is spend plus what is already scheduled, not a forecast.`,
    };
  }

  const perDay = args.spentCents / day;
  const remaining = daysInMonth - day;
  return {
    spentCents: args.spentCents,
    committedCents: args.committedCents,
    projectedMonthEndCents: Math.round(args.spentCents + perDay * remaining + args.committedCents),
    dayOfMonth: day,
    daysInMonth,
    basis: `${amount(Math.round(perDay))}/day over ${day} days, carried across the remaining ${remaining}, plus ${amount(args.committedCents)} already scheduled.`,
  };
}

export type { SmsPreview };
