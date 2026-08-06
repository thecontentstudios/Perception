import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { reachFor } from '@/lib/audience';
import { checkBudget, combine, projectEmail, projectSms, type Projection } from '@/lib/projection';
import { checkQuietHours, previewRange, previewSms } from '@/lib/sms';
import { EMAIL_RATES, SMS_RATES } from '@/lib/pricing';
import type { Contact } from '@/lib/types';
import { budgetScope, monthKey } from '../spend/route';

export const dynamic = 'force-dynamic';

/**
 * Send an email or SMS campaign — and, in the same code path, tell you what it
 * will cost first.
 *
 * The `dryRun` flag is the important part of this route's design. The quote
 * the composer shows and the amount written to the ledger are produced by the
 * *same function calls in the same order*, differing only in whether the last
 * step runs. A preview computed by a parallel implementation is a preview that
 * drifts, and the drift always surfaces as a customer saying "you told me
 * $4.20". Here that cannot happen: if the quote is wrong, the charge is wrong
 * in exactly the same way, and one bug fixes both.
 */

interface SendRequest {
  channel: 'email' | 'sms';
  body: string;
  subject?: string;
  /** Contacts to send to. Omit to use everyone reachable in the brand. */
  contactIds?: string[];
  brandId?: string;
  variationId?: string;
  dryRun?: boolean;
  /** Bypass a soft budget warning the user has now seen and accepted. */
  acknowledgeOverBudget?: boolean;
  /** ISO time to send at; omitted means now. */
  sendAt?: string;
}

