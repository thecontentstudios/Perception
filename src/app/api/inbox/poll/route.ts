import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { pollSocialInbox } from '@/lib/listen';
import { handle, require_ } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Check for social replies now, without waiting for the worker's pass.
 *
 * The worker polls every few minutes on its own; this exists for the moment
 * an owner is looking at the inbox expecting something. Same permission as
 * reading the inbox — it writes only what the platforms already said.
 */
export async function POST() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('read');
    const result = await pollSocialInbox(principal.organizationId);
    return NextResponse.json({ ok: true, ...result });
  });
}
