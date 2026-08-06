import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { verifyResendSignature } from '@/lib/senders/resend';
import { suppress } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

/**
 * What happened to the mail after we handed it over.
 *
 * This endpoint is the only way the product learns that an address is dead,
 * that someone marked a campaign as spam, or that a message opened. Without
 * it, every delivery stays at `SENT` forever and the suppression list stays
 * empty — which means the reputation protection built in this phase would
 * exist and never trigger.
 *
 * **It is unauthenticated in the ordinary sense and must not be.** It mutates
 * the suppression list, so an unsigned caller could suppress an entire
 * customer audience: a denial of service on someone's marketing that, from
 * inside the product, would look exactly like a very bad list. Every request
 * is verified against the Svix signature before anything is read from it.
 */

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    /** Present on bounces. */
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // No secret means we cannot tell a real notification from a forged one.
  // Refusing is the only safe answer; accepting "because it is probably fine"
  // is how the suppression list becomes a weapon.
  if (!secret) {
    return NextResponse.json({ ok: false, reason: 'Webhooks are not configured.' }, { status: 503 });
  }

  // The raw body, before parsing. The signature covers the exact bytes sent,
  // so re-serialising a parsed object would produce a different string and
  // every legitimate webhook would fail verification.
  const raw = await req.text();

  const verdict = await verifyResendSignature(
    secret,
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    raw
  );
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  }

  if (!(await dbAvailable())) {
    // 503 rather than 200: a provider that gets a 2xx stops retrying, and a
    // bounce we drop because the database was briefly down is an address we
    // will mail again.
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return NextResponse.json({ ok: false, reason: 'Malformed payload.' }, { status: 400 });
  }

  const providerRef = event.data?.email_id;
  if (!providerRef) {
    // Acknowledged, not retried: without a message id there is nothing this
    // event could ever be applied to, so asking for it again is pointless.
    return NextResponse.json({ ok: true, ignored: 'no message id' });
  }

  const delivery = await db.emailDelivery.findFirst({
    where: { providerRef },
    include: { contact: true },
  });
  if (!delivery) {
    // Also acknowledged. A message id we have never seen is far more likely to
    // be another environment sharing a webhook endpoint than a lost row, and
    // retrying would not conjure it into existence.
    return NextResponse.json({ ok: true, ignored: 'unknown message' });
  }

  const now = new Date();
  const address = delivery.contact.email ?? '';

  switch (event.type) {
    case 'email.delivered':
      await advance(delivery.id, 'DELIVERED', { });
      break;

    case 'email.opened':
      // Opens only move the row forward, never back. Delivery news arrives out
      // of order often enough that an "opened" landing after a "clicked" would
      // otherwise undo the stronger signal.
      await advance(delivery.id, 'OPENED', { openedAt: delivery.openedAt ?? now });
      break;

    case 'email.clicked':
      await advance(delivery.id, 'CLICKED', { clickedAt: delivery.clickedAt ?? now });
      break;

    case 'email.bounced': {
      // Hard versus soft is the distinction that decides whether an address is
      // finished or merely unlucky. A full mailbox or a temporary outage is a
      // soft bounce: recording it and moving on is correct, and suppressing on
      // it would quietly shrink a healthy list every time a mail server had a
      // bad afternoon.
      const kind = (event.data?.bounce?.type ?? '').toLowerCase();
      const hard = kind === 'permanent' || kind === 'hard';
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'BOUNCED',
          bouncedAt: now,
          bounceKind: hard ? 'hard' : 'soft',
          failReason: event.data?.bounce?.message ?? null,
        },
      });
      if (hard && address) {
        await suppress({
          organizationId: delivery.contact.organizationId,
          channel: 'email',
          address,
          reason: 'bounce',
          detail: event.data?.bounce?.message ?? 'Permanent bounce',
        });
      }
      break;
    }

    case 'email.complained':
      // A spam complaint is always terminal. The recipient has told their
      // mailbox provider they did not want this, and mailing them again is
      // both rude and the fastest way to have every other campaign filtered.
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: 'COMPLAINED', bouncedAt: now, bounceKind: 'complaint' },
      });
      if (address) {
        await suppress({
          organizationId: delivery.contact.organizationId,
          channel: 'email',
          address,
          reason: 'complaint',
          detail: 'Marked as spam',
        });
      }
      break;

    default:
      return NextResponse.json({ ok: true, ignored: event.type });
  }

  return NextResponse.json({ ok: true, applied: event.type });
}

/** Rank of each status, so late news cannot walk a delivery backwards. */
const RANK: Record<string, number> = {
  QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4,
  BOUNCED: 5, COMPLAINED: 6, SUPPRESSED: 6, FAILED: 6,
};

async function advance(id: string, status: 'DELIVERED' | 'OPENED' | 'CLICKED', extra: Record<string, unknown>) {
  const row = await db.emailDelivery.findUnique({ where: { id }, select: { status: true } });
  if (!row) return;
  const data = { ...extra, ...(RANK[status] > RANK[row.status] ? { status } : {}) };
  await db.emailDelivery.update({ where: { id }, data: data as never });
}
