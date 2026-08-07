import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_ } from '@/lib/auth/guard';
import { flightResults } from '@/lib/flights';

export const dynamic = 'force-dynamic';

/**
 * Everything one campaign did, in one read.
 *
 * The campaign detail screen showed only posts, which made it a page about
 * intentions. This is the page about outcomes: the sends it made, the
 * flights it flew, what all of it cost, and what came back — each from the
 * rows that already carried the campaign id once Phase 18 made the flows
 * stamp it.
 *
 * Cost-per-result appears **per channel** and only where both sides exist:
 * exact spend over measured conversions. Channels are never blended — the
 * product's oldest rule, because an average over per-message, fixed and
 * auction money is a number about nothing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('read');
    const { id } = await params;

    const campaign = await db.campaign.findFirst({
      where: { id, organizationId: principal.organizationId },
      select: { id: true, name: true, goal: true },
    });
    if (!campaign) return NextResponse.json({ ok: false, reason: 'No such campaign.' }, { status: 404 });

    const [batches, flights, spend, conversions] = await Promise.all([
      db.messageBatch.findMany({
        where: { organizationId: principal.organizationId, campaignId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, channel: true, subject: true, body: true, createdAt: true },
      }),
      db.adFlight.findMany({
        where: { organizationId: principal.organizationId, campaignId: id },
        orderBy: { createdAt: 'desc' },
      }),
      db.spendEntry.findMany({
        where: { organizationId: principal.organizationId, campaignId: id },
        select: { channel: true, certainty: true, cents: true },
      }),
      db.conversion.findMany({
        where: { organizationId: principal.organizationId, campaignId: id },
        select: { channel: true, kind: true, valueCents: true },
      }),
    ]);

    // Delivery counts per batch, grouped in two queries rather than 2N.
    const emailCounts = await db.emailDelivery.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: true,
    });
    const smsCounts = await db.smsDelivery.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: true,
    });
    const DELIVERED = new Set(['DELIVERED', 'OPENED', 'CLICKED']);
    const countFor = (batchId: string) => {
      const rows = [...emailCounts, ...smsCounts].filter((r) => r.batchId === batchId);
      return {
        total: rows.reduce((a, r) => a + r._count, 0),
        delivered: rows.filter((r) => DELIVERED.has(r.status)).reduce((a, r) => a + r._count, 0),
        opened: rows.filter((r) => r.status === 'OPENED' || r.status === 'CLICKED').reduce((a, r) => a + r._count, 0),
      };
    };

    // Money and results per channel; cost-per-result only where both exist.
    const byChannel = new Map<string, { exactCents: number; estimatedCents: number; conversions: number; revenueCents: number }>();
    const rowFor = (ch: string) => {
      const key = ch.toLowerCase();
      if (!byChannel.has(key)) byChannel.set(key, { exactCents: 0, estimatedCents: 0, conversions: 0, revenueCents: 0 });
      return byChannel.get(key)!;
    };
    for (const e of spend) {
      const r = rowFor(e.channel);
      if (e.certainty === 'exact') r.exactCents += e.cents;
      else r.estimatedCents += e.cents;
    }
    for (const c of conversions) {
      if (!c.channel) continue;
      const r = rowFor(c.channel);
      r.conversions += 1;
      r.revenueCents += c.valueCents;
    }

    return NextResponse.json({
      ok: true,
      campaign,
      sends: batches.map((b) => ({
        id: b.id,
        channel: b.channel.toLowerCase(),
        subject: b.subject,
        preview: b.body.slice(0, 90),
        sentAt: b.createdAt.toISOString(),
        ...countFor(b.id),
      })),
      flights: await Promise.all(
        flights.map(async (f) => ({
          id: f.id,
          channel: f.channel.toLowerCase(),
          status: f.status,
          dailyCents: f.dailyCents,
          days: f.days,
          settledCents: f.settledCents,
          results: await flightResults(principal.organizationId, f),
        }))
      ),
      costs: [...byChannel.entries()].map(([channel, r]) => ({
        channel,
        ...r,
        // Exact money over measured results. Estimated spend never enters a
        // CPA — a cost-per-result built on a dashboard screenshot would be
        // a guess dressed as arithmetic.
        costPerResultCents: r.conversions > 0 && r.exactCents > 0 ? Math.round(r.exactCents / r.conversions) : null,
      })),
      totals: {
        exactCents: spend.filter((e) => e.certainty === 'exact').reduce((a, e) => a + e.cents, 0),
        estimatedCents: spend.filter((e) => e.certainty !== 'exact').reduce((a, e) => a + e.cents, 0),
        conversions: conversions.length,
        revenueCents: conversions.reduce((a, c) => a + c.valueCents, 0),
      },
    });
  });
}
