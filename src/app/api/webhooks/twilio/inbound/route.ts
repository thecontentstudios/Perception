import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { replyIntent, verifyTwilioSignature } from '@/lib/senders/twilio';
import { normalizePhone } from '@/lib/intake';
import { suppress, unsuppress } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

/**
 * Somebody replying to a text.
 *
 * This endpoint is the reason SMS could not honestly ship before now. The
 * product records SMS consent and enforces it at send time, and **nothing
 * could change it** — a customer who replied STOP stayed marked subscribed
 * for ever, counted in every audience figure and included in the cost of every
 * future campaign.
 *
 * The carrier stops delivering after STOP whether or not our database
 * noticed, which makes the failure quiet in the worst way: messages keep being
 * sent, keep being billed, and keep not arriving, while the reachable count on
 * screen says everything is fine.
 *
 * STOP, START and HELP are not features. US carriers mandate them, and a
 * sender who ignores them loses their registration.
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ ok: false, reason: 'Inbound SMS is not configured.' }, { status: 503 });
  }

  // Twilio posts form-encoded, and its signature covers the exact parameters,
  // so they are read once and used for both.
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  // The URL Twilio signed is the one it was configured with, which behind a
  // proxy is not the URL we see. `TWILIO_WEBHOOK_URL` lets an operator state
  // it; without one we reconstruct, which is right in the common case.
  const url = process.env.TWILIO_INBOUND_URL ?? new URL(req.url).toString();

  if (!verifyTwilioSignature(authToken, url, params, req.headers.get('x-twilio-signature'))) {
    // Refusing matters here more than on most endpoints: a forged STOP
    // unsubscribes a customer, and a forged START re-subscribes somebody who
    // opted out — which is the direction that produces a complaint.
    return NextResponse.json({ ok: false, reason: 'Bad signature.' }, { status: 401 });
  }

  if (!(await dbAvailable())) {
    // 503 rather than 200: a 2xx tells Twilio to stop retrying, and a dropped
    // STOP is a customer we will text again.
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  const from = normalizePhone(params.From ?? '');
  const body = params.Body ?? '';
  if (!from) return twiml();

  const intent = replyIntent(body);

  // Matched by number across every organization the number appears in. One
  // person can be a customer of two businesses in the same workspace, and a
  // STOP means stop — resolving it to a single tenant would leave the other
  // one texting them.
  const contacts = await db.contact.findMany({ where: { phone: from } });

  if (contacts.length === 0) {
    // Nothing to update, and nothing worth saying. A reply from a number we
    // have never seen is usually a wrong number or a carrier test.
    return twiml();
  }

  for (const contact of contacts) {
    if (intent === 'stop') {
      await db.contact.update({ where: { id: contact.id }, data: { smsConsent: 'UNSUBSCRIBED' } });
      await suppress({
        organizationId: contact.organizationId,
        channel: 'sms',
        address: from,
        reason: 'unsubscribe',
        detail: `Replied "${body.trim().slice(0, 40)}"`,
      });
      await db.consentRecord.create({
        data: {
          organizationId: contact.organizationId,
          contactId: contact.id,
          channel: 'SMS',
          state: 'UNSUBSCRIBED',
          basis: 'unsubscribe',
          evidence: `Replied "${body.trim().slice(0, 60)}" to a text message.`,
        },
      });
    } else if (intent === 'start') {
      // Re-subscribing is the one direction that needs care: somebody texting
      // START is asking for messages again, and honouring it is correct — but
      // it goes back to PENDING rather than straight to SUBSCRIBED, because
      // the original consent was withdrawn and a single word does not restore
      // the evidence for it.
      await db.contact.update({ where: { id: contact.id }, data: { smsConsent: 'PENDING' } });
      await unsuppress(contact.organizationId, 'sms', from);
      await db.consentRecord.create({
        data: {
          organizationId: contact.organizationId,
          contactId: contact.id,
          channel: 'SMS',
          state: 'PENDING',
          basis: 'form',
          evidence: `Replied "${body.trim().slice(0, 60)}" after opting out. Held pending until they confirm again.`,
        },
      });
    }

    // Every reply lands in the inbox, whatever it said. A "yes please, Tuesday
    // works" is the reason the campaign was sent, and a product that swallows
    // replies because they were not keywords has thrown away the result.
    await db.conversation.create({
      data: {
        organizationId: contact.organizationId,
        brandId: contact.brandId,
        channel: 'SMS',
        kind: 'sms_reply',
        fromName: contact.name,
        fromAddress: from,
        externalRef: params.MessageSid ?? null,
        excerpt: body.trim().slice(0, 280),
        status: intent === 'other' ? 'open' : 'done',
        receivedAt: new Date(),
      },
    });
  }

  // HELP gets an answer; carriers require one and Twilio's default is generic.
  if (intent === 'help') {
    const org = await db.organization.findUnique({
      where: { id: contacts[0].organizationId },
      select: { name: true },
    });
    return twiml(`${org?.name ?? 'We'} sends occasional offers. Reply STOP to opt out. Message rates may apply.`);
  }

  return twiml();
}

/**
 * Twilio expects TwiML, and an empty document means "send no reply".
 *
 * Returning JSON here produces a warning in the customer's Twilio console on
 * every inbound message, which is the sort of thing that erodes trust in a
 * setup long before anybody works out it is harmless.
 */
function twiml(message?: string): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, { status: 200, headers: { 'content-type': 'text/xml' } });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}
