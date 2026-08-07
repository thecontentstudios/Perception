import type { Channel, ConnectedAccount, Contact } from './types';
import { AD_RATES, EMAIL_RATES, FIXED_COSTS, IMPRESSIONS_PER_PERSON, SMS_RATES, amount, money } from './pricing';
import { CHANNEL_META } from './channels';
import { reachFor } from './audience';
import { previewSms } from './sms';
import { FIT_LABEL, SURFACES, type Industry } from './surfaces';

/**
 * Every way to reach a customer, ranked honestly.
 *
 * The question a small business actually asks is not "which platform has the
 * best CPM". It is **"I want more customers this month — what should I do,
 * what will it cost, and when can it start?"** Nothing in this codebase
 * answered that, because the pieces that could (rates, reach, connections,
 * setup costs) lived in four different files and none of them knew about the
 * others.
 *
 * A route is one of those answers, made comparable: cost to start, time until
 * the first message can go out, how many people it reaches, and what is in the
 * way. Comparable is the hard part — an email send and a Facebook flight are
 * priced on completely different bases, and a table that puts "1.1¢ per
 * segment" next to "$7–25 CPM" has not compared anything.
 *
 * ## Three groups, because they buy three different things
 *
 * The first version of this file sorted every route into one list by cost per
 * person, and it was wrong in the exact way this codebase exists to prevent.
 * It ranked X ads second, ahead of texting your own customers, by comparing
 * 105,000 *impressions* against 308 *delivered texts* as though those were the
 * same unit. They are not remotely the same unit, and a single sorted list
 * silently asserted that they were.
 *
 * So routes are grouped by what the money actually buys:
 *
 *   - **`owned`** — a message delivered to someone who gave you their details.
 *     Exact count, high intent, nearly free, finite, does not grow by itself.
 *   - **`reach`** — impressions at auction (CPM). You are buying *views*, and
 *     views are not people: the same person sees the ad several times, so the
 *     people figure divides by frequency and stays a range.
 *   - **`intent`** — visits at auction (CPC). You pay only when someone acts,
 *     which makes each one worth far more and cost far more.
 *
 * Sorting happens **within** a group, never across one. A view, a visit and a
 * delivered message cannot be averaged, and a product that averages them has
 * told its customer something false in order to look tidy.
 *
 * The order inside `owned` is the one most marketing tools will not show you,
 * because the top of it is always the same: *the list you already own*. A
 * business with 1,100 subscribers reaches all of them for about ten cents. The
 * same money buys four Facebook impressions. Small businesses skip the list and
 * buy the ads anyway — it feels like doing marketing and emailing your own
 * customers does not.
 */

export type RouteId =
  | 'email'
  | 'sms'
  | `ads:${string}`
  | 'organic';

export type Readiness =
  /** Can be used right now. */
  | 'ready'
  /** Everything is in place except a step the owner can finish in minutes. */
  | 'almost'
  /** Needs money, paperwork, or a wait before it can be used at all. */
  | 'setup'
  /** Not available to this business — no audience, no account, no rate. */
  | 'unavailable';

export interface SetupStep {
  id: string;
  label: string;
  /** What it costs to complete, if anything. */
  cents: number;
  /** Realistic wait, in hours, once the owner starts. */
  waitHours: number;
  /** Where the owner goes to do it. */
  href: string;
  done: boolean;
  detail: string;
}

/**
 * What the money buys. Three groups that must never be averaged together.
 *
 * `owned` — a message delivered to someone on your list.
 * `reach`  — impressions at auction. Views, not people.
 * `intent` — visits at auction. You pay only when somebody acts.
 */
export type RouteGroup = 'owned' | 'reach' | 'intent';

export const GROUP_LABEL: Record<RouteGroup, string> = {
  owned: 'People who already know you',
  reach: 'Getting seen by strangers',
  intent: 'Buying visits from people already looking',
};

