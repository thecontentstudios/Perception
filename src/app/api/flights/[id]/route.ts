import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { briefFor, recordFlightSpend, settleFlight } from '@/lib/flights';

export const dynamic = 'force-dynamic';

/**
 * Everything that happens to a flight after it is planned.
 *
 * One route, an `action` field, because the three actions share their shape:
 * find the flight inside this organization, do one money-adjacent thing,
 * report plainly. Handoff returns the brief and stamps the moment; spend
 * records an estimate; settle turns belief into invoice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('publish');
    const { id } = await params;

    let body: { action?: string; cents?: number; period?: string; invoiceCents?: number };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    // Scoped lookup first, so a borrowed id from another tenant is a plain
    // 404 rather than a distinguishable refusal.
    const flight = await db.adFlight.findFirst({
      where: { id, organizationId: principal.organizationId },
    });
    if (!flight) return NextResponse.json({ ok: false, reason: 'No such flight.' }, { status: 404 });

    if (body.action === 'handoff') {
      if (flight.status === 'planned') {
        await db.adFlight.update({ where: { id }, data: { status: 'handed_off', handedOffAt: new Date() } });
      }
      return NextResponse.json({ ok: true, brief: briefFor(flight) });
    }

    if (body.action === 'spend') {
      const r = await recordFlightSpend(
        principal.organizationId,
        id,
        Math.round(Number(body.cents) || 0),
        String(body.period ?? '')
      );
      if (!r.ok) return NextResponse.json({ ok: false, reason: r.error }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'settle') {
      const r = await settleFlight(principal.organizationId, id, Math.round(Number(body.invoiceCents) || 0));
      if (!r.ok) return NextResponse.json({ ok: false, reason: r.error }, { status: 422 });
      return NextResponse.json({ ok: true, adjustmentCents: r.adjustmentCents });
    }

    throw new HttpError(400, 'action must be handoff, spend or settle.');
  });
}
