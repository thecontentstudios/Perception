import { db } from '../db';
import { recordCharge } from '../billing';
import { orgSenderFor, senderFor } from '../senders/registry';
import { renderEmail, renderSms, renderSubject } from '../senders/render';
import { isSuppressed } from '../suppression';
import { checkQuietHours, previewSms } from '../sms';
import { effectiveOffset } from '../timezone';
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
  /** Dropped because the address is on the suppression list. */
  suppressed: number;
  /** Left for later because it is the middle of the night where they are. */
  deferred: number;
  /** Messages where our segment count and the carrier's disagreed. */
  segmentMismatches: number;
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
export async function dispatch(
  channel: SendChannel,
  opts: {
    limit?: number;
    /**
     * The clock, injectable for tests. Quiet hours are a function of the
     * wall time, which made the deferral path testable only during US
     * night — a check that can only run when its author is asleep is a
     * check that mostly doesn't run. Production callers omit it.
     */
    now?: Date;
  } = {}
): Promise<DispatchResult> {
  const limit = opts.limit ?? 200;
  const table = channel === 'email' ? db.emailDelivery : db.smsDelivery;

  const queued = await (table as typeof db.emailDelivery).findMany({
    where: { status: 'QUEUED' },
    include: { contact: true, batch: true },
    orderBy: { id: 'asc' },
    take: limit,
  });

  const result: DispatchResult = {
    channel,
    considered: queued.length,
    sent: 0,
    failed: 0,
    suppressed: 0,
    deferred: 0,
    segmentMismatches: 0,
    held: 0,
    chargedCents: 0,
    note: null,
  };

  // Whether ANY sender exists is now a per-organization question: the owner
  // may have connected from Settings while the environment has nothing, or
  // vice versa. The env-level check keeps the fast "held" answer for the
  // common single-tenant nothing-configured case; a per-row resolve below
  // handles the rest.
  const anyRowOrg = queued[0]?.contact.organizationId;
  const probe = anyRowOrg ? await orgSenderFor(anyRowOrg, channel) : senderFor(channel);
  if (!probe) {
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

  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  for (const row of queued) {
    // Settings-connected credentials win over the environment, per org — a
    // multi-tenant deployment sends each tenant's mail with that tenant's
    // key, not with whatever the host's .env happens to hold.
    const sender = await orgSenderFor(row.contact.organizationId, channel);
    if (!sender) {
      result.held += 1;
      continue;
    }
    const to = channel === 'email' ? row.contact.email : row.contact.phone;
    if (!to) {
      await fail(channel, row.id, 'No address on the contact.');
      result.failed += 1;
      continue;
    }

    // Checked again here, not only when the audience was built.
    //
    // A campaign queued on Monday can dispatch on Tuesday, and an address that
    // bounced in between must not be mailed because the audience was computed
    // before the bounce arrived. The composer's check keeps the quote honest;
    // this one keeps the send safe, and it is the one that matters.
    if (await isSuppressed(row.contact.organizationId, channel, to)) {
      await (table as typeof db.emailDelivery).update({
        where: { id: row.id },
        data: { status: 'SUPPRESSED', failedAt: new Date(), failReason: 'Address is on the suppression list.' },
      });
      result.suppressed += 1;
      continue;
    }

    if (!row.batch) {
      await fail(channel, row.id, 'The message this belongs to is missing.');
      result.failed += 1;
      continue;
    }

    // Quiet hours, checked **here** rather than only in the composer.
    //
    // The composer checks the hour the owner picked, which is the right thing
    // to show them and the wrong thing to rely on: a campaign queued at 4pm
    // for "tomorrow morning" fires at whatever time the worker gets to it, and
    // a backlog that drains at 2am would text a thousand people at 2am.
    //
    // It is also per recipient. The window is the *recipient's*, so a list
    // spanning four time zones is legal for some of it and not for the rest at
    // any given moment — one check for the whole batch is the wrong shape.
    if (channel === 'sms') {
      const now = opts.now ?? new Date();
      const zone = effectiveOffset(to, now);
      const verdict = checkQuietHours(now, zone.offsetHours);
      if (!verdict.allowed) {
        // Left QUEUED, not failed. It becomes sendable on its own a few hours
        // from now, and failing it would make a legal safeguard look like a
        // delivery problem.
        result.deferred += 1;
        continue;
      }
    }

    const ctx = {
      businessName: row.batch.fromName ?? 'us',
      unsubscribeBase: appUrl,
      linkUrl: row.batch.linkUrl ?? undefined,
    };
    const recipient = { name: row.contact.name, email: to, deliveryId: row.id };

    // Both channels render merge fields; only SMS goes through `previewSms`,
    // which appends the opt-out line. That append has to happen here as well
    // as in the composer, because the composer's version is what set the
    // price — sending the shorter text would mean charging for segments we
    // did not use and omitting language carriers require.
    const emailRendered = channel === 'email' ? renderEmail(row.batch, recipient, ctx) : null;
    const smsBody = channel === 'sms' ? previewSms(renderSms(row.batch, recipient, ctx)).fullText : null;

    const message: OutboundMessage = {
      deliveryId: row.id,
      to,
      subject: renderSubject(row.batch.subject, recipient, ctx),
      body: emailRendered ? emailRendered.text : smsBody!,
      html: emailRendered?.html,
      unsubscribeUrl: emailRendered?.unsubscribeUrl,
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

    // What we counted, against what the carrier billed.
    //
    // `sms.ts` has computed segments since Phase 5 with nothing to check it
    // against. Twilio reports its own count, so a disagreement is finally
    // visible — and it is recorded on the row rather than silently adopted,
    // because if the two differ one of them is a bug and quietly taking the
    // provider's number would hide it.
    const ourUnits = 'segments' in row ? (row as { segments: number }).segments : 1;
    const billed = outcome.billedUnits;
    const mismatch = channel === 'sms' && billed !== undefined && billed !== ourUnits;

    if (mismatch) {
      await db.smsDelivery.update({
        where: { id: row.id },
        data: { failReason: `Segment count disagreed: we said ${ourUnits}, ${sender.name} billed ${billed}.` },
      });
      result.segmentMismatches += 1;
    }

    const charged = await recordCharge({
      organizationId: row.contact.organizationId,
      brandId: row.contact.brandId,
      channel,
      providerRef,
      cents: row.costCents,
      units: ourUnits,
      // The thread that makes per-campaign cost real: the batch knows its
      // campaign, so the charge does too. Null for a deliberate ad-hoc blast.
      campaignId: row.batch.campaignId,
      note: `${sender.name} · ${to}${mismatch ? ` (billed ${billed} segments)` : ''}`,
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
