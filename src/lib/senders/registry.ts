import type { SendChannel, Sender } from './types';
import { resendSender } from './resend';
import { twilioSender } from './twilio';

/**
 * Which sending services are actually wired up.
 *
 * Email goes through Resend when `RESEND_API_KEY` and `RESEND_FROM` are set;
 * SMS through Twilio when its three variables are. Anything unconfigured
 * returns `null`,
 * and `null` is a fact the rest of the system reads and acts on: the send path
 * holds its messages rather than claiming they went, and charges nothing.
 *
 * That the answer comes from configuration rather than from a hardcoded map is
 * the point of the seam. Whether a workspace can send is a deployment
 * question, and pretending otherwise is how a demo ships as a product.
 */

const OVERRIDES: Partial<Record<SendChannel, Sender | null>> = {};

/**
 * The sender for a channel, built from configuration.
 *
 * Registry-by-configuration rather than a hardcoded map: whether email can be
 * sent is a deployment fact, not a code fact, and the difference matters
 * because the whole system reads this answer. A workspace with no
 * `RESEND_API_KEY` gets `null`, the send path holds its messages, `/spend`
 * reports nothing charged, and every screen says why.
 */
export function senderFor(channel: SendChannel): Sender | null {
  if (channel in OVERRIDES) return OVERRIDES[channel] ?? null;

  if (channel === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    // Both, or neither. A key without a From address produces a 422 per
    // message, which would fail an entire campaign one row at a time rather
    // than declining to start.
    if (!apiKey || !from) return null;
    return resendSender({ apiKey, from, baseUrl: process.env.RESEND_BASE_URL });
  }

  if (channel === 'sms') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    // All three, or none. A partial configuration fails every message
    // individually rather than declining to start, which turns a setup
    // mistake into a queue of failures somebody has to unpick.
    if (!accountSid || !authToken || !from) return null;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return twilioSender({
      accountSid,
      authToken,
      from,
      statusCallback: `${appUrl.replace(/\/+$/, '')}/api/webhooks/twilio/status`,
      baseUrl: process.env.TWILIO_BASE_URL,
    });
  }

  return null;
}

/** What the owner should be told about their sending setup. */
export function sendingStatus(channel: SendChannel): { ready: boolean; provider: string | null; why: string } {
  const sender = senderFor(channel);
  if (sender) return { ready: true, provider: sender.name, why: `Sending through ${sender.name}.` };
  return {
    ready: false,
    provider: null,
    why:
      channel === 'email'
        ? 'No email sending service is connected, so nothing will actually be delivered and nothing will be charged. Messages are held until one is. Set RESEND_API_KEY and RESEND_FROM to start sending.'
        : 'No text messaging service is connected, so nothing will actually be delivered and nothing will be charged. Messages are held until one is. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM to start sending.',
  };
}

/**
 * Test seam.
 *
 * The accounting rule this system turns on — one ledger row per confirmed
 * message, never two, never zero — has to be verifiable without a live
 * provider account. Tests install a stub or point Resend at a stand-in
 * server; either way the machinery under test is the machinery that runs in
 * production.
 *
 * Deliberately not exported through an index barrel: installing a sender is
 * something a test does on purpose, not something a caller stumbles into.
 */
export function __installSender(channel: SendChannel, sender: Sender | null): void {
  // `null` means *force no sender*, not "go back to configuration". The
  // difference bit once already: with RESEND_API_KEY present in .env, passing
  // null fell through to the real adapter, and a test written to describe the
  // unconfigured world silently started describing the configured one.
  OVERRIDES[channel] = sender;
}

/** Drop every override and go back to what configuration says. */
export function __resetSenders(): void {
  for (const key of Object.keys(OVERRIDES) as SendChannel[]) delete OVERRIDES[key];
}
