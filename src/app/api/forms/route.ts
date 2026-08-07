import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Signup forms, from the owner's side.
 *
 * The public half lives at `/f/<slug>` and `/api/forms/<slug>`; this is the
 * half that needs a session.
 */

/** Short enough to read out over a phone, long enough not to be enumerated. */
function newSlug(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'signup';
  return `${stem}-${randomBytes(4).toString('hex')}`;
}

export async function GET() {
  return handle(async () => {
    const principal = await require_('read');
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }

    const forms = await db.signupForm.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    // How many people each form has actually produced, and how many of those
    // confirmed. A form with 200 sign-ups and 12 confirmations is broken —
    // usually the confirmation email is not arriving — and a bare sign-up
    // count would hide that completely.
    const counts = await db.consentRecord.groupBy({
      by: ['sourceId', 'state'],
      where: {
        organizationId: principal.organizationId,
        basis: { in: ['form', 'confirmation'] },
        sourceId: { in: forms.map((f) => f.id) },
      },
      _count: true,
    });

    const byForm = new Map<string, { signups: number; confirmed: number }>();
    for (const c of counts) {
      if (!c.sourceId) continue;
      const row = byForm.get(c.sourceId) ?? { signups: 0, confirmed: 0 };
      row.signups += c._count;
      if (c.state === 'SUBSCRIBED') row.confirmed += c._count;
      byForm.set(c.sourceId, row);
    }

    return NextResponse.json({
      ok: true,
      appUrl: process.env.APP_URL ?? 'http://localhost:3000',
      forms: forms.map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        headline: f.headline,
        blurb: f.blurb,
        consentText: f.consentText,
        askPhone: f.askPhone,
        smsConsentText: f.smsConsentText,
        doubleOptIn: f.doubleOptIn,
        createdAt: f.createdAt.toISOString(),
        ...(byForm.get(f.id) ?? { signups: 0, confirmed: 0 }),
      })),
    });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const principal = await require_('create_content');
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }

    let body: {
      name?: string; brandId?: string; headline?: string; blurb?: string;
      consentText?: string; askPhone?: boolean; smsConsentText?: string; doubleOptIn?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    const name = (body.name ?? '').trim();
    const consentText = (body.consentText ?? '').trim();
    if (!name) throw new HttpError(422, 'Give the form a name so you can tell it from the others.');

    // The sentence beside the checkbox is the evidence every consent record
    // from this form will carry. A form without one collects addresses whose
    // basis cannot be stated, which is the thing this whole phase refuses to
    // do.
    if (consentText.length < 10) {
      throw new HttpError(
        422,
        'Write the sentence people will agree to. It goes beside the checkbox and is stored with every address the form collects.'
      );
    }
    if (body.askPhone && !(body.smsConsentText ?? '').trim()) {
      throw new HttpError(
        422,
        'A form that asks for a phone number needs its own wording for texts. Agreeing to emails is not agreeing to be texted, and the difference is $500–$1,500 a message.'
      );
    }

    const form = await db.signupForm.create({
      data: {
        organizationId: principal.organizationId,
        brandId: body.brandId ?? null,
        name,
        slug: newSlug(name),
        headline: (body.headline ?? name).trim(),
        blurb: (body.blurb ?? '').trim() || null,
        consentText,
        askPhone: body.askPhone ?? false,
        smsConsentText: (body.smsConsentText ?? '').trim() || null,
        doubleOptIn: body.doubleOptIn ?? true,
      },
    });

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'form.created',
        target: form.id,
        detail: `${form.name} (${form.slug})${form.doubleOptIn ? '' : ' — single opt-in'}`,
      },
    });

    return NextResponse.json({ ok: true, form: { id: form.id, slug: form.slug, name: form.name } });
  });
}
