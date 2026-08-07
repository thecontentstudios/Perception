import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { verifyTwilioSignature } from '@/lib/senders/twilio';
import { normalizePhone } from '@/lib/intake';
import { suppress } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

/**
 * What happened to a text after the carrier took it.
 *
 * The SMS equivalent of the Resend webhook, and simpler in one way and harder
 * in another. Simpler: there are five statuses and they are ordered. Harder:
 * **a text has no bounce.** An undeliverable number comes back as `failed` or
 * `undelivered` with a numeric code, and only some of those codes mean the
 * number is finished — 30003 is a handset that is off, 30005 is a number that
 * does not exist, and treating them alike would either suppress people whose
 * phone was in a drawer or keep paying to text disconnected lines forever.
 */

/** Codes that mean this number will never work again. */
const PERMANENT = new Set([
  30003, // unreachable destination handset — carrier reports it as gone
  30005, // unknown or inactive number
  30006, // landline, or a number that cannot receive text
  21610, // recipient has opted out at the carrier
  21614, // not a mobile number
]);

/** Rank, so late news cannot walk a delivery backwards. */
const RANK: Record<string, number> = {
  QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4,
  BOUNCED: 5, COMPLAINED: 6, SUPPRESSED: 6, FAILED: 6,
};

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ ok: false, reason: 'Not configured.' }, { status: 503 });
  }

  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const url = process.env.TWILIO_STATUS_URL ?? new URL(req.url).toString();
  if (!verifyTwilioSignature(authToken, url, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ ok: false, reason: 'Bad signature.' }, { status: 401 });
  }

  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const status = (params.MessageStatus ?? params.SmsStatus ?? '').toLowerCase();
  if (!sid) return NextResponse.json({ ok: true, ignored: 'no sid' });

  const delivery = await db.smsDelivery.findFirst({ where: { providerRef: sid }, include: { contact: true } });
  if (!delivery) {
    // Acknowledged, not retried. An unknown sid is far more likely to be
    // another environment sharing a webhook URL than a lost row.
    return NextResponse.json({ ok: true, ignored: 'unknown message' });
  }

  const now = new Date();
  const code = Number(params.ErrorCode ?? 0);

  if (status === 'delivered') {
    if (RANK.DELIVERED > RANK[delivery.status]) {
      await db.smsDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED', deliveredAt: now } });
    }
    return NextResponse.json({ ok: true, applied: status });
  }

  if (status === 'failed' || status === 'undelivered') {
    const permanent = PERMANENT.has(code);
    await db.smsDelivery.update({
      where: { id: delivery.id },
      data: {
        status: permanent ? 'BOUNCED' : 'FAILED',
        failedAt: now,
        failReason: `Twilio ${status}${code ? ` (${code})` : ''}`,
      },
    });

    // Only the permanent kind suppresses. A handset that was switched off is
    // not a dead number, and suppressing on it would shrink a healthy list
    // every time somebody went camping.
    if (permanent && delivery.contact.phone) {
      await suppress({
        organizationId: delivery.contact.organizationId,
        channel: 'sms',
        address: normalizePhone(delivery.contact.phone),
        reason: code === 21610 ? 'unsubscribe' : 'bounce',
        detail: `Twilio ${status} (${code})`,
      });
      // 21610 is the carrier telling us this person opted out through a route
      // we did not see. It is a consent fact, not just a delivery one.
      if (code === 21610) {
        await db.contact.update({ where: { id: delivery.contactId }, data: { smsConsent: 'UNSUBSCRIBED' } });
        await db.consentRecord.create({
          data: {
            organizationId: delivery.contact.organizationId,
            contactId: delivery.contactId,
            channel: 'SMS',
            state: 'UNSUBSCRIBED',
            basis: 'unsubscribe',
            evidence: 'The carrier reported this number as opted out (Twilio 21610).',
          },
        });
      }
    }
    return NextResponse.json({ ok: true, applied: status, suppressed: permanent });
  }

  // sent / queued / accepted / sending — nothing to record beyond what the
  // dispatcher already wrote when the provider took the message.
  return NextResponse.json({ ok: true, ignored: status });
}
