/**
 * The contract a sending service has to satisfy.
 *
 * This interface exists before any implementation of it does, and that is
 * deliberate. The bug it was written to close is an accounting one: the send
 * path used to write a delivery row, write a ledger entry, and return
 * `{ ok: true }`, all without anything leaving the building. There was no
 * moment in the code that meant "a provider has this now", so there was
 * nowhere correct to record a charge, so the charge was recorded at the only
 * moment available — request time — which is the one moment that guarantees
 * nothing has been sent.
 *
 * `SendResult.providerRef` is that missing moment. A cost is recorded when a
 * provider hands back its own id for a message, never before, and the id is
 * what makes recording it twice impossible.
 */

export type SendChannel = 'email' | 'sms';

export interface OutboundMessage {
  /** Our id for this delivery row, so a result can be matched back to it. */
  deliveryId: string;
  to: string;
  /** Email only. */
  subject?: string;
  body: string;
  /** What we priced this at when it was queued, for the ledger. */
  costCents: number;
  /** SMS only — segments, so a provider's count can be checked against ours. */
  segments?: number;
}

export interface SendResult {
  ok: boolean;
  /**
   * The provider's own id for the message. **Required on success**, because a
   * success without one cannot be billed idempotently and cannot be traced
   * back to the provider's records when the invoice is queried.
   */
  providerRef?: string;
  error?: string;
  /**
   * Whether trying again could work.
   *
   * A rate limit is retryable; a malformed address is not. Retrying the second
   * kind forever is how a queue turns into a bill for nothing.
   */
  retryable?: boolean;
  /**
   * The provider's own count of billable units, when it reports one.
   *
   * Kept separate from our estimate rather than replacing it, so the two can
   * be compared. If a provider says a message was three segments and `sms.ts`
   * said two, one of them is wrong and the discrepancy is worth surfacing
   * rather than silently adopting.
   */
  billedUnits?: number;
}

export interface Sender {
  channel: SendChannel;
  /** Shown to the owner: "Resend", "Amazon SES", "Twilio". */
  name: string;
  /**
   * Which rate card entry this maps to, so the price quoted before sending and
   * the price recorded after it come from the same row.
   */
  rateKey: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
