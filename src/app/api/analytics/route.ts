import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { computePerformance } from '@/lib/analytics';
import { ORG } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

/**
 * Campaign performance, computed from rows.
 *
 * Returns `source: 'computed' | 'fixtures'` for the same reason
 * `/api/workspace` does — a screen full of illustrative numbers should say so
 * rather than let someone act on them.
 */
export async function GET() {
  if (!(await dbAvailable())) {
    return NextResponse.json({ source: 'fixtures', reason: 'no database' });
  }
  try {
    const { performance, meta } = await computePerformance(ORG.id);
    return NextResponse.json({ source: 'computed', performance, meta });
  } catch (e) {
    return NextResponse.json({ source: 'fixtures', reason: (e as Error).message });
  } finally {
    void db;
  }
}
