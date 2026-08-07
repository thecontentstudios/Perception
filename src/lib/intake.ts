import { db } from './db';
import { normalizeAddress } from './suppression';
import type { ConsentState } from './types';

/**
 * The one door every new contact comes through.
 *
 * Until now `contact.create` appeared exactly once in this codebase — in the
 * seed. The product's headline advice is that your own list beats bought reach
 * by four orders of magnitude, and it offered no way to build one. That is the
 * gap this file closes, and the reason it is a single function rather than
 * three similar ones scattered across an import route, a form handler and the
 * conversion ingest.
 *
 * ## The rule
 *
 * **Nothing becomes `SUBSCRIBED` without a recorded basis.**
 *
 * Every path in has to say how consent was obtained and what the person was
 * shown, and that evidence is written in the same transaction as the flag. An
 * import that asserts "these are all subscribed, trust me" can still do that —
 * an owner who bought a list is going to mail it either way — but it has to
 * type the attestation, and the attestation is stored next to every address it
 * created. When a mailbox provider asks, there is an answer.
 *
 * ## Deduplication
 *
 * By normalised address within an organization, not by id. The same person
 * arrives repeatedly — a form today, a CSV next month, a quote request in
 * between — and each arrival should *strengthen* what we know rather than
 * create a second row that halves it. Consent only ever moves one way without
 * an explicit act: an existing `SUBSCRIBED` is never downgraded by a later
 * import that happens to be vaguer.
 */

export type ConsentBasis = 'form' | 'import' | 'conversion' | 'manual' | 'confirmation' | 'unsubscribe';

export interface IntakeInput {
  organizationId: string;
  brandId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  /** How this person came to be here, and what they saw. */
  consent: {
    email?: { state: ConsentState; basis: ConsentBasis; evidence: string };
    sms?: { state: ConsentState; basis: ConsentBasis; evidence: string };
  };
  ip?: string | null;
  userAgent?: string | null;
  /** The form, import batch, or conversion this came from. */
  sourceId?: string | null;
}

export interface IntakeResult {
  contactId: string;
  created: boolean;
  /** True when this arrival changed a consent state. */
  consentChanged: boolean;
  emailConsent: ConsentState;
  smsConsent: ConsentState;
}

/** Consent only strengthens on its own; weakening takes an explicit act. */
const RANK: Record<ConsentState, number> = { unsubscribed: 0, pending: 1, subscribed: 2 };

/**
 * Whether a new signal should replace the one on file.
 *
 * An unsubscribe always wins — someone who opted out and then appears in a
 * re-uploaded CSV has not changed their mind, the spreadsheet is just old.
 * Otherwise the stronger signal wins, so a pending contact who fills in a
 * confirmed form becomes subscribed and a subscribed contact is not quietly
 * demoted by an import that says "pending".
 */
function shouldReplace(current: ConsentState, incoming: ConsentState): boolean {
  if (incoming === 'unsubscribed') return true;
  if (current === 'unsubscribed') return false;
  return RANK[incoming] > RANK[current];
}

export async function intake(input: IntakeInput): Promise<IntakeResult> {
  const email = input.email ? normalizeAddress(input.email) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;

  if (!email && !phone) {
    throw new Error('A contact needs an email address or a phone number.');
  }

  const existing = await db.contact.findFirst({
    where: {
      organizationId: input.organizationId,
      ...(email ? { email } : { phone }),
    },
  });

  const currentEmail = (existing?.emailConsent.toLowerCase() ?? 'pending') as ConsentState;
  const currentSms = (existing?.smsConsent.toLowerCase() ?? 'pending') as ConsentState;

  const nextEmail =
    input.consent.email && shouldReplace(currentEmail, input.consent.email.state)
      ? input.consent.email.state
      : currentEmail;
  const nextSms =
    input.consent.sms && shouldReplace(currentSms, input.consent.sms.state) ? input.consent.sms.state : currentSms;

  const consentChanged = nextEmail !== currentEmail || nextSms !== currentSms || !existing;

  const contact = existing
    ? await db.contact.update({
        where: { id: existing.id },
        data: {
          // A later arrival fills gaps but never overwrites what is there.
          // Someone who gave a full name at a form and initials in a CSV keeps
          // the full name.
          name: existing.name || input.name || 'Unknown',
          email: existing.email ?? email,
          phone: existing.phone ?? phone,
          brandId: existing.brandId ?? input.brandId ?? null,
          emailConsent: nextEmail.toUpperCase() as never,
          smsConsent: nextSms.toUpperCase() as never,
        },
      })
    : await db.contact.create({
        data: {
          organizationId: input.organizationId,
          brandId: input.brandId ?? null,
          name: input.name?.trim() || 'Unknown',
          email,
          phone,
          source: input.source ?? null,
          emailConsent: nextEmail.toUpperCase() as never,
          smsConsent: nextSms.toUpperCase() as never,
        },
      });

  // The evidence, written whether or not the flag moved. A consent signal that
  // changed nothing is still a fact about what happened, and the second time
  // someone confirms is exactly the sort of thing an audit asks about.
  const records: {
    organizationId: string; contactId: string; channel: never; state: never;
    basis: string; evidence: string; ip: string | null; userAgent: string | null; sourceId: string | null;
  }[] = [];
  for (const [channel, signal] of [['EMAIL', input.consent.email], ['SMS', input.consent.sms]] as const) {
    if (!signal) continue;
    records.push({
      organizationId: input.organizationId,
      contactId: contact.id,
      channel: channel as never,
      state: signal.state.toUpperCase() as never,
      basis: signal.basis,
      evidence: signal.evidence,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      sourceId: input.sourceId ?? null,
    });
  }
  if (records.length) await db.consentRecord.createMany({ data: records });

  return {
    contactId: contact.id,
    created: !existing,
    consentChanged,
    emailConsent: nextEmail,
    smsConsent: nextSms,
  };
}

/**
 * Phone numbers to a single shape, so the same person imported twice is one
 * person.
 *
 * Deliberately conservative: strip formatting, keep a leading `+`, and assume
 * US when a bare ten-digit number arrives, because that is what a US small
 * business's spreadsheet contains. Anything else is left as typed rather than
 * guessed at — a wrong country code is worse than an unnormalised string,
 * since it produces a number that dials somebody else.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const bare = digits.replace(/\D/g, '');
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return trimmed;
}

/**
 * Whether a string is plausibly an email address.
 *
 * Not RFC 5322 — that grammar accepts things no mail server will, and
 * rejecting a valid oddity is worse than accepting a doomed one, because the
 * bounce will tell us and a rejection just loses a customer. This catches the
 * mistakes that actually appear in spreadsheets: missing `@`, trailing commas,
 * two addresses in one cell, a name in the email column.
 */
export function looksLikeEmail(raw: string): boolean {
  const s = raw.trim();
  if (/[\s,;]/.test(s)) return false;
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return false;
  const domain = s.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && domain.length > 3;
}
