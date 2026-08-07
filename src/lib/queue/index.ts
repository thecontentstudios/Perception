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
