import { redisConnection } from './queue';

/**
 * Rate limiting.
 *
 * Backed by Redis when it is there, and by an in-process map when it is not.
 * The fallback is stated plainly rather than hidden, because it is *weaker in
 * a specific way*: with several app instances behind a load balancer, each
 * keeps its own counters, so the effective limit is the configured one times
 * the instance count. That is fine for a single-instance deployment and wrong
 * for a fleet, and an operator needs to know which they have.
 *
 * A fixed window, not a sliding one. A determined caller can send `max`
 * requests at the end of one window and `max` at the start of the next; a
 * sliding log fixes that and costs a sorted set per key. For "stop a script
 * hammering login" the fixed window is enough, and its behaviour is obvious,
 * which matters when someone is reading it at 3am.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

type Redis = { incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown>; ttl(k: string): Promise<number> };

let client: Redis | null = null;
let redisDown = false;

async function redis(): Promise<Redis | null> {
  if (redisDown) return null;
  if (client) return client;
  try {
    const { default: IORedis } = await import('ioredis');
    const conn = redisConnection() as { host: string; port: number; password?: string };
    const c = new IORedis({ ...conn, lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    await c.connect();
    client = c as unknown as Redis;
    return client;
  } catch {
    // Once, not per request — a dead Redis must not add a connection attempt
    // to the latency of every call.
    redisDown = true;
    return null;
  }
}

const local = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  key: string,
  opts: { max: number; windowSec: number }
): Promise<RateLimitResult> {
  const r = await redis();

  if (r) {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / opts.windowSec)}`;
    const count = await r.incr(bucket);
    if (count === 1) await r.expire(bucket, opts.windowSec);
    const ttl = count > opts.max ? await r.ttl(bucket) : 0;
    return {
      ok: count <= opts.max,
      remaining: Math.max(0, opts.max - count),
      retryAfterSec: Math.max(1, ttl),
    };
  }

  const now = Date.now();
  const entry = local.get(key);
  if (!entry || entry.resetAt < now) {
    local.set(key, { count: 1, resetAt: now + opts.windowSec * 1000 });
    // Bound the map: without this it is a memory leak keyed by attacker input.
    if (local.size > 10_000) {
      for (const [k, v] of local) if (v.resetAt < now) local.delete(k);
    }
    return { ok: true, remaining: opts.max - 1, retryAfterSec: 0 };
  }
  entry.count += 1;
  return {
    ok: entry.count <= opts.max,
    remaining: Math.max(0, opts.max - entry.count),
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/** Whether limits are shared across instances — surfaced by /api/health. */
export async function rateLimitBackend(): Promise<'redis' | 'in-process'> {
  return (await redis()) ? 'redis' : 'in-process';
}
