import { db } from './db';
import type { Channel } from './types';

/**
 * The only place a message cost enters the ledger.
 *
 * Before this file, `/api/send` wrote `SpendEntry` rows the moment it accepted
 * a request — which is to say, before any provider had seen the message, and
 * in a codebase where no provider existed at all. Everything on the spend
 * screen was therefore money that had not moved: month-to-date, the run rate,
 * the forecast, the budget consumed, all derived from sends that never
 * happened.
 *
 * That failure ran in the direction that looks fine. A ledger that
 * under-reports is corrected by the first invoice; one that over-reports
 * against an invoice that will never arrive has nothing to contradict it.
 *
 * So the rule is now narrow enough to state in one line and enforce in one
 * function: **a message cost is recorded when a provider confirms the message,
 * keyed by the provider's own reference, and at no other time.**
 */

export interface Charge {
  organizationId: string;
  brandId?: string | null;
  channel: Channel;
  /** The provider's own id. Without it there is no charge to record. */
  providerRef: string;
  cents: number;
  /** Messages for email, segments for SMS. */
  units: number;
  campaignId?: string | null;
  note?: string;
}

export type ChargeOutcome = 'recorded' | 'already-recorded';

/**
 * Record what a confirmed message cost.
 *
 * Idempotent by construction rather than by checking first. A provider
 * webhook that fires twice, a worker that crashes between the send and the
 * write and retries, a manual replay of a failed batch — all three produce a
 * second call with the same `providerRef`, and all three must charge once.
 * Reading before writing would leave a race between the read and the write;
 * letting the unique index reject the duplicate does not.
 */
export async function recordCharge(charge: Charge): Promise<ChargeOutcome> {
  // `createMany` with `skipDuplicates` rather than a create wrapped in a
  // try/catch. Both are idempotent, but a duplicate here is an *expected*
  // control-flow path — a webhook fired twice, a batch replayed — and
  // expressing it as a caught exception logged it as a database error every
  // time the system behaved correctly. Alarms that fire on success are alarms
  // people learn to ignore.
  const { count } = await db.spendEntry.createMany({
    data: [
      {
        organizationId: charge.organizationId,
        brandId: charge.brandId ?? null,
        channel: charge.channel.toUpperCase() as never,
        kind: 'message',
        certainty: 'exact',
        cents: charge.cents,
        units: charge.units,
        campaignId: charge.campaignId ?? null,
        providerRef: charge.providerRef,
        note: charge.note,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1 ? 'recorded' : 'already-recorded';
}

// ---------------------------------------------------------------------------
// Splitting a total across messages without losing money
// ---------------------------------------------------------------------------

/**
 * Divide a total, in whole cents, across `n` messages so the parts sum to the
 * whole exactly.
 *
 * Moving cost onto individual delivery rows created a problem the old
 * one-row-per-send design never had: **a single message usually costs less
 * than a cent.** Email at 80¢ per thousand is 0.08¢ each. Rounding that to a
 * whole cent per row gives zero, so an 89¢ campaign to 1,110 people committed
 * nothing, charged nothing, and reported itself as free — which would have
 * been the original bug wearing a different hat.
 *
 * Rounding up is no better: it turns 89¢ into $11.10. Rounding to nearest
 * loses 9% on the SMS path, where 2.2¢ per message becomes 2¢.
 *
 * So the total is *allocated* rather than divided. Each row takes the
 * difference between two running floors, which distributes the remainder one
 * cent at a time across the first messages and guarantees the sum is the
 * total. It is the standard answer to splitting a bill, and the property that
 * matters is the one a customer would check: the parts add up to what they
 * were quoted.
 */
export function allocateCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor(((i + 1) * totalCents) / n) - Math.floor((i * totalCents) / n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the two numbers apart
// ---------------------------------------------------------------------------

export interface SpendSplit {
  /** Money that has actually moved — a provider confirmed these. */
  chargedCents: number;
  /**
   * Money promised but not moved: queued messages, priced, not yet sent.
   *
   * Kept apart from charged rather than added to it. Folding them together
   * would restate the original bug in a friendlier font — the owner would see
   * one number and have no way to tell which part of it is a fact.
   */
  committedCents: number;
  /** How many messages are sitting in that committed figure. */
  committedMessages: number;
}

/**
 * What has been spent and what is still only promised, for one month.
 *
 * Committed spend is computed from the delivery rows rather than stored,
 * because it is a fact about the queue and the queue already knows it. A
 * stored total would need to be decremented on every send and would drift the
 * first time a decrement was missed.
 */
export async function spendSplit(organizationId: string, monthStart: Date, monthEnd: Date): Promise<SpendSplit> {
  const [charged, emailQueued, smsQueued] = await Promise.all([
    db.spendEntry.aggregate({
      // Exact only. Estimated rows are ad spend read off a platform dashboard
      // mid-flight — a belief about money, not money. Counting them here would
      // report them as charged, which is the Phase 7 lie with a new costume.
      where: { organizationId, occurredAt: { gte: monthStart, lt: monthEnd }, certainty: 'exact' },
      _sum: { cents: true },
    }),
    db.emailDelivery.aggregate({
      where: { status: 'QUEUED', contact: { organizationId } },
      _sum: { costCents: true },
      _count: true,
    }),
    db.smsDelivery.aggregate({
      where: { status: 'QUEUED', contact: { organizationId } },
      _sum: { costCents: true },
      _count: true,
    }),
  ]);

  return {
    chargedCents: charged._sum.cents ?? 0,
    committedCents: (emailQueued._sum.costCents ?? 0) + (smsQueued._sum.costCents ?? 0),
    committedMessages: emailQueued._count + smsQueued._count,
  };
}