/** Row → the domain shape `reachFor` expects. */
function toContact(r: {
  id: string; name: string; email: string | null; phone: string | null; brandId: string | null;
  emailConsent: string; smsConsent: string; source: string | null; createdAt: Date;
}): Contact {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? '',
    phone: r.phone,
    brandId: r.brandId ?? '',
    segmentIds: [],
    emailConsent: r.emailConsent.toLowerCase() as Contact['emailConsent'],
    smsConsent: r.smsConsent.toLowerCase() as Contact['smsConsent'],
    source: r.source ?? '',
    addedAt: r.createdAt.toISOString().slice(0, 10),
    lastActivity: r.createdAt.toISOString().slice(0, 10),
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    // A dry run reads; a real send spends money. They are not the same
    // permission, and a composer that shows costs to an analyst is fine.
    let body: SendRequest;
    try {
      body = (await req.json()) as SendRequest;
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }
    const principal = await require_(body.dryRun ? 'read' : 'publish');

    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    if (body.channel !== 'email' && body.channel !== 'sms') {
      throw new HttpError(400, 'Channel must be email or sms.');
    }
    const text = (body.body ?? '').trim();
    if (!text) throw new HttpError(400, 'There is no message to send.');
    if (body.channel === 'email' && !(body.subject ?? '').trim()) {
      throw new HttpError(400, 'An email needs a subject line.');
    }

    // Audience. Ids are filtered through the organization, so a borrowed id
    // from another tenant simply is not in the result — no 403 to probe.
    const contacts = (
      await db.contact.findMany({
        where: {
          organizationId: principal.organizationId,
          ...(body.contactIds?.length ? { id: { in: body.contactIds } } : {}),
          ...(body.brandId ? { brandId: body.brandId } : {}),
        },
      })
    ).map(toContact);

    const reach = reachFor(contacts, body.channel);

    const settings = await organizationSettings(principal.organizationId);
    const sentThisMonth = await emailSentThisMonth(principal.organizationId);

    let projection: Projection;
    let smsPreview: ReturnType<typeof previewSms> | null = null;

    if (body.channel === 'email') {
      projection = projectEmail({
        provider: settings.emailProvider,
        recipients: reach.reachable,
        sentThisMonth,
        domainVerified: settings.domainVerified,
      });
    } else {
      smsPreview = previewSms(text);
      projection = projectSms({
        body: text,
        recipients: reach.reachable,
        country: settings.smsCountry,
        paidFixedCostIds: settings.paidFixedCostIds,
        expectedReplyRate: 0.03,
      });
    }

    // Budget. Checked on a dry run too — the whole point is that the owner
    // learns they are near the cap while they can still do something about it.
    const month = monthKey(new Date());
    const [budget, spent] = await Promise.all([
      // A channel-specific cap wins over the blanket one, so both are read and
      // the specific one is preferred — not `orderBy`, which would pick by
      // alphabet and hand SMS's cap to an email send.
      db.budget
        .findMany({
          where: {
            organizationId: principal.organizationId,
            month,
            scope: { in: [budgetScope(null, body.channel), budgetScope(null, null)] },
          },
        })
        .then((rows) => rows.find((r) => r.scope === budgetScope(null, body.channel)) ?? rows[0] ?? null),
      db.spendEntry.aggregate({
        where: { organizationId: principal.organizationId, occurredAt: { gte: new Date(`${month}-01T00:00:00Z`) } },
        _sum: { cents: true },
      }),
    ]);

    const budgetCheck = budget
      ? checkBudget({
          capCents: budget.capCents,
          spentCents: spent._sum.cents ?? 0,
          projectedCents: projection.exactCents,
          hardStop: budget.hardStop,
        })
      : null;

    // Quiet hours, for SMS only, and only for an immediate send. A scheduled
    // send is checked again by the worker at the moment it fires — the answer
    // depends on the clock, so checking it now and trusting it later would be
    // checking the wrong time.
    const sendAt = body.sendAt ? new Date(body.sendAt) : new Date();
    const quiet =
      body.channel === 'sms' ? checkQuietHours(sendAt, settings.utcOffsetHours) : null;

    const nameRange =
      body.channel === 'sms'
        ? previewRange(text, { names: reach.contacts.map((c) => c.name), business: settings.businessName })
        : null;

    const quote = {
      ok: true,
      dryRun: body.dryRun === true,
      reach: {
        total: reach.total,
        reachable: reach.reachable,
        exclusions: reach.exclusions,
      },
      projection,
      budget: budgetCheck,
      sms: smsPreview
        ? {
            encoding: smsPreview.encoding,
            segments: smsPreview.segments,
            units: smsPreview.units,
            perSegment: smsPreview.perSegment,
            remainingInSegment: smsPreview.remainingInSegment,
            culprits: smsPreview.culprits,
            optOutAdded: smsPreview.optOutAdded,
            fullText: smsPreview.fullText,
            varies: nameRange?.varies ?? false,
            minSegments: nameRange?.min.segments ?? smsPreview.segments,
            maxSegments: nameRange?.max.segments ?? smsPreview.segments,
          }
        : null,
      quietHours: quiet,
    };

    if (body.dryRun) return NextResponse.json(quote);

    // ----- past this line, money moves -----

    if (reach.reachable === 0) {
      throw new HttpError(422, 'Nobody on this list can receive it. Check consent and contact details.');
    }
    const blocking = projection.blockers;
    if (blocking.length) {
      return NextResponse.json({ ...quote, ok: false, reason: blocking[0].label, blockers: blocking }, { status: 422 });
    }
    if (quiet && !quiet.allowed) {
      return NextResponse.json(
        { ...quote, ok: false, reason: quiet.reason, nextOpening: quiet.nextOpening?.toISOString() ?? null },
        { status: 422 }
      );
    }
    if (budgetCheck?.blocked) {
      return NextResponse.json({ ...quote, ok: false, reason: budgetCheck.message }, { status: 402 });
    }
    if (budgetCheck?.wouldExceed && !body.acknowledgeOverBudget) {
      return NextResponse.json(
        { ...quote, ok: false, reason: budgetCheck.message, needsAcknowledgement: true },
        { status: 409 }
      );
    }

    const variationId = body.variationId ?? `adhoc:${Date.now()}`;
    const rate = body.channel === 'sms' ? SMS_RATES[settings.smsCountry] : null;

    // Deliveries and the ledger entry in one transaction. Splitting them lets
    // a crash between the two produce sent messages with no record of what
    // they cost, which is the one inconsistency this whole subsystem exists to
    // prevent.
    const written = await db.$transaction(async (tx) => {
      if (body.channel === 'sms' && smsPreview && rate) {
        const perRecipient = Math.round(smsPreview.segments * rate.perSegmentCents);
        await tx.smsDelivery.createMany({
          data: reach.contacts.map((c) => ({
            variationId,
            contactId: c.id,
            segments: smsPreview!.segments,
            encoding: smsPreview!.encoding,
            costCents: perRecipient,
            status: 'QUEUED' as const,
          })),
        });
      } else {
        await tx.emailDelivery.createMany({
          data: reach.contacts.map((c) => ({ variationId, contactId: c.id, status: 'QUEUED' as const })),
        });
      }

      // One ledger row per cost shape, not one big number — so the /spend
      // breakdown can answer "why" without re-deriving anything.
      //
      // Zero-cost *message* rows are written too, and that is not an
      // oversight. A send inside a provider's free allowance costs nothing but
      // consumes allowance, and the allowance is tracked by summing `units` on
      // these rows. Skipping them because the money was zero meant the free
      // tier never depleted: every send in the month looked like the first
      // one, and the twentieth campaign was quoted at $0.00 and billed.
      // A zero-cost *fixed* row carries no such meaning, so it is skipped.
      for (const item of projection.items) {
        if (item.cents === 0 && item.kind !== 'message') continue;
        await tx.spendEntry.create({
          data: {
            organizationId: principal.organizationId,
            brandId: body.brandId ?? null,
            channel: body.channel.toUpperCase() as never,
            kind: item.kind,
            certainty: item.certainty,
            cents: item.cents,
            units: item.kind === 'message' ? reach.reachable : 1,
            note: `${item.label} — ${item.detail}`,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: principal.organizationId,
          actorUserId: principal.userId,
          action: `${body.channel}.sent`,
          target: variationId,
          detail: `${reach.reachable} recipients, ${projection.exactCents}¢`,
        },
      });
      return reach.reachable;
    });

    return NextResponse.json({ ...quote, dryRun: false, queued: written, variationId });
  });
}

