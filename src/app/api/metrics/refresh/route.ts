import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { refreshPlatformMetrics } from '@/lib/metrics';
import { handle, require_ } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Ask the platforms what happened to our posts.
 *
 * Deliberately a request rather than a background loop for now. Metrics
 * refreshing on a timer is the right end state, but a timer that quietly fails
 * produces a screen of numbers that are silently three weeks old — which is
 * worse than a blank, because a stale number does not look stale. Until the
 * refresh has a visible last-run time, an owner pressing a button knows
 * exactly how fresh the answer is.
 *
 * `publish` rather than `read`: it spends API quota on the owner's connected
 * account, and it is the same permission that put the posts there. A viewer
 * exhausting a rate limit by refreshing a dashboard would break publishing
 * for everybody.
 */
export async function POST() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('publish');

    const result = await refreshPlatformMetrics(principal.organizationId);

    return NextResponse.json({
      ok: true,
      ...result,
      // Said plainly rather than left for the caller to infer from zeros: a
      // refresh that asked nothing and a refresh where nothing changed look
      // identical in the counts alone.
      note:
        result.attempted === 0
          ? result.skipped.length > 0
            ? `Nothing to read. ${result.skipped.join(', ')} ${result.skipped.length === 1 ? 'has' : 'have'} no metrics reader yet.`
            : 'Nothing published yet.'
          : `Read ${result.written} of ${result.attempted}.`,
    });
  });
}
