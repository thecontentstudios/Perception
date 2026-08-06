import type { Channel } from './types';

/**
 * What it costs to reach people.
 *
 * The reason this file exists as a model rather than a table of numbers is
 * that **the costs in an advertising suite are three different kinds of thing,
 * and showing them as one number lies about at least two of them.**
 *
 *   - **Per-message** costs are *exact*. An email send or an SMS segment has a
 *     price you can compute to the cent before you press the button, because
 *     it is arithmetic on a list size.
 *   - **Fixed** costs are exact too, and routinely forgotten. "SMS costs a
 *     cent a message" is a lie to a business that has to pay a $44 one-off
 *     10DLC brand registration and $10/month for a campaign before the first
 *     text goes anywhere. On a 400-contact list that fixed cost is *four
 *     times* the message cost.
 *   - **Auction** costs are *estimates*. Nobody, including the platform, can
 *     tell you what a click will cost tomorrow. A single number here is a
 *     guess wearing a decimal point.
 *
 * So every price carries its `certainty`, and the UI is required to render
 * them differently. A projection that mixes an exact $4.20 with a guessed
 * $300 and shows "$304.20" is the specific dishonesty this product exists to
 * avoid.
 *
 * Prices are USD cents, list rates as of early 2026, and **defaults you are
 * expected to override** with what you actually negotiated — every one of them
 * is configurable per organization for exactly that reason.
 */

export type Certainty = 'exact' | 'estimated';

export interface Money {
  cents: number;
  certainty: Certainty;
}

export interface MoneyRange {
  lowCents: number;
  highCents: number;
  certainty: 'estimated';
}

// ---------------------------------------------------------------------------
// Per-message: exact, computable before sending
// ---------------------------------------------------------------------------

export interface EmailRate {
  provider: string;
  /** Cost per 1,000 sends. */
  per1000Cents: number;
  /** Free allowance per month, where the provider offers one. */
  freeMonthly: number;
  note: string;
}

/**
 * Email is the cheapest channel by a wide margin, and the spread between
 * providers is large enough to matter at volume: SES and Postmark differ by
 * more than 10×. At 5,000 sends a month that is the difference between $0.50
 * and $6.25 — small in absolute terms, which is precisely why nobody checks.
 */
export const EMAIL_RATES: Record<string, EmailRate> = {
  ses: {
    provider: 'Amazon SES',
    per1000Cents: 10,
    freeMonthly: 3000,
    note: 'Cheapest at any volume. You manage your own reputation and bounce handling.',
  },
  postmark: {
    provider: 'Postmark',
    per1000Cents: 125,
    freeMonthly: 100,
    note: 'Costs more, delivers better. Worth it when the email is the product.',
  },
  sendgrid: {
    provider: 'SendGrid',
    per1000Cents: 90,
    freeMonthly: 3000,
    note: 'Middle ground; shared IPs mean your reputation is partly other people’s.',
  },
  resend: {
    provider: 'Resend',
    per1000Cents: 80,
    freeMonthly: 3000,
    note: 'Developer-friendly, modern deliverability defaults.',
  },
};

export interface SmsRate {
  country: string;
  /** Per outbound segment, carrier fees included. */
  perSegmentCents: number;
  /** Inbound replies, which a business pays for too. */
  perInboundCents: number;
  note: string;
}

/**
 * SMS is priced per *segment*, not per message — see `sms.ts`. The carrier
 * surcharge is bundled in here because quoting the carrier's rate alone
 * understates the real bill by roughly 40% in the US, and a surprise on the
 * invoice is exactly what this product is supposed to prevent.
 */
export const SMS_RATES: Record<string, SmsRate> = {
  US: { country: 'United States', perSegmentCents: 1.1, perInboundCents: 0.75, note: 'Includes A2P 10DLC carrier surcharge (~0.3¢/segment).' },
  CA: { country: 'Canada', perSegmentCents: 1.2, perInboundCents: 0.75, note: 'No 10DLC registration, but per-message rates run slightly higher.' },
  GB: { country: 'United Kingdom', perSegmentCents: 4.5, perInboundCents: 0, note: 'Inbound is free; alphanumeric sender IDs are allowed.' },
  AU: { country: 'Australia', perSegmentCents: 5.2, perInboundCents: 0, note: 'Higher per-message rates; no registration fee.' },
};

// ---------------------------------------------------------------------------
// Fixed: exact, and the ones people forget
// ---------------------------------------------------------------------------

export interface FixedCost {
  id: string;
  label: string;
  cents: number;
  cadence: 'once' | 'monthly' | 'yearly';
  /** True when nothing can be sent at all until this is paid. */
  blocking: boolean;
  why: string;
}

/**
 * The costs that do not scale with volume, and therefore dominate for a small
 * list. These are the ones that turn "texting is cheap" into a $60 first month
 * for a business with 300 customers.
 */
