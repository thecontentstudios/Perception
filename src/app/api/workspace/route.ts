import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { loadWorkspace } from '@/lib/queries';
import { currentPrincipal } from '@/lib/auth/session';

/**
 * The workspace read endpoint.
 *
 * Returns `source: 'database' | 'fixtures'` so the client can hydrate from
 * Postgres when it's there and fall back to the in-memory demo when it isn't.
 * The prototype must keep running for anyone who clones the repo without
 * provisioning a database — that promise is in the README.
 *
 * **The organization comes from the session and nowhere else.** It used to be
 * a hardcoded constant, which meant every caller — signed in or not — got the
 * same workspace. With a database configured, no session now means fixtures:
 * the demo, which belongs to nobody, rather than somebody's real data.
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

  const principal = await currentPrincipal();
  if (!principal) {
    return NextResponse.json({
      source: 'fixtures',
      reason: 'Not signed in — showing the sample workspace.',
      authenticated: false,
    });
  }

  try {
    const workspace = await loadWorkspace(principal.organizationId);
    return NextResponse.json({ source: 'database', workspace, authenticated: true });
  } catch (e) {
    // A query failure must degrade to the demo rather than white-screen.
    console.error('[workspace] load failed', e);
    return NextResponse.json({ source: 'fixtures', reason: 'Could not load your workspace.' });
  }
}