export const GROUP_BLURB: Record<RouteGroup, string> = {
  owned:
    'Your own list. Nearly free, the highest intent you will ever get, and finite — it only grows if something else feeds it.',
  reach:
    'You buy views, not people. The same person sees the ad several times, so the number of people is the views divided by how often each one sees it — which is why it stays a range.',
  intent:
    'You pay only when somebody clicks through. Each one costs far more than a view and is worth far more, and the two cannot be compared.',
};

export type OutcomeUnit = 'people' | 'views' | 'visits';

export const UNIT_LABEL: Record<OutcomeUnit, { one: string; many: string; verb: string }> = {
  // The verb matters. "$1 buys 91 people" is what the first draft said, and
  // you do not buy people — you reach them. You do buy a view and you do buy
  // a visit, which is precisely the distinction the groups exist to hold.
  people: { one: 'person', many: 'people', verb: 'reaches' },
  views: { one: 'view', many: 'views', verb: 'buys' },
  visits: { one: 'visit', many: 'visits', verb: 'buys' },
};

export interface Outcome {
  unit: OutcomeUnit;
  low: number;
  high: number;
  /** `exact` for a delivered message; `estimated` for anything at auction. */
  certainty: 'exact' | 'estimated';
}

export interface Route {
  id: RouteId;
  name: string;
  channel: Channel;
  /** One sentence: what this actually is, in the owner's words. */
  what: string;
  group: RouteGroup;
  readiness: Readiness;
  /** What the spend buys, in its own unit. Never converted to another's. */
  outcome: Outcome;
  /**
   * People reached, where the question has an answer.
   *
   * Set for `owned` (the delivered count) and for `reach` (views divided by
   * frequency). **Null for `intent`**, and that null is load-bearing: a search
   * ad's impressions are free and uncounted, so "how many people saw it" is a
   * number nobody has. Filling it with the click count would be inventing one.
   */
  peopleLow: number | null;
  peopleHigh: number | null;
  /** What one use of this route costs, once set up. */
  runCents: number;
  /** One-off and monthly costs still outstanding before the first send. */
  setupCents: number;
  /** Hours until the first message can go out, from a standing start. */
  timeToFirstSendHours: number;
  steps: SetupStep[];
  /** Cost per unit of `outcome`. Only ever compared inside one group. */
  costPerUnitCents: number;
  /**
   * How well this channel suits this kind of business — 3 essential to 0 skip.
   *
   * Ranking paid routes on price alone produced a list headed by whichever
   * platform happened to sell the cheapest impressions, which for a landscaper
   * meant Snapchat. Cheap views of the wrong people are not cheap; they are
   * wasted. Fit is applied *before* price and shown on the card, so the
   * reordering is something the owner can see and disagree with rather than a
   * silent thumb on the scale.
   */
  fit: 0 | 1 | 2 | 3;
  fitLabel: string;
  /** The honest caveat, or null when there genuinely is not one. */
  catch: string | null;
}

export interface RouteInput {
  contacts: Contact[];
  accounts: ConnectedAccount[];
  /**
   * The businesses this is for, which decide which paid channels are worth it.
   *
   * A list rather than one value, because the workspace view covers several at
   * once and they disagree. Taking the *best* fit across them — the obvious
   * first implementation — marked every channel "Essential", since almost any
   * channel is essential to somebody, and a column where every cell says the
   * same thing carries no information at all.
   */
  industries?: Industry[];
  /** A representative message, for segment-accurate SMS pricing. */
  sampleSms?: string;
  /** Monthly ad budget the owner is willing to consider. */
  adBudgetCents?: number;
  /** Email sends already made this month, which eat the free allowance. */
  emailSentThisMonth?: number;
}

const HOUR = 1;
const DAY = 24;

/**
 * Build every route for one business, priced and ranked.
 *
 * Deliberately pure and synchronous: this runs on every keystroke in the
 * planner, and a route list that needs a round trip is a route list that
 * arrives after the owner has already decided.
 */
