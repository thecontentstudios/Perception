import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { loadWorkspace } from '@/lib/queries';

/**
 * The workspace read endpoint.
 *
 * Returns `source: 'database' | 'fixtures'` so the client can hydrate from
 * Postgres when it's there and fall back to the in-memory demo when it isn't.
 * The prototype must keep running for anyone who clones the repo without
 * provisioning a database — that promise is in the README.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await dbAvailable())) {
    return NextResponse.json({
      source: 'fixtures',
      reason: process.env.DATABASE_URL
        ? 'DATABASE_URL is set but the database is unreachable.'
        : 'No DATABASE_URL configured.',
    });
  }
  try {
    const workspace = await loadWorkspace('org-1');
    return NextResponse.json({ source: 'database', workspace });
  } catch (e) {
    // A query failure must degrade to the demo rather than white-screen.
    return NextResponse.json({ source: 'fixtures', reason: (e as Error).message });
  }
}
