import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Set (or clear) a campaign's lifetime cap.
 *
 * `manage_org` rather than `publish`: a cap is a control on what everybody
 * else may spend, and someone who can be stopped by it should not be able to
 * raise it. Clearing is explicit — `capCents: null` — because a cap that
 * vanishes because a field was omitted is a cap nobody is enforcing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_org');
    const { id } = await params;

    let body: { capCents?: number | null; hardStop?: boolean };
    try {
      body = (await req.json()) as { capCents?: number | null; hardStop?: boolean };
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }
    // Omitted and explicitly-null both mean "no cap", but only null is a
    // *request* to remove one; an omitted field is a malformed call, and
    // silently clearing a cap on one would be the worst reading of it.
    if (!('capCents' in body)) throw new HttpError(400, 'Send capCents — a number to set a cap, or null to remove it.');
    const cap = body.capCents;
    if (cap !== null && (!Number.isFinite(cap) || (cap as number) < 0)) {
      throw new HttpError(422, 'A cap must be a positive amount, or null to remove it.');
    }

    const owned = await db.campaign.findFirst({
      where: { id, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ ok: false, reason: 'No such campaign.' }, { status: 404 });

    const updated = await db.campaign.update({
      where: { id },
      data: {
        budgetCents: cap === null ? null : Math.round(cap as number),
        budgetHardStop: body.hardStop ?? false,
      },
      select: { budgetCents: true, budgetHardStop: true },
    });

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'campaign.budget',
        target: id,
        detail:
          updated.budgetCents == null
            ? 'Campaign cap removed.'
            : `Campaign cap set to ${(updated.budgetCents / 100).toFixed(2)}${updated.budgetHardStop ? ', hard stop' : ', warn only'}.`,
      },
    });

    return NextResponse.json({ ok: true, budget: updated });
  });
}
