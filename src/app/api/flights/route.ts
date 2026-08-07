import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { briefFor, flightResults, planFlight, type FlightPlan } from '@/lib/flights';

export const dynamic = 'force-dynamic';

/**
 * Plan an ad flight, and list the ones planned.
 *
 * Planning writes no money. The ledger is touched only when the platform
 * reports spend (estimated) or invoices (exact) — a planned flight is a
 * decision, and decisions are free.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('publish');

    let body: Partial<FlightPlan> & { dailyCents?: number; days?: number };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    const result = await planFlight(principal.organizationId, {
      channel: body.channel as FlightPlan['channel'],
      objective: body.objective ?? '',
      audience: body.audience ?? '',
      headline: body.headline,
      body: body.body ?? '',
      destinationUrl: body.destinationUrl ?? '',
      dailyCents: Math.round(Number(body.dailyCents) || 0),
      days: Math.round(Number(body.days) || 0),
      campaignId: body.campaignId,
      brandId: body.brandId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, problems: result.problems }, { status: 422 });
    }
    return NextResponse.json({
      ok: true,
      flight: result.flight,
      estimate: result.estimate,
      brief: briefFor(result.flight),
    });
  });
}

export async function GET() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('read');

    const flights = await db.adFlight.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        spend: { select: { cents: true, certainty: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      flights: await Promise.all(
        flights.map(async (f) => ({
          ...f,
          spend: undefined,
          estimatedCents: f.spend.filter((s) => s.certainty === 'estimated').reduce((a, b) => a + b.cents, 0),
          exactCents: f.spend.filter((s) => s.certainty === 'exact').reduce((a, b) => a + b.cents, 0),
          // What the flight caused, from our own snippet's UTM captures —
          // never the platform's self-graded conversion column.
          results: await flightResults(principal.organizationId, f),
        }))
      ),
    });
  });
}