// ---------------------------------------------------------------------------
// Settings the projection needs
// ---------------------------------------------------------------------------

/**
 * Sending settings, with defaults that are deliberately pessimistic.
 *
 * `domainVerified: false` and an empty `paidFixedCostIds` mean a brand-new
 * workspace sees every setup cost and every blocker on its first quote. That
 * is the correct first impression: those costs are real and they are about to
 * be charged. A default that assumed everything was already paid would show a
 * $4 quote for a $64 first month.
 */
async function organizationSettings(organizationId: string): Promise<{
  emailProvider: string;
  smsCountry: string;
  domainVerified: boolean;
  paidFixedCostIds: string[];
  utcOffsetHours: number;
  businessName: string;
}> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const accounts = await db.connectedAccount.findMany({
    where: { organizationId, channel: { in: ['EMAIL', 'SMS'] }, status: 'CONNECTED' },
    select: { channel: true, displayName: true },
  });

  const emailAccount = accounts.find((a) => a.channel === 'EMAIL');
  const provider =
    Object.keys(EMAIL_RATES).find((k) => emailAccount?.displayName.toLowerCase().includes(k)) ??
    (emailAccount ? 'resend' : '');

  // A connected SMS account means the number is rented and, in the US, that
  // 10DLC registration cleared — you cannot get one without the other.
  const smsAccount = accounts.find((a) => a.channel === 'SMS');
  const paid = smsAccount ? ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'] : [];

  return {
    emailProvider: provider,
    smsCountry: 'US',
    domainVerified: Boolean(emailAccount),
    paidFixedCostIds: paid,
    utcOffsetHours: -7,
    businessName: org?.name ?? 'our business',
  };
}

/** Sends this calendar month, which decide how much free allowance is left. */
async function emailSentThisMonth(organizationId: string): Promise<number> {
  const month = monthKey(new Date());
  const agg = await db.spendEntry.aggregate({
    where: {
      organizationId,
      channel: 'EMAIL',
      kind: 'message',
      occurredAt: { gte: new Date(`${month}-01T00:00:00Z`) },
    },
    _sum: { units: true },
  });
  return agg._sum.units ?? 0;
}
