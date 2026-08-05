import { db } from '../db';
import { publishQueue, type PublishJobData } from './index';

/**
 * The poller: finds posts whose moment has arrived and hands them to the queue.
 *
 * Deliberately *not* "enqueue a delayed job at approval time". A delayed job
 * holds the schedule in Redis, and then rescheduling a post in the UI means
 * finding and rewriting that job — or forgetting to, and having the post fire
 * at the old time. Polling Postgres means the calendar is always the truth:
 * move a card and the next scan simply sees the new time.
 *
 * The cost is granularity. A scan every 30 seconds means a post fires within
 * 30 seconds of its minute, which is the right trade for scheduled marketing
 * and would be the wrong one for something time-critical.
 */

/** How far back to look, so a worker restart still catches what it missed. */
const LOOKBACK_MS = 60 * 60 * 1000;

/**
 * One idempotency key per (variation, scheduled slot). Retries of the same
 * slot reuse it, so a crashed worker can never turn one post into two; moving
 * the post to a new time deliberately mints a new key, because that is a new
 * intent to publish.
 */
export function slotKey(variationId: string, scheduledAt: Date): string {
  return `${variationId}:${scheduledAt.toISOString().slice(0, 16)}`;
}

export interface ScanResult {
  due: number;
  enqueued: number;
  keys: string[];
}

/** Find everything due and enqueue it. Safe to call as often as you like. */
export async function scanAndEnqueue(now = new Date()): Promise<ScanResult> {
  const due = await db.channelVariation.findMany({
    where: {
      status: { in: ['APPROVED', 'SCHEDULED'] },
      scheduledAt: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
      claimedAt: null,
    },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  });

  const keys: string[] = [];
  for (const v of due) {
    const idempotencyKey = slotKey(v.id, v.scheduledAt!);
    const data: PublishJobData = { variationId: v.id, idempotencyKey };
    // The job id is the slot key, so a scan that runs while the previous job
    // is still queued adds nothing rather than queueing a duplicate.
    await publishQueue().add('publish', data, { jobId: idempotencyKey });
    keys.push(idempotencyKey);
  }

  return { due: due.length, enqueued: keys.length, keys };
}
