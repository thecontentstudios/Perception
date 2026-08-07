import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { queueReachable } from '@/lib/queue';
import { rateLimitBackend } from '@/lib/rate-limit';
import { configSummary } from '@/lib/config';
import { ffmpegAvailable } from '@/lib/media/video';

export const dynamic = 'force-dynamic';

/**
 * Health, for a load balancer and for a person.
 *
 * `?deep=1` actually touches Postgres, Redis, and ffmpeg. The plain call is
 * cheap, because a readiness probe hitting the database every second is a way
 * to cause the outage it was meant to detect.
 *
 * **It never returns configuration values, only whether they are present and
 * plausible.** A health endpoint is usually the least-protected thing on a
 * service, and one that echoes a connection string is a gift.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';
  const config = configSummary();

  if (!deep) {
    return NextResponse.json(
      { status: config.ok ? 'ok' : 'degraded', configured: config.ok },
      { status: config.ok ? 200 : 503 }
    );
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  const t0 = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: `${Date.now() - t0}ms` };
  } catch {
    checks.database = { ok: false, detail: (await dbAvailable()) ? 'query failed' : 'unreachable' };
  }

  checks.queue = (await queueReachable())
    ? { ok: true }
    : { ok: false, detail: 'scheduled posts will not publish' };

  // Not a failure — images work without it — but the "trim this video" fix
  // returns a 501 without it, and an operator should know why.
  checks.ffmpeg = (await ffmpegAvailable())
    ? { ok: true }
    : { ok: false, detail: 'video trimming and reframing unavailable' };

  checks.rateLimits = { ok: true, detail: await rateLimitBackend() };

  // Only the database failing makes the service unable to do its job. The
  // others degrade features, and returning 503 for them would take a healthy
  // instance out of rotation over a missing codec.
  const status = checks.database.ok ? (config.ok ? 'ok' : 'degraded') : 'unhealthy';

  return NextResponse.json(
    {
      status,
      checks,
      // Keys and severities, never values.
      config: config.issues.map((i) => ({ key: i.key, severity: i.severity, message: i.message })),
    },
    { status: checks.database.ok ? 200 : 503 }
  );
}
