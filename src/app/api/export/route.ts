import { dbAvailable } from '@/lib/db';
import { NextResponse } from 'next/server';
import { exportCsv, type ExportKind } from '@/lib/export';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KINDS: ExportKind[] = ['contacts', 'suppressions', 'ledger'];

/**
 * Download your data.
 *
 * `manage_org`: an export is every contact, every opt-out and every dollar
 * in one file — the most concentrated thing this product can hand over, and
 * a permission an analyst should not carry. It is also audited, because a
 * bulk export is exactly the event an owner would want to find afterwards.
 */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_org');

    const kind = new URL(req.url).searchParams.get('kind') as ExportKind | null;
    if (!kind || !KINDS.includes(kind)) {
      throw new HttpError(400, `kind must be one of: ${KINDS.join(', ')}.`);
    }

    const out = await exportCsv(principal.organizationId, kind);

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'data.exported',
        target: kind,
        detail: `${out.rowCount} rows downloaded as ${out.filename}.`,
      },
    });

    return new NextResponse(out.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${out.filename}"`,
        // Never cached: this is somebody's whole customer list.
        'cache-control': 'no-store',
      },
    });
  });
}
