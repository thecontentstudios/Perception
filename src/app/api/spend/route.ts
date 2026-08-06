import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { forecastMonth } from '@/lib/projection';
import type { Channel } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * What has been spent, and what the month is heading towards.
 *
 * Reads the ledger rather than recomputing from delivery counts. Those two
 * approaches agree until the day a rate changes, at which point recomputation
 * silently reprices last month and the owner's records stop matching what they
 * were shown at the time. The ledger is what was charged; that is the number
 * a business needs.
 */

/** 'YYYY-MM' for a date, in UTC — the same month boundary the ledger uses. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The canonical uniqueness key for a budget.
 *
 * One function, used by both the writer and the reader, because two places
 * deriving "the same" key independently is how a cap gets written under one
 * name and looked up under another — and a cap nobody reads is worse than no
 * cap, since the owner believes it is there.
 */
export function budgetScope(brandId: string | null, channel: string | null): string {
  return `${brandId ?? 'all'}:${channel ? channel.toUpperCase() : 'all'}`;
}

function monthBounds(key: string): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new HttpError(400, 'Month must look like 2026-08.');
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export async function GET(req: Request) {
  return handle(async () => {
    const principal = await require_('read');
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }

    const url = new URL(req.url);
    const now = new Date();
    const month = url.searchParams.get('month') ?? monthKey(now);
    const { start, end } = monthBounds(month);

    const [entries, budgets] = await Promise.all([
      db.spendEntry.findMany({
        where: { organizationId: principal.organizationId, occurredAt: { gte: start, lt: end } },
        orderBy: { occurredAt: 'desc' },
      }),
      db.budget.findMany({ where: { organizationId: principal.organizationId, month } }),
    ]);

    // Grouped in memory rather than by SQL: the row count for one org-month is
    // in the hundreds, and doing it here keeps the exact/estimated split — the
    // one distinction that must survive to the screen — visible in one place.
    const byChannel = new Map<string, { channel: string; exactCents: number; estimatedCents: number; units: number; entries: number }>();
    const byKind = new Map<string, number>();
    let exactCents = 0;
    let estimatedCents = 0;

    for (const e of entries) {
      const key = e.channel.toLowerCase();
      const row = byChannel.get(key) ?? { channel: key, exactCents: 0, estimatedCents: 0, units: 0, entries: 0 };
      if (e.certainty === 'exact') {
        row.exactCents += e.cents;
        exactCents += e.cents;
      } else {
        row.estimatedCents += e.cents;
        estimatedCents += e.cents;
      }
      row.units += e.units;
      row.entries += 1;
      byChannel.set(key, row);
      byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + e.cents);
    }

    // Committed: scheduled variations that will cost money but have not yet.
    // Counted separately from spend because it has not left the account, and
    // folding it into "spent" would make the month look worse than it is.
    const scheduled = await db.channelVariation.count({
      where: {
        contentItem: { campaign: { organizationId: principal.organizationId } },
        status: 'SCHEDULED',
        scheduledAt: { gte: now, lt: end },
        channel: { in: ['EMAIL', 'SMS'] },
      },
    });

    const forecast = forecastMonth({ spentCents: exactCents, committedCents: 0, now });

    return NextResponse.json({
      ok: true,
      month,
      exactCents,
      estimatedCents,
      byChannel: [...byChannel.values()].sort((a, b) => b.exactCents - a.exactCents),
      byKind: Object.fromEntries(byKind),
      scheduledSends: scheduled,
      forecast,
      budgets: budgets.map((b) => ({
        id: b.id,
        channel: b.channel ? (b.channel.toLowerCase() as Channel) : null,
        capCents: b.capCents,
        hardStop: b.hardStop,
      })),
      entries: entries.slice(0, 50).map((e) => ({
        id: e.id,
        channel: e.channel.toLowerCase(),
        kind: e.kind,
        certainty: e.certainty,
        cents: e.cents,
        units: e.units,
        note: e.note,
        occurredAt: e.occurredAt.toISOString(),
      })),
    });
  });
}

/**
 * Set a monthly cap.
 *
 * `manage_org` rather than `manage_connections`: a budget is a financial
 * control, and the person who can wire up a Facebook Page is not automatically
 * the person who can decide what the business spends.
 */
export async function PUT(req: Request) {
  return handle(async () => {
    const principal = await require_('manage_org');
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }

    let body: { month?: string; channel?: string | null; capCents?: number; hardStop?: boolean };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    const month = body.month ?? monthKey(new Date());
    monthBounds(month); // validates
    const capCents = Math.round(Number(body.capCents));
    if (!Number.isFinite(capCents) || capCents < 0) throw new HttpError(400, 'A cap has to be a positive amount.');

    const channel = body.channel ? (body.channel.toUpperCase() as never) : null;
    const scope = budgetScope(null, body.channel ?? null);

    const budget = await db.budget.upsert({
      where: { organizationId_scope_month: { organizationId: principal.organizationId, scope, month } },
      create: {
        organizationId: principal.organizationId,
        channel,
        scope,
        month,
        capCents,
        hardStop: body.hardStop ?? false,
      },
      update: { capCents, hardStop: body.hardStop ?? false },
    });

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'budget.set',
        target: budget.id,
        detail: `${month} ${channel ?? 'all channels'} → ${capCents}¢${budget.hardStop ? ' (hard stop)' : ''}`,
      },
    });

    return NextResponse.json({ ok: true, budget: { id: budget.id, capCents: budget.capCents, hardStop: budget.hardStop } });
  });
}
