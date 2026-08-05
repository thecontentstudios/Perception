import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { computePerformance } from '@/lib/analytics';
import { handle, require_ } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Campaign performance, computed from rows.
 *
 * Returns `source: 'computed' | 'fixtures'` for the same reason
 * `/api/workspace` does — a screen full of illustrative numbers should say so
 * rather than let someone act on them.
 */
export async function GET() {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ source: 'fixtures', reason: 'no database' });
  }
  const principal = await require_('read');
  try {
    const { performance, meta } = await computePerformance(principal.organizationId);
    return NextResponse.json({ source: 'computed', performance, meta });
  } catch (e) {
    console.error('[analytics] compute failed', e);
    return NextResponse.json({ source: 'fixtures', reason: 'Could not compute your results.' });
  } finally {
    void db;
  }
  });
}
