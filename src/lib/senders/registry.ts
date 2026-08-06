import type { SendChannel, Sender } from './types';

/**
 * Which sending services are actually wired up.
 *
 * **Currently: none.** No Resend, SES, Postmark or Twilio client exists in
 * this repository, and this file says so rather than letting the absence be
 * discovered by a customer whose campaign never arrived.
 *
 * The registry is deliberately empty rather than absent. An empty registry is
 * a fact the rest of the system can read and act on: the send path checks it,
 * refuses to claim a message was sent, and refuses to charge for it. A missing
 * registry would have left the same code with nothing to check, which is the
 * state that produced a ledger full of imaginary spend.
 *
 * Phase 8 adds implementations. Nothing else has to change when it does —
 * that is the point of putting the seam here.
 */

const REGISTRY: Partial<Record<SendChannel, Sender>> = {
  // email: resendSender,
  // sms: twilioSender,
};

export function senderFor(channel: SendChannel): Sender | null {
  return REGISTRY[channel] ?? null;
}

/**
 * Test seam.
 *
 * The accounting this phase exists to fix — one ledger row per confirmed
 * message, never two, never zero — cannot be verified against a registry that
 * is empty. So tests install a stub that returns real-looking provider
 * references, and the machinery under test is the same machinery that will run
 * against Resend.
 *
 * Deliberately not exported through an index barrel: registering a sender is
 * something a test does on purpose, not something a caller stumbles into.
 */
export function __installSender(channel: SendChannel, sender: Sender | null): void {
  if (sender) REGISTRY[channel] = sender;
  else delete REGISTRY[channel];
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
        ? 'No email sending service is connected, so nothing will actually be delivered and nothing will be charged. Messages are held until one is.'
        : 'No text messaging service is connected, so nothing will actually be delivered and nothing will be charged. Messages are held until one is.',
  };
}
