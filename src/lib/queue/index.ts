import { Queue, type ConnectionOptions } from 'bullmq';

/**
 * Queue wiring.
 *
 * **Postgres is the source of truth for what is scheduled; Redis is only how
 * it gets executed.** That division matters. If the queue owned the schedule,
 * flushing Redis would silently drop every future post while the calendar
 * still showed them — the failure mode where the product lies to you. Instead
 * a poller reads due rows out of Postgres and enqueues them, so losing Redis
 * costs you in-flight work and nothing else.
 */

export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  variationId: string;
  /** Reused across every retry of this slot, so a retry can't become a second post. */
  idempotencyKey: string;
}

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    // BullMQ workers block on the connection; without this ioredis gives up
    // mid-wait and the worker stops consuming with no error anyone sees.
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<PublishJobData> | null = null;

export function publishQueue(): Queue<PublishJobData> {
  if (!queue) {
    queue = new Queue<PublishJobData>(PUBLISH_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        // Four tries over about fifteen minutes. Platform 5xx and rate limits
        // are usually gone by then; anything still failing is a real problem
        // the owner needs to see, not something to keep hammering.
        attempts: 4,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return queue;
}

export async function queueReachable(): Promise<boolean> {
  try {
    // A real round trip, not just a constructed client: BullMQ connects
    // lazily, so anything cheaper would report a dead Redis as healthy.
    await publishQueue().getJobCounts();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worker heartbeat
// ---------------------------------------------------------------------------

/**
 * Whether a scheduler process is alive, and how recently it ran.
 *
 * Two questions this answers that nothing else could.
 *
 * The owner's: **"why did my scheduled post never go out?"** Almost always
 * because nobody is running `npm run worker`. Until now the only evidence was
 * a card that stayed on `SCHEDULED` forever — the app looked healthy, the
 * calendar looked right, and the one process that makes time pass was absent
 * with no indication anywhere.
 *
 * And the test suite's: **is something else draining the same queue right
 * now?** A worker and `npm test` both dispatch the org's queued messages, and
 * whoever claims a row first wins. That is correct behaviour from both — the
 * claim is a compare-and-swap precisely so several workers can run — but it
 * makes "the dispatcher sent all 1,111" unassertable, and the failure reads
 * as a product bug rather than as two processes doing their job.
 *
 * The key expires on its own, so a killed worker stops reporting alive without
 * needing to have cleaned up after itself.
 */
const HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_TTL_SEC = 90;

/**
 * A short-lived client of our own rather than the queue's.
 *
 * BullMQ 6 no longer exposes the Queue's connection, and borrowing a worker's
 * blocking connection for an unrelated GET would be the wrong thing to do
 * even if it did. Opening one costs a round trip on a call that already makes
 * one, and closing it keeps a `doctor` run from hanging on an open socket.
 */
async function withRedis<T>(fn: (c: import('ioredis').Redis) => Promise<T>, fallback: T): Promise<T> {
  let client: import('ioredis').Redis | null = null;
  try {
    const { default: IORedis } = await import('ioredis');
    const conn = redisConnection() as { host: string; port: number; password?: string };
    client = new IORedis({ ...conn, lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    return await fn(client);
  } catch {
    return fallback;
  } finally {
    if (client) void client.quit().catch(() => {});
  }
}

export async function beatHeartbeat(): Promise<void> {
  // A worker that cannot reach Redis has larger problems, and the scan
  // reports them itself. Never let the heartbeat be what stops the loop.
  await withRedis(async (c) => {
    await c.set(HEARTBEAT_KEY, String(Date.now()), 'EX', HEARTBEAT_TTL_SEC);
  }, undefined);
}

export interface WorkerPresence {
  running: boolean;
  /** Seconds since the last scan, when one has been seen. */
  agoSec: number | null;
}

export async function workerPresence(): Promise<WorkerPresence> {
  return withRedis(async (c) => {
    const raw = await c.get(HEARTBEAT_KEY);
    if (!raw) return { running: false, agoSec: null };
    return { running: true, agoSec: Math.max(0, Math.round((Date.now() - Number(raw)) / 1000)) };
  }, { running: false, agoSec: null });
}
