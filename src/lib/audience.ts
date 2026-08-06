import type { Channel, Contact } from './types';

/**
 * How many people you can actually reach, and why it is fewer than you think.
 *
 * Every marketing tool shows a contact count. Almost none of them show the
 * *reachable* count, and the two are rarely close: a 1,240-contact list might
 * be 1,190 emailable and 312 textable, because phone numbers are collected far
 * less often than email addresses and SMS consent is collected less often
 * still.
 *
 * Getting this wrong is expensive in both directions. Quote the contact count
 * and the projected cost is four times the real one, so the owner cancels a
 * campaign they could have afforded. Quote it silently and the send goes out
 * to a third of the people they expected, and they conclude the product is
 * broken. Either way the number they needed was the reachable one, with the
 * shortfall explained.
 */

export interface Exclusion {
  reason: string;
  count: number;
  /** What the owner could do about it, when there is anything. */
  fix: string | null;
}

export interface Reach {
  channel: Channel;
  /** Everyone in scope before any filtering. */
  total: number;
  /** Who will actually receive it. */
  reachable: number;
  exclusions: Exclusion[];
  /** The reachable contacts themselves, for merge-field sizing. */
  contacts: Contact[];
}

/**
 * Consent is checked before anything else, and `PENDING` counts as *no*.
 *
 * This is the one place in the product where the default has to be the
 * restrictive one. A pending SMS consent means someone gave you a phone number
 * and never confirmed they want texts; sending anyway is a TCPA violation at
 * $500–$1,500 per message. The permissive reading of "pending" would be a
 * feature that quietly generates legal liability proportional to list size.
 */
export function reachFor(contacts: Contact[], channel: Channel): Reach {
  const exclusions: Exclusion[] = [];
  let pool = contacts;

  const noBrand = 0; // brand filtering happens upstream; kept explicit for clarity
  void noBrand;

  if (channel === 'email') {
    const missing = pool.filter((c) => !c.email.trim());
    const unsub = pool.filter((c) => c.email.trim() && c.emailConsent === 'unsubscribed');
    const pending = pool.filter((c) => c.email.trim() && c.emailConsent === 'pending');
    pool = pool.filter((c) => c.email.trim() && c.emailConsent === 'subscribed');

    if (missing.length)
      exclusions.push({
        reason: 'No email address',
        count: missing.length,
        fix: 'Import addresses, or collect them at checkout.',
      });
    if (unsub.length)
      exclusions.push({
        reason: 'Unsubscribed',
        count: unsub.length,
        fix: null,
      });
    if (pending.length)
      exclusions.push({
        reason: 'Consent not confirmed',
        count: pending.length,
        fix: 'Send a confirmation email once. Until they confirm, mailing them risks your sending reputation.',
      });
  } else if (channel === 'sms') {
    const missing = pool.filter((c) => !c.phone);
    const unsub = pool.filter((c) => c.phone && c.smsConsent === 'unsubscribed');
    const pending = pool.filter((c) => c.phone && c.smsConsent === 'pending');
    pool = pool.filter((c) => c.phone && c.smsConsent === 'subscribed');

    if (missing.length)
      exclusions.push({
        reason: 'No phone number',
        count: missing.length,
        fix: 'Ask for a mobile number at booking. This is usually the biggest gap on a first SMS campaign.',
      });
    if (unsub.length) exclusions.push({ reason: 'Replied STOP', count: unsub.length, fix: null });
    if (pending.length)
      exclusions.push({
        reason: 'No SMS consent on file',
        count: pending.length,
        fix: 'Texting these people is a TCPA violation at $500–$1,500 per message. Collect an explicit opt-in first — a checkbox that is not pre-ticked.',
      });
  }

  return { channel, total: contacts.length, reachable: pool.length, exclusions, contacts: pool };
}

/**
 * The names in a reachable audience, for sizing merge fields.
 *
 * Personalisation makes an SMS cost a *range* rather than a number, and the
 * range comes from the actual shortest and longest names on the list — not
 * from a placeholder. See `previewRange` in `sms.ts`.
 */
export function namesOf(reach: Reach): string[] {
  return reach.contacts.map((c) => c.name);
}

/**
 * A one-line summary that leads with the number the owner needs.
 *
 * Deliberately phrased as "312 of 1,240" rather than "312 contacts": the
 * shortfall is the surprising part, and burying it produces the support ticket
 * that starts "it only sent to a quarter of my list".
 */
export function reachSummary(reach: Reach): string {
  if (reach.reachable === reach.total) {
    return `All ${reach.total.toLocaleString('en-US')} can be reached.`;
  }
  const excluded = reach.total - reach.reachable;
  const biggest = [...reach.exclusions].sort((a, b) => b.count - a.count)[0];
  return `${reach.reachable.toLocaleString('en-US')} of ${reach.total.toLocaleString('en-US')} — ${excluded.toLocaleString('en-US')} excluded, mostly "${biggest?.reason.toLowerCase() ?? 'no consent'}".`;
}
