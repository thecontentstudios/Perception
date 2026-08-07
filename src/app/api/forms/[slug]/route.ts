import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { intake, looksLikeEmail, normalizePhone } from '@/lib/intake';
import { mintConfirmation, sendConfirmationEmail } from '@/lib/confirm';
import { isSuppressed } from '@/lib/suppression';
import { rateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Somebody signing up, from a form on the customer's own website.
 *
 * Public and unauthenticated by necessity — the person filling it in has no
 * account with us and never will. That makes it the widest surface in the
 * product, so it gets the same treatment as the other public endpoint
 * (`/api/events`): rate limited per address, tenant-scoped by a key in the
 * URL that authorises nothing except "add to this list", and it never reports
 * whether an address is already known.
 *
 * That last one matters more than it looks. A form that says "you're already
 * subscribed" is an oracle: point it at a list of addresses and it tells you
 * which of them are this business's customers. Every outcome here says the
 * same thing.
 */

const CORS = {
  // Embedded on the customer's own site, so the browser will preflight this.
  // Wide open is correct: the endpoint only ever *adds* an address to one
  // specific list, and the alternative is asking every small business to
  // configure origins they have never heard of.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Every response, whatever happened. */
function thanks(extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: true, message: 'Thanks — check your inbox to confirm.', ...extra },
    { headers: CORS }
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'Try again in a moment.' }, { status: 503, headers: CORS });
  }

  const ip = clientIp(req);
  // Sized to stop a script filling somebody's list with junk, not to stop a
  // family signing up from one house.
  const limit = await rateLimit(`form:${slug}:${ip}`, { max: 20, windowSec: 3600 });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: 'Too many sign-ups from here. Try again later.' },
      { status: 429, headers: { ...CORS, 'retry-after': String(limit.retryAfterSec) } }
    );
  }

  let body: { name?: string; email?: string; phone?: string; smsConsent?: boolean; hp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'Malformed request.' }, { status: 400, headers: CORS });
  }

  // A honeypot field, hidden in the rendered form. A human never fills it in
  // and most bots fill in everything. Cheaper than a CAPTCHA and it does not
  // punish the person signing up, which a CAPTCHA does.
  if (body.hp) return thanks();

  const form = await db.signupForm.findUnique({ where: { slug } });
  if (!form) return NextResponse.json({ ok: false, reason: 'Unknown form.' }, { status: 404, headers: CORS });

  const email = (body.email ?? '').trim();
  const phone = (body.phone ?? '').trim();
  if (!email || !looksLikeEmail(email)) {
    return NextResponse.json(
      { ok: false, reason: 'That email address does not look right.' },
      { status: 422, headers: CORS }
    );
  }

  // A previously bounced or complained address is accepted and discarded. Any
  // other answer would tell the caller something about our records, and there
  // is nothing useful to do with the address anyway.
  if (await isSuppressed(form.organizationId, 'email', email)) return thanks();

  const consentState = form.doubleOptIn ? 'pending' : 'subscribed';

  const result = await intake({
    organizationId: form.organizationId,
    brandId: form.brandId,
    name: body.name ?? null,
    email,
    phone: phone ? normalizePhone(phone) : null,
    source: `Signup form: ${form.name}`,
    consent: {
      // The sentence stored is the one on the form *right now*, copied rather
      // than referenced, so editing the wording later cannot rewrite what this
      // person was shown.
      email: {
        state: consentState,
        basis: 'form',
        evidence: form.doubleOptIn
          ? `Submitted "${form.name}" and agreed to: "${form.consentText}". Awaiting email confirmation.`
          : `Submitted "${form.name}" and agreed to: "${form.consentText}".`,
      },
      // Ticking a box on a web form is not consent to be texted under the
      // TCPA unless the box says so explicitly, which is why the form has to
      // carry its own SMS wording before this is ever anything but pending.
      ...(phone && body.smsConsent && form.smsConsentText
        ? {
            sms: {
              state: 'pending' as const,
              basis: 'form' as const,
              evidence: `Ticked the SMS box on "${form.name}": "${form.smsConsentText}". Awaiting confirmation.`,
            },
          }
        : phone
          ? {
              sms: {
                state: 'pending' as const,
                basis: 'form' as const,
                evidence: 'Gave a phone number on a signup form without agreeing to texts.',
              },
            }
          : {}),
    },
    ip,
    userAgent: req.headers.get('user-agent'),
    sourceId: form.id,
  });

  if (form.doubleOptIn) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const link = await mintConfirmation(result.contactId, 'email', appUrl);
    const org = await db.organization.findUnique({ where: { id: form.organizationId }, select: { name: true } });
    const sent = await sendConfirmationEmail({
      to: email,
      name: body.name ?? '',
      businessName: org?.name ?? 'us',
      url: link.url,
    });
    // Reported for the owner's benefit, not the visitor's: if nothing can send
    // email, every sign-up silently piles up as pending and the list appears
    // not to be growing.
    return thanks({ confirmationSent: sent.ok, confirmationProblem: sent.ok ? undefined : sent.reason });
  }

  return thanks({ confirmationSent: false });
}
