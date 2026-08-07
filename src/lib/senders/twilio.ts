import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OutboundMessage, SendResult, Sender } from './types';

/**
 * Sending text messages through Twilio.
 *
 * The second implementation of the `Sender` contract, and a noticeably
 * grumpier API than the first: form-encoded rather than JSON, Basic auth
 * rather than a bearer token, and a webhook signature scheme that is
 * HMAC-SHA1 over a string the caller has to reconstruct by hand.
 *
 * The interesting part is not the wire format. It is that **Twilio tells us
 * how many segments it actually billed**, and `sms.ts` has been computing that
 * number since Phase 5 with nobody to check it against. The adapter reports
 * both so the dispatcher can compare, because a segment counter that has never
 * been contradicted by a carrier is a segment counter nobody has tested.
 */

const DEFAULT_BASE = 'https://api.twilio.com';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The number or messaging service texts come from. */
  from: string;
  /** Where Twilio posts delivery receipts. */
  statusCallback?: string;
  /** Overridden in tests to point at a stand-in server. */
  baseUrl?: string;
}

/**
 * Which failures are worth trying again.
 *
 * Twilio's error codes are more informative than a status alone, and two of
 * them matter enough to name. 21610 is "this person replied STOP" — permanent,
 * and a signal we should already have acted on, so a retry would be both
 * useless and rude. 21614 is "not a mobile number", which no amount of waiting
 * fixes.
 */
function classify(status: number, code?: number): { retryable: boolean } {
  if (code === 21610 || code === 21614 || code === 21211) return { retryable: false };
  if (status === 429) return { retryable: true };
  if (status >= 500) return { retryable: true };
  return { retryable: false };
}

export function twilioSender(config: TwilioConfig): Sender {
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

  return {
    channel: 'sms',
    name: 'Twilio',
    rateKey: 'US',

    async send(message: OutboundMessage): Promise<SendResult> {
      const form = new URLSearchParams({
        To: message.to,
        From: config.from,
        Body: message.body,
      });
      if (config.statusCallback) form.set('StatusCallback', config.statusCallback);

      let res: Response;
      try {
        res = await fetch(`${base}/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
            // Twilio's idempotency header. Same purpose as Resend's: a crash
            // between the provider accepting a message and us recording its
            // reference must not deliver a second copy to somebody's phone,
            // where it is far more intrusive than a duplicate email.
            'i-twilio-idempotency-token': message.deliveryId,
          },
          body: form.toString(),
        });
      } catch (e) {
        return { ok: false, error: `Could not reach Twilio: ${(e as Error).message}`, retryable: true };
      }

      const text = await res.text();
      let payload: { sid?: string; message?: string; code?: number; num_segments?: string } = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        /* a non-JSON 2xx is not a success we can bill */
      }

      if (!res.ok) {
        return {
          ok: false,
          error: payload.message ?? `Twilio returned ${res.status}`,
          ...classify(res.status, payload.code),
        };
      }
      if (!payload.sid) {
        return { ok: false, error: 'Twilio accepted the message but returned no sid.', retryable: false };
      }

      return {
        ok: true,
        providerRef: payload.sid,
        // The number the carrier will actually bill. Kept separate from our
        // own count rather than replacing it, so the two can be compared.
        billedUnits: payload.num_segments ? Number(payload.num_segments) : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Twilio signs webhooks by HMAC-SHA1 over a string it builds itself.
 *
 * The string is the full request URL, then every POST parameter appended as
 * `key + value` **in lexicographic order by key**. That sorting requirement is
 * the part everyone gets wrong, and getting it wrong means either every
 * webhook is rejected or — much worse, if the check is skipped in frustration
 * — none of them are.
 *
 * Verifying matters here for the same reason it did for Resend, and more so:
 * the inbound endpoint changes consent. A forged `STOP` unsubscribes a
 * customer; a forged `START` re-subscribes somebody who opted out, which is
 * the direction that produces a complaint.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (!signature) return false;

  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');

  const expected = createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Sign the way Twilio would — for the stand-in server and for tests. */
export function signTwilioRequest(authToken: string, url: string, params: Record<string, string>): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');
}

// ---------------------------------------------------------------------------
// What a reply means
// ---------------------------------------------------------------------------

export type ReplyIntent = 'stop' | 'start' | 'help' | 'other';

/**
 * The reserved words carriers require every sender to honour.
 *
 * These are not a courtesy and not configurable: US carriers mandate them, and
 * a sender who ignores `STOP` is one complaint away from having their
 * registration revoked. Twilio handles the reserved keywords itself at the
 * carrier level, which is precisely why this exists — the message stops
 * arriving whether or not our database noticed, so a product that does not
 * watch for it will go on believing that person is reachable, quoting them in
 * every audience count and paying for messages that are dropped.
 *
 * Matching is deliberately loose on punctuation and case and strict on
 * everything else. "STOP" and "stop." are the same intent; "stop by the shop
 * tomorrow" is not, and treating it as one would unsubscribe a customer who
 * was trying to book.
 */
export function replyIntent(body: string): ReplyIntent {
  const word = body.trim().toLowerCase().replace(/[.!?,]+$/, '');
  if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out'].includes(word)) return 'stop';
  if (['start', 'yes', 'unstop', 'subscribe'].includes(word)) return 'start';
  if (['help', 'info'].includes(word)) return 'help';
  return 'other';
}
