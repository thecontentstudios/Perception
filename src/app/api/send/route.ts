import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { reachFor } from '@/lib/audience';
import { bindingBudget, checkBudget, combine, projectEmail, projectSms, type Projection } from '@/lib/projection';
import { previewRange, previewSms, quietHoursForAudience } from '@/lib/sms';
import { EMAIL_RATES, SMS_RATES } from '@/lib/pricing';
import { orgSendingStatus } from '@/lib/senders/registry';
import { allocateCents, spendSplit } from '@/lib/billing';
import { normalizeAddress, suppressedAmong } from '@/lib/suppression';
import type { Contact } from '@/lib/types';
import { budgetScope, monthKey } from '@/lib/ledger';

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
  /** The campaign this send belongs to. Optional; ad-hoc is legal. */
  campaignId?: string;
  variationId?: string;
  dryRun?: boolean;
  /** Bypass a soft budget warning the user has now seen and accepted. */
  acknowledgeOverBudget?: boolean;
  /** ISO time to send at; omitted means now. */
  sendAt?: string;
  /** Where `{{link}}` points. Required when the body uses the token. */
  linkUrl?: string;
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

    // A `{{link}}` with nothing behind it renders as "Book here: " — a
    // sentence that stops mid-air in a customer's inbox. The composer offers
    // the token as a chip, so it is easy to insert and easy to forget to point
    // anywhere, which makes refusing here the difference between a caught
    // mistake and a campaign nobody can act on.
    const linkUrl = (body.linkUrl ?? '').trim() || null;
    if (/\{\{link\}\}/.test(text) && !linkUrl) {
      throw new HttpError(422, 'This message contains {{link}} but no link to send people to. Add one, or take the token out.');
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

    // A borrowed campaign id from another tenant is filtered out here the
    // same way contact ids are: it simply is not found, no 403 to probe.
    const campaignId = body.campaignId
      ? (await db.campaign.findFirst({
          where: { id: body.campaignId, organizationId: principal.organizationId },
          select: { id: true },
        }))?.id ?? null
      : null;
    if (body.campaignId && !campaignId) {
      throw new HttpError(422, 'That campaign does not exist in this workspace.');
    }

    const reach = reachFor(contacts, body.channel);

    // Suppression is applied after consent, and reported as its own exclusion.
    //
    // Folding it into "unsubscribed" would be close enough to true and wrong
    // in the way that matters: an owner looking at a shrinking audience needs
    // to know whether people opted out or whether their mail is bouncing,
    // because those call for completely different responses.
    const suppressedSet = await suppressedAmong(
      principal.organizationId,
      body.channel,
      reach.contacts.map((c) => (body.channel === 'email' ? c.email : (c.phone ?? '')))
    );
    if (suppressedSet.size > 0) {
      const before = reach.contacts.length;
      reach.contacts = reach.contacts.filter(
        (c) => !suppressedSet.has(normalizeAddress(body.channel === 'email' ? c.email : (c.phone ?? '')))
      );
      reach.reachable = reach.contacts.length;
      reach.exclusions.push({
        reason: body.channel === 'email' ? 'Bounced or complained' : 'Undeliverable',
        count: before - reach.contacts.length,
        fix: 'These addresses are suppressed to protect your sending reputation. Re-mailing them would push the rest of your campaigns towards the spam folder.',
      });
    }

    const settings = await organizationSettings(principal.organizationId);
    const sentThisMonth = await emailSentThisMonth(principal.organizationId);
    const sending = await orgSendingStatus(principal.organizationId, body.channel);

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
      spendSplit(
        principal.organizationId,
        new Date(`${month}-01T00:00:00Z`),
        new Date(new Date(`${month}-01T00:00:00Z`).setUTCMonth(new Date(`${month}-01T00:00:00Z`).getUTCMonth() + 1))
      ),
    ]);

    // A cap has to count committed money as well as charged money. Counting
    // only what a provider has confirmed would let a thousand queued messages
    // sit against a cap they will certainly blow, and report the budget as
    // healthy right up to the moment they send.
    const monthlyCheck = budget
      ? checkBudget({
          capCents: budget.capCents,
          spentCents: spent.chargedCents + spent.committedCents,
          projectedCents: projection.exactCents,
          hardStop: budget.hardStop,
          period: 'this month',
          label: 'monthly',
        })
      : null;

    // The campaign's own ceiling, when this send belongs to one: a lifetime
    // total across every channel and month the campaign runs, which is a
    // different question from "how much has this workspace spent in August".
    const campaign = campaignId
      ? await db.campaign.findUnique({
          where: { id: campaignId },
          select: { budgetCents: true, budgetHardStop: true, name: true },
        })
      : null;
    const campaignSpent =
      campaign?.budgetCents != null
        ? (await db.spendEntry.aggregate({ where: { campaignId }, _sum: { cents: true } }))._sum.cents ?? 0
        : 0;
    const campaignCheck =
      campaign?.budgetCents != null
        ? checkBudget({
            capCents: campaign.budgetCents,
            spentCents: campaignSpent,
            projectedCents: projection.exactCents,
            hardStop: campaign.budgetHardStop,
            period: `on ${campaign.name}`,
            label: 'campaign',
          })
        : null;

    // One answer to "can this go out", chosen rather than stumbled into.
    const budgetCheck = bindingBudget([monthlyCheck, campaignCheck]);

    // Quiet hours, for SMS only, and **per recipient** — the window is the
    // recipient's, not the owner's. This used to check one clock, the org's
    // configured offset, and refuse the whole batch on it: at 8pm Pacific an
    // owner could not text their Hawaii customers at 5pm local, even though
    // the dispatcher (which re-checks per recipient at fire time) would have
    // sent those and deferred the rest correctly. The batch is refused only
    // when *nobody* on it can legally receive a text right now.
    //
    // A scheduled send is still checked again by the worker at the moment it
    // fires — the answer depends on the clock, so checking it now and
    // trusting it later would be checking the wrong time.
    const sendAt = body.sendAt ? new Date(body.sendAt) : new Date();
    const quiet = body.channel === 'sms' ? quietHoursForAudience(reach.contacts, sendAt) : null;

    const nameRange =
      body.channel === 'sms'
        ? previewRange(text, { names: reach.contacts.map((c) => c.name), business: settings.businessName })
        : null;

    const quote = {
      ok: true,
      dryRun: body.dryRun === true,
      sending,
      reach: {
        total: reach.total,
        reachable: reach.reachable,
        exclusions: reach.exclusions,
      },
      projection,
      budget: budgetCheck,
      budgets: { monthly: monthlyCheck, campaign: campaignCheck },
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
    // The message cost for the whole send, allocated across the recipients so
    // the rows sum back to the quote. Dividing and rounding loses the entire
    // amount on email (0.08c a message rounds to nothing) and 9% on SMS.
    const messageCents = projection.items
      .filter((i) => i.kind === 'message' && i.certainty === 'exact')
      .reduce((c, i) => c + i.cents, 0);
    const perMessage = allocateCents(messageCents, reach.reachable);

    // Queue the messages. **No ledger rows are written here**, and that is the
    // correction this phase exists to make.
    //
    // The previous version wrote deliveries and `SpendEntry` rows in one
    // transaction, with a comment explaining that splitting them risked "sent
    // messages with no record of what they cost". The reasoning was sound and
    // the premise was false: nothing was being sent. Writing both together
    // guaranteed the opposite inconsistency — a record of cost for messages no
    // provider had ever seen — which is the worse of the two, because an
    // over-reported ledger has no invoice to contradict it.
    //
    // Cost is now carried on the delivery row and becomes a charge in
    // `dispatch()`, when a provider hands back a reference. Until then the
    // money is *committed*, which `/spend` reports as its own figure.
    const written = await db.$transaction(async (tx) => {
      // The message itself, stored once. The dispatcher renders per recipient
      // from this row — Phase 7 queued deliveries with a price and no content,
      // which was fine while nothing could send them.
      const batch = await tx.messageBatch.create({
        data: {
          organizationId: principal.organizationId,
          brandId: body.brandId ?? null,
          channel: body.channel.toUpperCase() as never,
          campaignId,
          variationId,
          subject: body.channel === 'email' ? (body.subject ?? '').trim() : null,
          body: text,
          fromName: settings.businessName,
          fromEmail: settings.fromEmail,
          linkUrl,
        },
      });

      if (body.channel === 'sms' && smsPreview) {
        await tx.smsDelivery.createMany({
          data: reach.contacts.map((c, i) => ({
            variationId,
            batchId: batch.id,
            contactId: c.id,
            segments: smsPreview!.segments,
            encoding: smsPreview!.encoding,
            costCents: perMessage[i] ?? 0,
            status: 'QUEUED' as const,
          })),
        });
      } else {
        await tx.emailDelivery.createMany({
          data: reach.contacts.map((c, i) => ({
            variationId,
            batchId: batch.id,
            contactId: c.id,
            costCents: perMessage[i] ?? 0,
            status: 'QUEUED' as const,
          })),
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: principal.organizationId,
          actorUserId: principal.userId,
          action: `${body.channel}.queued`,
          target: variationId,
          detail: `${reach.reachable} recipients, ${projection.exactCents}c committed, ${
            sending.ready ? `sending via ${sending.provider}` : 'no sending service connected'
          }`,
        },
      });
      return reach.reachable;
    });

    return NextResponse.json({
      ...quote,
      dryRun: false,
      queued: written,
      variationId,
      // `sent` is not a field this route can set. It queues; the dispatcher
      // sends. Reporting a send here is what produced the original lie.
      sent: 0,
      committedCents: projection.exactCents,
      chargedCents: 0,
      sending,
    });
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
  fromEmail: string | null;
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
    fromEmail: process.env.RESEND_FROM ?? null,
  };
}

/**
 * Email that will consume this month's free allowance — sent *and* queued.
 *
 * Counting only confirmed sends would quote the second campaign of the month
 * as though the first had not happened, because the first is still sitting in
 * the queue waiting for a provider. The allowance is consumed by messages that
 * are going to go out, not by messages that have already gone.
 */
async function emailSentThisMonth(organizationId: string): Promise<number> {
  const month = monthKey(new Date());
  const [charged, queued] = await Promise.all([
    db.spendEntry.aggregate({
      where: {
        organizationId,
        channel: 'EMAIL',
        kind: 'message',
        occurredAt: { gte: new Date(`${month}-01T00:00:00Z`) },
      },
      _sum: { units: true },
    }),
    db.emailDelivery.count({ where: { status: 'QUEUED', contact: { organizationId } } }),
  ]);
  return (charged._sum.units ?? 0) + queued;
}
