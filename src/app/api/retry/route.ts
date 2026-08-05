import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { publishQueue } from '@/lib/queue';
import { slotKey } from '@/lib/queue/scheduler';
import { ORG } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

/**
 * "Retry now" — the fix on a failed publish, done for real.
 *
 * It moves the post back to `scheduled`, releases any stale claim, and puts it
 * at the front of the queue. The worker does the rest, which means the retry
 * gets the same preflight, the same idempotency guarantee, and the same
 * failure recording as the original attempt. A retry that took a different
 * path through the code would be a second, less-tested publisher.
 *
 * **The slot key is reused deliberately.** If the first attempt failed after
 * the platform had already accepted the post — a timeout on the response, say
 * — a fresh key would publish it twice. Reusing it means the platform's own
 * idempotency returns the original post instead.
 */
export async function POST(req: Request) {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  let variationId: string;
  try {
    ({ variationId } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
  }

  const v = await db.channelVariation.findUnique({
    where: { id: variationId },
    select: { id: true, status: true, scheduledAt: true },
  });
  if (!v) return NextResponse.json({ ok: false, reason: 'no such post' }, { status: 404 });
  if (v.status === 'PUBLISHED') {
    return NextResponse.json({ ok: false, reason: 'already published' }, { status: 409 });
  }

  // No scheduled time means it failed from an immediate publish; retrying it
  // means now.
  const slot = v.scheduledAt ?? new Date();
  await db.channelVariation.update({
    where: { id: variationId },
    data: { status: 'SCHEDULED', scheduledAt: slot, claimedAt: null },
  });

  const key = slotKey(variationId, slot);
  try {
    // The completed/failed job from the previous attempt still holds this id,
    // so it has to go before the same id can be queued again.
    await publishQueue().remove(key).catch(() => {});
    await publishQueue().add('publish', { variationId, idempotencyKey: key }, { jobId: key });
  } catch (e) {
    // Queue down: the row is already back to SCHEDULED, so the next scan will
    // pick it up once the queue returns. Say so rather than claiming success.
    return NextResponse.json(
      { ok: false, queued: false, reason: `Queued for the next scan — the queue is unreachable (${(e as Error).message}).` },
      { status: 202 }
    );
  }

  await db.auditEvent.create({
    data: {
      organizationId: ORG.id, actorUserId: 'u-dana', action: 'publish.retried',
      target: variationId, detail: 'Manual retry from Home.',
    },
  });

  return NextResponse.json({ ok: true, queued: true });
}