export function routesFor(input: RouteInput): Route[] {
  const routes: Route[] = [
    emailRoute(input),
    smsRoute(input),
    ...adRoutes(input),
    organicRoute(input),
  ];
  return rank(routes);
}

/**
 * Cheapest first — but only against routes measured in the same unit.
 *
 * Unavailable routes sink regardless of price, because a route you cannot use
 * is not a bargain. Among the rest a lower cost-per-unit wins, and where those
 * are close the one that can start sooner does: a campaign that runs on
 * Tuesday beats a marginally cheaper one that runs in three weeks.
 */
function rank(routes: Route[]): Route[] {
  const order: Record<Readiness, number> = { ready: 0, almost: 1, setup: 2, unavailable: 3 };
  return [...routes].sort((a, b) => {
    if (order[a.readiness] !== order[b.readiness] && (a.readiness === 'unavailable' || b.readiness === 'unavailable')) {
      return order[a.readiness] - order[b.readiness];
    }
    // Fit before price. A channel that does not reach this kind of customer is
    // not a bargain at any CPM, and sorting on price alone put Snapchat above
    // Facebook for a landscaping business.
    if (a.fit !== b.fit) return b.fit - a.fit;
    const cost = a.costPerUnitCents - b.costPerUnitCents;
    if (Math.abs(cost) > 0.005) return cost;
    return a.timeToFirstSendHours - b.timeToFirstSendHours;
  });
}

/**
 * Fit for a channel across the businesses in view.
 *
 * The **mean**, not the maximum. Averaging says a channel essential to one of
 * four businesses and useless to the other three is a middling bet for the
 * workspace, which is true. Taking the maximum said it was essential, which
 * made every row identical and quietly recommended LinkedIn to a landscaper.
 *
 * Owned channels never come through here — your own customers are worth
 * reaching whatever business you are in.
 */
function fitFor(channel: Channel, industries: Industry[]): 0 | 1 | 2 | 3 {
  const surface = SURFACES.find((s) => s.channel === channel);
  if (!surface) return 1;
  const list = industries.length ? industries : (Object.keys(surface.fit) as Industry[]);
  const mean = list.reduce((n, i) => n + surface.fit[i], 0) / list.length;
  return Math.round(mean) as 0 | 1 | 2 | 3;
}

