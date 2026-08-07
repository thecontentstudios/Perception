import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { forecastMonth } from '@/lib/projection';
import { spendSplit } from '@/lib/billing';
import { sendingStatus } from '@/lib/senders/registry';
import type { Channel } from '@/lib/types';
import { budgetScope, monthKey } from '@/lib/ledger';

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

    // Committed: messages priced and queued that no provider has taken yet.
    //
    // This is the figure whose absence made the whole screen wrong. Spend used
    // to be written the moment a send was accepted, so committed money and
    // charged money were the same number and the number was charged. They are
    // now read apart, and the screen shows both, because "we will owe this"
    // and "we owe this" are different facts and an owner needs to tell them
    // apart before deciding anything.
    const split = await spendSplit(principal.organizationId, start, end);

    const scheduled = await db.channelVariation.count({
      where: {
        contentItem: { campaign: { organizationId: principal.organizationId } },
        status: 'SCHEDULED',
        scheduledAt: { gte: now, lt: end },
        channel: { in: ['EMAIL', 'SMS'] },
      },
    });

    // Whether anything can actually send. A month-to-date of zero means
    // something very different depending on the answer: no campaigns, or no
    // way to run them.
    const sending = { email: sendingStatus('email'), sms: sendingStatus('sms') };

    const forecast = forecastMonth({
      spentCents: exactCents,
      committedCents: split.committedCents,
      now,
    });

    return NextResponse.json({
      ok: true,
      month,
      exactCents,
      estimatedCents,
      /** Money a provider has confirmed. Same as exactCents; named for clarity. */
      chargedCents: split.chargedCents,
      /** Priced, queued, and not yet sent by anybody. */
      committedCents: split.committedCents,
      committedMessages: split.committedMessages,
      sending,
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
