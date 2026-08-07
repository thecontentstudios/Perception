import type { OutboundMessage, SendResult, Sender } from './types';

/**
 * Sending email through Resend.
 *
 * The first implementation of the `Sender` contract, and chosen first for a
 * reason that is not "cheapest": it has the smallest surface of any provider
 * in the rate card — one POST, bearer auth, a JSON body — so the first
 * provider integration in this codebase spends its complexity on the parts
 * that are genuinely hard (idempotency, error classification, suppression)
 * rather than on request signing.
 *
 * SES is 12× cheaper and `/spend` says so out loud, which makes it the obvious
 * second adapter. It is not this one because SigV4 signing would have doubled
 * the size of the first thing that touches the outside world, and a provider
 * integration that is hard to review is a provider integration that quietly
 * charges people.
 */

const DEFAULT_BASE = 'https://api.resend.com';

export interface ResendConfig {
  apiKey: string;
  /** "Summit Local <hello@summitlocal.co>" — must be on a verified domain. */
  from: string;
  /** Overridden in tests to point at a stand-in server. */
  baseUrl?: string;
}

/**
 * Which failures are worth trying again.
 *
 * This classification is the difference between a transient hiccup and a
 * queue that retries a malformed address every thirty seconds forever. The
 * rule is about *who* has to change something: if we would send the identical
 * request and it might work, retry; if the request itself is wrong, stop and
 * say so.
 */
function classify(status: number): { retryable: boolean } {
  if (status === 429) return { retryable: true }; // rate limited — later is fine
  if (status >= 500) return { retryable: true }; // their problem, not the payload's
  if (status === 408) return { retryable: true };
  return { retryable: false }; // 400/401/403/422 — the request needs fixing
}

export function resendSender(config: ResendConfig): Sender {
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');

  return {
    channel: 'email',
    name: 'Resend',
    rateKey: 'resend',

    async send(message: OutboundMessage): Promise<SendResult> {
      let res: Response;
      try {
        res = await fetch(`${base}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            // Our delivery id, sent as the idempotency key.
            //
            // This is what makes the worker's retry policy safe. A crash after
            // the provider accepted the message but before we recorded the
            // reference would otherwise send it twice — the recipient gets two
            // copies and we are charged for both. With the key, the second
            // attempt returns the original id and the ledger's unique index
            // turns it into `already-recorded`.
            'idempotency-key': message.deliveryId,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject ?? '',
            text: message.body,
            html: message.html,
            headers: {
              // Threads replies and lets a recipient's client group the
              // campaign; also what a support request quotes back at us.
              'X-Entity-Ref-ID': message.deliveryId,
              ...(message.unsubscribeUrl
                ? {
                    // One-click unsubscribe. Gmail and Yahoo require this on
                    // bulk mail as of 2024; without it, delivery degrades no
                    // matter how clean the list is.
                    'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
                    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                  }
                : {}),
            },
          }),
        });
      } catch (e) {
        // A network failure is always retryable: we do not know whether the
        // provider saw the request, and the idempotency key makes finding out
        // safe.
        return { ok: false, error: `Could not reach Resend: ${(e as Error).message}`, retryable: true };
      }

      const text = await res.text();
      let payload: { id?: string; message?: string; name?: string } = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        // A non-JSON body from a 2xx is not a success we can bill.
      }

      if (!res.ok) {
        return {
          ok: false,
          error: payload.message ?? `Resend returned ${res.status}`,
          ...classify(res.status),
        };
      }

      // A 2xx with no id is deliberately not treated as success. The
      // dispatcher would fail it anyway; saying so here makes the reason
      // specific rather than generic.
      if (!payload.id) {
        return { ok: false, error: 'Resend accepted the message but returned no id.', retryable: false };
      }

      return { ok: true, providerRef: payload.id };
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Resend signs webhooks with Svix.
 *
 * Verifying is not optional and not a formality. The bounce endpoint mutates
 * the suppression list, so an unauthenticated caller could suppress a
 * customer's entire audience — a denial-of-service on their marketing that
 * would look, from inside the product, exactly like a very bad list.
 *
 * The scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed by the
 * secret's base64 payload, compared in constant time against any of the
 * space-separated signatures in the header.
 */
export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export async function verifyResendSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
  opts: { toleranceSec?: number; now?: number } = {}
): Promise<{ ok: boolean; reason?: string }> {
  const { createHmac, timingSafeEqual } = await import('node:crypto');

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'Missing signature headers.' };
  }

  // Replay window. Without it a captured payload stays valid forever, and a
  // replayed bounce notification re-suppresses an address the owner has since
  // re-subscribed.
  const tolerance = opts.toleranceSec ?? 300;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const sent = Number(headers.timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'Malformed timestamp.' };
  if (Math.abs(now - sent) > tolerance) return { ok: false, reason: 'Timestamp outside the replay window.' };

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  // The header carries one or more `v1,<base64>` pairs; a rotating secret
  // means more than one can be valid at once.
  for (const part of headers.signature.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'No signature matched.' };
}

/** Sign a payload the way Resend would — used by the mock server and tests. */
export async function signResendWebhook(
  secret: string,
  id: string,
  timestampSec: number,
  rawBody: string
): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key).update(`${id}.${timestampSec}.${rawBody}`).digest('base64');
  return `v1,${mac}`;
}
