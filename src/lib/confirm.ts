import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { senderFor } from './senders/registry';
import type { Channel } from './types';

/**
 * Confirming that somebody really did ask for this.
 *
 * `PENDING` is the honest default for an address that arrived without proof,
 * and `audience.ts` correctly counts it as *no*. That left a trap: pending was
 * a state nothing could leave. A form could collect a hundred addresses and
 * the reachable count would stay where it was, for ever, because the only
 * thing that promotes a pending contact is a confirmation the product never
 * sent.
 *
 * ## Why double opt-in is the default
 *
 * A single-opt-in list is bigger and delivers worse. It fills with typos —
 * `gmial.com`, a transposed digit — and with addresses whose owners never
 * asked, usually because somebody typed a friend's. Both bounce, and bounces
 * are the number mailbox providers score a sender on. So the list that looks
 * smaller reaches more people, which is the whole argument, and it is the sort
 * of argument that loses to a bigger number on a dashboard unless the product
 * takes a position.
 */

const TOKEN_BYTES = 32;
const TTL_HOURS = 72;

/** Hashed at rest, like a session token: a leaked table must not confer power. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ConfirmationLink {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Mint a single-use confirmation link.
 *
 * Any earlier unconfirmed token for the same contact and channel is dropped
 * first. Someone who fills in the form twice should not end up with two live
 * links, because the second email is the one they will click and the first
 * would otherwise stay valid in an inbox for three days.
 */
export async function mintConfirmation(
  contactId: string,
  channel: Channel,
  appUrl: string
): Promise<ConfirmationLink> {
  await db.confirmationToken.deleteMany({ where: { contactId, channel: channel.toUpperCase() as never, confirmedAt: null } });

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);

  await db.confirmationToken.create({
    data: { contactId, channel: channel.toUpperCase() as never, tokenHash: hash(token), expiresAt },
  });

  return { token, url: `${appUrl.replace(/\/+$/, '')}/c/${token}`, expiresAt };
}

export type ConfirmOutcome =
  | { ok: true; contactId: string; channel: Channel; name: string; alreadyDone: boolean }
  | { ok: false; reason: 'unknown' | 'expired' };

/**
 * Redeem a confirmation link.
 *
 * Idempotent on purpose: mail clients pre-fetch links, people click twice, and
 * a browser reloads. The second visit must show the same reassuring page
 * rather than "that link has expired", which would read as a failure at the
 * exact moment the person was doing the thing we asked.
 */
export async function confirm(token: string): Promise<ConfirmOutcome> {
  const row = await db.confirmationToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { contact: true },
  });
  if (!row) return { ok: false, reason: 'unknown' };

  const channel = row.channel.toLowerCase() as Channel;

  if (row.confirmedAt) {
    return { ok: true, contactId: row.contactId, channel, name: row.contact.name, alreadyDone: true };
  }
  if (row.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  await db.$transaction([
    db.confirmationToken.update({ where: { id: row.id }, data: { confirmedAt: new Date() } }),
    db.contact.update({
      where: { id: row.contactId },
      data:
        channel === 'sms'
          ? { smsConsent: 'SUBSCRIBED' }
          : { emailConsent: 'SUBSCRIBED' },
    }),
    db.consentRecord.create({
      data: {
        organizationId: row.contact.organizationId,
        contactId: row.contactId,
        channel: row.channel,
        state: 'SUBSCRIBED',
        basis: 'confirmation',
        // The strongest evidence available: they were sent a link to an
        // address only they can read, and they used it.
        evidence: `Clicked a confirmation link sent to their own ${channel === 'sms' ? 'phone' : 'inbox'}.`,
      },
    }),
  ]);

  return { ok: true, contactId: row.contactId, channel, name: row.contact.name, alreadyDone: false };
}

/**
 * Send the confirmation email.
 *
 * Goes out through the same `Sender` the campaigns use, which means it is
 * subject to the same truth as everything else: with no provider configured it
 * cannot be sent, and the caller is told so rather than left believing a
 * pending contact is on its way to confirming.
 *
 * It is deliberately *not* queued as a `MessageBatch`. A confirmation is
 * transactional — one person, immediately, in response to something they just
 * did — and putting it behind the campaign queue would make somebody wait for
 * a batch window to finish signing up.
 */
export async function sendConfirmationEmail(args: {
  to: string;
  name: string;
  businessName: string;
  url: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sender = senderFor('email');
  if (!sender) {
    return {
      ok: false,
      reason: 'No email service is connected, so the confirmation could not be sent. They stay pending until it is.',
    };
  }

  const first = args.name.trim().split(/\s+/)[0] || 'there';
  const text =
    `Hi ${first},\n\n` +
    `Please confirm you want emails from ${args.businessName} by opening this link:\n\n${args.url}\n\n` +
    `If you did not ask for this, ignore it — nothing will be sent, and the link expires in three days.`;

  const result = await sender.send({
    deliveryId: `confirm:${Date.now()}:${Math.abs(hashCode(args.to))}`,
    to: args.to,
    subject: `Confirm your email for ${args.businessName}`,
    body: text,
    html: confirmationHtml(first, args.businessName, args.url),
    costCents: 0,
  });

  return result.ok ? { ok: true } : { ok: false, reason: result.error };
}

/** Stable per-address component of the idempotency key. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function confirmationHtml(first: string, business: string, url: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:28px">
    <p style="margin:0 0 16px;line-height:1.55">Hi ${esc(first)},</p>
    <p style="margin:0 0 20px;line-height:1.55">Please confirm you want emails from ${esc(business)}.</p>
    <p style="margin:0 0 20px">
      <a href="${url}" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Yes, confirm</a>
    </p>
    <p style="margin:0;font-size:12px;color:#767672;line-height:1.5">
      If you did not ask for this, ignore it — nothing will be sent, and the link expires in three days.
    </p>
  </div>
</body></html>`;
}