/** Routes for one group, already ranked. */
export function inGroup(routes: Route[], group: RouteGroup): Route[] {
  return routes.filter((r) => r.group === group);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function emailRoute(input: RouteInput): Route {
  const reach = reachFor(input.contacts, 'email');
  const account = input.accounts.find((a) => a.channel === 'email' && a.status === 'connected');
  const provider =
    Object.keys(EMAIL_RATES).find((k) => account?.displayName.toLowerCase().includes(k)) ?? 'resend';
  const rate = EMAIL_RATES[provider];

  const sent = input.emailSentThisMonth ?? 0;
  const freeLeft = Math.max(0, rate.freeMonthly - sent);
  const billable = Math.max(0, reach.reachable - freeLeft);
  const runCents = Math.round((billable * rate.per1000Cents) / 1000);

  const steps: SetupStep[] = [
    {
      id: 'email.provider',
      label: 'Connect a sending service',
      cents: 0,
      waitHours: 0.25,
      href: '/connections',
      done: Boolean(account),
      detail: 'Free to connect. Which one you pick changes the price by more than 10× at volume.',
    },
    {
      id: 'email.domain',
      label: 'Verify your sending domain',
      cents: 0,
      waitHours: 4,
      href: '/connections',
      done: Boolean(account),
      detail:
        'Three DNS records — SPF, DKIM, DMARC. Free, and not optional: without them Gmail and Outlook reject bulk mail outright, so the send costs money and reaches nobody.',
    },
  ];

  const outstanding = steps.filter((s) => !s.done);
  return finish({
    id: 'email',
    name: 'Email your list',
    channel: 'email',
    what: 'Send a message to the people who gave you their email address.',
    group: 'owned',
    fit: 3,
    readiness: reach.reachable === 0 ? 'unavailable' : outstanding.length === 0 ? 'ready' : 'almost',
    outcome: { unit: 'people', low: reach.reachable, high: reach.reachable, certainty: 'exact' },
    peopleLow: reach.reachable,
    peopleHigh: reach.reachable,
    runCents,
    setupCents: 0,
    timeToFirstSendHours: outstanding.reduce((h, s) => h + s.waitHours, 0),
    steps,
    catch:
      reach.reachable === 0
        ? 'Nobody on your list has confirmed they want email yet.'
        : freeLeft >= reach.reachable
          ? `Free this month — ${freeLeft.toLocaleString('en-US')} of your ${rate.provider} allowance is unused.`
          : null,
  });
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

function smsRoute(input: RouteInput): Route {
  const reach = reachFor(input.contacts, 'sms');
  const account = input.accounts.find((a) => a.channel === 'sms' && a.status === 'connected');
  const rate = SMS_RATES.US;
  const preview = previewSms(input.sampleSms ?? 'Three slots left this month. Book at our shop.');
  const runCents = Math.round(reach.reachable * preview.segments * rate.perSegmentCents);

  // The registration steps, with the waits that make SMS a fortnight-out
  // decision rather than an afternoon one. Quoting the per-message rate
  // without these is how a business plans a Friday promotion on a Tuesday.
  const fixed = FIXED_COSTS.sms ?? [];
  const steps: SetupStep[] = [
    {
      id: 'sms.number',
      label: 'Rent a sending number',
      cents: fixed.find((f) => f.id === 'sms.number')?.cents ?? 115,
      waitHours: 0.25,
      href: '/connections',
      done: Boolean(account),
      detail: 'Monthly. A toll-free number costs about the same and clears registration faster.',
    },
    {
      id: 'sms.10dlc.brand',
      label: 'Register your business with the carriers',
      cents: fixed.find((f) => f.id === 'sms.10dlc.brand')?.cents ?? 4400,
      waitHours: 1 * DAY,
      href: '/connections',
      done: Boolean(account),
      detail:
        'One-off, and unavoidable in the US. Unregistered messages are filtered rather than delivered — and you pay for them either way.',
    },
    {
      id: 'sms.10dlc.campaign',
      label: 'Register what you will use it for',
      cents: fixed.find((f) => f.id === 'sms.10dlc.campaign')?.cents ?? 1000,
      waitHours: 5 * DAY,
      href: '/connections',
      done: Boolean(account),
      detail:
        'Monthly, one per use case. Promotions and appointment reminders are separate registrations with separate approvals, and this is the step that takes two days to two weeks.',
    },
  ];

  const outstanding = steps.filter((s) => !s.done);
  const setupCents = outstanding.reduce((c, s) => c + s.cents, 0);

  return finish({
    id: 'sms',
    name: 'Text your list',
    channel: 'sms',
    what: 'Send a text to customers who explicitly agreed to receive them.',
    group: 'owned',
    fit: 3,
    readiness: reach.reachable === 0 ? 'unavailable' : outstanding.length === 0 ? 'ready' : 'setup',
    outcome: { unit: 'people', low: reach.reachable, high: reach.reachable, certainty: 'exact' },
    peopleLow: reach.reachable,
    peopleHigh: reach.reachable,
    runCents,
    setupCents,
    timeToFirstSendHours: outstanding.reduce((h, s) => h + s.waitHours, 0),
    steps,
    catch:
      reach.reachable === 0
        ? 'No contact has given explicit permission to be texted. A phone number on a booking form is not permission, and texting anyway is a TCPA violation at $500–$1,500 per message.'
        : setupCents > runCents
          ? `Setup is ${money(setupCents)} against ${money(runCents)} of messages. Texting is cheap per message and expensive to begin.`
          : 'Read at 98%, usually within minutes. Also the channel people resent most when it is overused.',
  });
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

function adRoutes(input: RouteInput): Route[] {
  const budget = input.adBudgetCents ?? 21_000; // $210 — two weeks at $15/day
  return (Object.keys(AD_RATES) as Channel[]).map((channel) => {
    const rate = AD_RATES[channel]!;
    const account = input.accounts.find((a) => a.channel === channel && a.status === 'connected');

    // What a fixed budget buys, in the unit the platform actually sells.
    //
    // CPM sells views. Converting those to people means dividing by how often
    // one person sees the ad — an assumption, so it stays a range, and a wide
    // one: the low people figure pairs the fewest views with the most
    // repetition, the high figure the reverse.
    const isCpm = rate.model === 'cpm';
    const outLow = isCpm ? Math.round((budget / rate.highCents) * 1000) : Math.floor(budget / rate.highCents);
    const outHigh = isCpm ? Math.round((budget / rate.lowCents) * 1000) : Math.floor(budget / rate.lowCents);
    const peopleLow = isCpm ? Math.round(outLow / IMPRESSIONS_PER_PERSON.high) : null;
    const peopleHigh = isCpm ? Math.round(outHigh / IMPRESSIONS_PER_PERSON.low) : null;

    const steps: SetupStep[] = [
      {
        id: `ads.${channel}.account`,
        label: `Connect ${label(channel)}`,
        cents: 0,
        waitHours: 0.25,
        href: '/connections',
        done: Boolean(account),
        detail: 'Free. You are authorising us to place ads on the account you already pay from.',
      },
      {
        id: `ads.${channel}.payment`,
        label: 'Add a payment method on the platform',
        cents: 0,
        waitHours: 0.25,
        href: '/connections',
        done: Boolean(account),
        detail: 'The platform bills you directly for ad spend. We never hold your ad budget.',
      },
    ];
    const outstanding = steps.filter((s) => !s.done);

    return finish({
      id: `ads:${channel}` as RouteId,
      name: `${label(channel)} ads`,
      channel,
      what: isCpm
        ? `Pay ${label(channel)} to put your message in front of people who have never heard of you.`
        : `Pay ${label(channel)} only when somebody searching clicks through to you.`,
      group: isCpm ? 'reach' : 'intent',
      fit: fitFor(channel, input.industries ?? []),
      readiness: outstanding.length === 0 ? 'ready' : 'almost',
      outcome: { unit: isCpm ? 'views' : 'visits', low: outLow, high: outHigh, certainty: 'estimated' },
      peopleLow,
      peopleHigh,
      runCents: budget,
      setupCents: 0,
      timeToFirstSendHours: outstanding.reduce((h, s) => h + s.waitHours, 0) + 1 * HOUR,
      steps,
      catch:
        budget / 14 < rate.minDailyCents
          ? `Needs about ${money(rate.minDailyCents)}/day to leave the learning phase. Below that the money still goes, it just buys worse placements.`
          : rate.note,
    });
  });
}

// ---------------------------------------------------------------------------
// Organic
// ---------------------------------------------------------------------------

function organicRoute(input: RouteInput): Route {
  const connected = input.accounts.filter(
    (a) => a.status === 'connected' && a.channel !== 'email' && a.channel !== 'sms'
  );
  return finish({
    id: 'organic',
    name: 'Post to your channels',
    channel: 'facebook',
    what: 'Publish to the accounts you already have, at no cost per post.',
    group: 'owned',
    fit: 2,
    readiness: connected.length === 0 ? 'almost' : 'ready',
    // Deliberately not a number. Organic reach is decided by an algorithm
    // nobody outside the platform can see, it has been falling for a decade,
    // and inventing a figure here would be the one dishonest cell in a file
    // built to avoid exactly that.
    outcome: { unit: 'people', low: 0, high: 0, certainty: 'estimated' },
    peopleLow: null,
    peopleHigh: null,
    runCents: 0,
    setupCents: 0,
    timeToFirstSendHours: connected.length === 0 ? 0.25 : 0,
    steps: [
      {
        id: 'organic.connect',
        label: 'Connect at least one channel',
        cents: 0,
        waitHours: 0.25,
        href: '/connections',
        done: connected.length > 0,
        detail: 'Free, and takes a couple of minutes per account.',
      },
    ],
    catch:
      'Free, and unpredictable. How many people see an unpaid post is decided by the platform, it has fallen every year for a decade, and nobody can quote you a number — including us.',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finish(r: Omit<Route, 'costPerUnitCents' | 'fitLabel'>): Route {
  const mid = (r.outcome.low + r.outcome.high) / 2;
  return {
    ...r,
    fitLabel: FIT_LABEL[r.fit],
    costPerUnitCents: mid > 0 ? r.runCents / mid : Infinity,
  };
}

function label(channel: Channel): string {
  return CHANNEL_META[channel]?.label ?? channel;
}

/** "in about 20 minutes" · "tomorrow" · "in about 2 weeks" */
export function humanWait(hours: number): string {
  if (hours <= 0) return 'now';
  if (hours < 1) return `in about ${Math.round(hours * 60)} minutes`;
  if (hours < 8) return `in about ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  if (hours < 36) return 'tomorrow';
  const days = Math.round(hours / 24);
  if (days < 14) return `in about ${days} days`;
  return `in about ${Math.round(days / 7)} weeks`;
}

const num = (n: number) => n.toLocaleString('en-US');

/**
 * What the spend buys, in the unit it was actually bought in.
 *
 * "$210 for 8,400–30,000 views" — never "for 8,400–30,000 people", which is
 * the sentence that made the first version of this file dishonest.
 */
export function outcomeSentence(r: Route): string {
  if (r.outcome.high === 0) return `${money(r.runCents)} \u2014 nobody can tell you how many people will see it`;
  const u = UNIT_LABEL[r.outcome.unit];
  const count = r.outcome.low === r.outcome.high ? num(r.outcome.low) : `${num(r.outcome.low)}\u2013${num(r.outcome.high)}`;
  const noun = r.outcome.low === 1 && r.outcome.high === 1 ? u.one : u.many;
  return `${money(r.runCents)} for ${count} ${noun}`;
}

/**
 * The people figure, kept separate from the outcome and omitted when unknown.
 *
 * Returning null rather than a number is the whole point for search ads: the
 * impressions behind a click are free and uncounted, so nobody knows how many
 * people saw it. A dash is the correct answer and a figure would be invented.
 */
export function peopleSentence(r: Route): string | null {
  if (r.peopleLow === null || r.peopleHigh === null || r.peopleHigh === 0) return null;
  if (r.outcome.unit === 'people') return null; // already said, would just repeat
  return `roughly ${num(r.peopleLow)}\u2013${num(r.peopleHigh)} actual people, at ${IMPRESSIONS_PER_PERSON.low}\u2013${IMPRESSIONS_PER_PERSON.high} views each`;
}

/**
 * The comparison that makes a ranking legible.
 *
 * Cost-per-unit is the right number to sort on and the wrong number to show:
 * "0.009\u00a2" means nothing to anybody. "$1 buys about 11,000 of these" is the
 * same fact in a form a business can act on. The unit is always named, because
 * $1 buying 300 views and $1 buying 300 delivered emails are not the same
 * sentence even though they read alike.
 */
export function perDollar(r: Route): string {
  if (r.runCents === 0) return 'free';
  if (!Number.isFinite(r.costPerUnitCents)) return 'no price per person';
  const u = UNIT_LABEL[r.outcome.unit];
  const per = 100 / r.costPerUnitCents;
  if (per >= 10) return `$1 ${u.verb} about ${num(Math.round(per))} ${u.many}`;
  if (per >= 1) return `$1 ${u.verb} about ${per.toFixed(1)} ${u.many}`;
  return `about ${amount(Math.round(r.costPerUnitCents))} per ${u.one}`;
}