export const FIXED_COSTS: Partial<Record<Channel, FixedCost[]>> = {
  sms: [
    {
      id: 'sms.10dlc.brand',
      label: 'A2P 10DLC brand registration',
      cents: 4400,
      cadence: 'once',
      blocking: true,
      why: 'US carriers require every business sending texts to register. Without it your messages are filtered, not delivered — and you still pay for them.',
    },
    {
      id: 'sms.10dlc.campaign',
      label: 'A2P 10DLC campaign',
      cents: 1000,
      cadence: 'monthly',
      blocking: true,
      why: 'One per use case — a promotional campaign and an appointment-reminder campaign are separate registrations.',
    },
    {
      id: 'sms.number',
      label: 'Phone number',
      cents: 115,
      cadence: 'monthly',
      blocking: true,
      why: 'The number you send from. A toll-free number costs about the same and registers faster.',
    },
  ],
  email: [
    {
      id: 'email.domain',
      label: 'Sending domain setup',
      cents: 0,
      cadence: 'once',
      blocking: true,
      why: 'Free, but not optional: SPF, DKIM and DMARC records have to exist or Gmail and Outlook will reject bulk mail outright.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Auction: estimated, and honest about it
// ---------------------------------------------------------------------------

export interface AdRate {
  channel: Channel;
  model: 'cpm' | 'cpc';
  lowCents: number;
  highCents: number;
  /** Typical daily minimum to leave the learning phase. */
  minDailyCents: number;
  note: string;
}

/**
 * Ranges, never points.
 *
 * These are wide on purpose. A Facebook CPM genuinely varies 3× between a
 * plumber in a small town and a dentist in Manhattan in December, and quoting
 * the midpoint would produce a forecast that is confidently wrong for almost
 * everyone. The width *is* the information.
 */
export const AD_RATES: Partial<Record<Channel, AdRate>> = {
  facebook: { channel: 'facebook', model: 'cpm', lowCents: 700, highCents: 2500, minDailyCents: 500, note: 'Cheapest broad reach for local businesses; costs climb sharply in Q4.' },
  instagram: { channel: 'instagram', model: 'cpm', lowCents: 800, highCents: 3000, minDailyCents: 500, note: 'Same auction as Facebook; Reels placements usually clear cheaper.' },
  google_business: { channel: 'google_business', model: 'cpc', lowCents: 150, highCents: 900, minDailyCents: 1000, note: 'Search intent is the most expensive and most qualified click you can buy.' },
  linkedin: { channel: 'linkedin', model: 'cpc', lowCents: 500, highCents: 1500, minDailyCents: 1000, note: 'The most expensive click in the market. Only sensible when a customer is worth hundreds.' },
  tiktok: { channel: 'tiktok', model: 'cpm', lowCents: 400, highCents: 1200, minDailyCents: 2000, note: 'Cheap reach, higher daily minimum; creative burns out fast.' },
  youtube: { channel: 'youtube', model: 'cpm', lowCents: 500, highCents: 1800, minDailyCents: 1000, note: 'Skippable in-stream is priced per view, not per impression served.' },
  pinterest: { channel: 'pinterest', model: 'cpc', lowCents: 80, highCents: 500, minDailyCents: 500, note: 'Long content half-life — a pin keeps working after the spend stops.' },
  x: { channel: 'x', model: 'cpm', lowCents: 200, highCents: 900, minDailyCents: 500, note: 'Cheapest major-platform reach since 2023; check adjacency.' },
  reddit: { channel: 'reddit', model: 'cpm', lowCents: 300, highCents: 1000, minDailyCents: 500, note: 'Subreddit targeting; an ad that reads as an ad performs badly here.' },
  nextdoor: { channel: 'nextdoor', model: 'cpm', lowCents: 900, highCents: 2200, minDailyCents: 500, note: 'Neighbourhood targeting nobody else offers; expensive per impression, high intent.' },
  snapchat: { channel: 'snapchat', model: 'cpm', lowCents: 300, highCents: 1100, minDailyCents: 500, note: 'Under-25 reach; vertical video only.' },
};

// ---------------------------------------------------------------------------
// Formatting — the part that decides whether the honesty survives to the screen
// ---------------------------------------------------------------------------

/**
 * A price.
 *
 * Zero renders as "free", which is right when the number is what something
 * costs — "Send to 1,110 for free" is the sentence an owner wants. It is
 * wrong everywhere else: "only free is left of your cap" is what this
 * function produced the first time it was used for a *remaining* amount, and
 * it is not a sentence at all. Use `amount()` for quantities of money that
 * are not prices.
 */
export function money(cents: number): string {
  if (cents === 0) return 'free';
  return amount(cents);
}

/**
 * A quantity of money. Zero is zero, not "free".
 *
 * Sub-dollar values keep their decimals only when they have any: an SMS rate
 * of 1.1¢ must not round to 1¢ (it is a 10% error, compounded across every
 * message), and a whole cent must not render as "1.00¢", which reads as a
 * spreadsheet rather than a price.
 */
export function amount(cents: number): string {
  if (cents < 100) return `${Number.isInteger(cents) ? cents.toFixed(0) : cents.toFixed(2)}¢`;
  const dollars = cents / 100;
  return dollars < 100
    ? `$${dollars.toFixed(2)}`
    : `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/**
 * A range, rendered as a range.
 *
 * Never collapses to a midpoint. If the caller wants one number they have to
 * choose it themselves and own the choice — which is the point.
 */
export function range(r: { lowCents: number; highCents: number }): string {
  if (r.lowCents === r.highCents) return money(r.lowCents);
  return `${money(r.lowCents)}–${money(r.highCents)}`;
}
