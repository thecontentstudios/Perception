import { db } from '../db';
import { recordCharge } from '../billing';
import { senderFor } from '../senders/registry';
import type { OutboundMessage, SendChannel } from '../senders/types';

/**
 * Take queued messages and actually send them.
 *
 * This is the process that was missing. `/api/send` accepted a request, wrote
 * delivery rows, and there the story ended — nothing ever picked those rows
 * up, so `QUEUED` was a terminal state that the product described as a
 * completed send.
 *
 * The dispatcher is written now, before any provider exists, because it owns
 * the moment a charge becomes real. Building the accounting against a stub and
 * dropping a provider in behind it is a much smaller change than bolting
 * accounting onto a provider integration later, and it means the rule — one
 * ledger row per confirmed message — is enforced by code that is already
 * under test.
 */

export interface DispatchResult {
  channel: SendChannel;
  /** Rows examined. */
  considered: number;
  sent: number;
  failed: number;
  /** Left alone because nothing can send them yet. */
  held: number;
  chargedCents: number;
  /** Why nothing happened, when nothing happened. */
  note: string | null;
}

/**
 * One pass over the queue for one channel.
 *
 * With no sender registered this **holds** rather than fails. A held message
 * is one an owner can still rescue by connecting a service; a failed one has
 * to be composed again. Failing a thousand messages because a setup step is
 * outstanding would turn a configuration gap into lost work.
 */
export async function dispatch(channel: SendChannel, opts: { limit?: number } = {}): Promise<DispatchResult> {
  const limit = opts.limit ?? 200;
  const sender = senderFor(channel);
  const table = channel === 'email' ? db.emailDelivery : db.smsDelivery;

  const queued = await (table as typeof db.emailDelivery).findMany({
    where: { status: 'QUEUED' },
    include: { contact: true },
    orderBy: { id: 'asc' },
    take: limit,
  });

  const result: DispatchResult = {
    channel,
    considered: queued.length,
    sent: 0,
    failed: 0,
    held: 0,
    chargedCents: 0,
    note: null,
  };

  if (!sender) {
    // The real total, not the page size. Reporting `queued.length` here said
    // "200 messages waiting" for a backlog of 2,220, because that is the
    // batch limit — a number about our own pagination presented as a fact
    // about the customer's queue.
    const total = await (table as typeof db.emailDelivery).count({ where: { status: 'QUEUED' } });
    result.held = total;
    result.note =
      total > 0
        ? `${total} ${channel} message${total === 1 ? '' : 's'} waiting: no sending service is connected, so none of them have been sent and none of them have been charged.`
        : null;
    return result;
  }

  for (const row of queued) {
    const to = channel === 'email' ? row.contact.email : row.contact.phone;
    if (!to) {
      await fail(channel, row.id, 'No address on the contact.');
      result.failed += 1;
      continue;
    }

    const message: OutboundMessage = {
      deliveryId: row.id,
      to,
      body: '', // Phase 8 renders the body; the accounting does not depend on it.
      costCents: row.costCents,
      segments: 'segments' in row ? (row as { segments: number }).segments : undefined,
    };

    let outcome;
    try {
      outcome = await sender.send(message);
    } catch (e) {
      outcome = { ok: false, error: (e as Error).message, retryable: true };
    }

    // A success without a provider reference is treated as a failure, and
    // that severity is deliberate: an unreferenced success cannot be billed
    // idempotently, cannot be traced when the invoice is queried, and would
    // reintroduce exactly the "charged for something we cannot point at"
    // problem this phase exists to remove.
    if (outcome.ok && !outcome.providerRef) {
      await fail(channel, row.id, 'Provider reported success without a message id.');
      result.failed += 1;
      continue;
    }

    if (!outcome.ok) {
      // A retryable failure stays QUEUED so the next pass picks it up; a
      // permanent one stops here rather than costing a retry every minute
      // forever.
      if (!outcome.retryable) {
        await fail(channel, row.id, outcome.error ?? 'Rejected by the sending service.');
        result.failed += 1;
      } else {
        result.held += 1;
      }
      continue;
    }

    const providerRef = outcome.providerRef!;

    // The row moves to SENT first. If the charge write then fails, the
    // message is still correctly marked sent and the charge can be replayed
    // from the providerRef; the reverse order would risk charging for a
    // message whose send never got recorded.
    await (table as typeof db.emailDelivery).update({
      where: { id: row.id },
      data: { status: 'SENT', providerRef, sentAt: new Date() },
    });

    const charged = await recordCharge({
      organizationId: row.contact.organizationId,
      brandId: row.contact.brandId,
      channel,
      providerRef,
      cents: row.costCents,
      units: 'segments' in row ? (row as { segments: number }).segments : 1,
      note: `${sender.name} · ${to}`,
    });

    result.sent += 1;
    if (charged === 'recorded') result.chargedCents += row.costCents;
  }

  return result;
}

async function fail(channel: SendChannel, id: string, reason: string): Promise<void> {
  const table = channel === 'email' ? db.emailDelivery : db.smsDelivery;
  await (table as typeof db.emailDelivery).update({
    where: { id },
    data: { status: 'FAILED', failedAt: new Date(), failReason: reason },
  });
}

/** Both channels, for the worker's periodic pass. */
export async function dispatchAll(opts: { limit?: number } = {}): Promise<DispatchResult[]> {
  return [await dispatch('email', opts), await dispatch('sms', opts)];
}
