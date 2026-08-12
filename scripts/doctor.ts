/**
 * Tell someone exactly why the app is not running.
 *
 *     npm run doctor
 *
 * The install failure this exists to prevent is the vague one. Postgres is not
 * listening, so Prisma throws a connection error, which Next renders as a 500,
 * which the person reads as "the app is broken" — and the actual fix is one
 * command they have no way to guess. Every check below ends in either a green
 * line or a specific command to run, because "something is wrong with the
 * database" is not help.
 *
 * Checks are ordered by dependency: there is no point testing whether the seed
 * ran if the schema is not there, and no point testing the schema if nothing
 * is listening on the port. The first hard failure stops its own branch and
 * the rest still run, so one pass shows you everything rather than one thing
 * at a time.
 *
 * Exits non-zero if anything required is broken, so it can gate a CI job or a
 * container healthcheck.
 */
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

type Level = 'ok' | 'warn' | 'fail';
const results: { level: Level; line: string; fix?: string }[] = [];

function ok(line: string) { results.push({ level: 'ok', line }); }
function warn(line: string, fix?: string) { results.push({ level: 'warn', line, fix }); }
function fail(line: string, fix?: string) { results.push({ level: 'fail', line, fix }); }

/** Load .env the way Next does, so the checks see what the app will see. */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env', '.env.local']) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return { ...out, ...process.env } as Record<string, string>;
}

/** A bare TCP connect — works for Postgres and Redis alike, and needs no driver. */
function portOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (result: boolean) => { sock.destroy(); resolve(result); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

function hostPort(url: string, fallbackPort: number): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname || '127.0.0.1', port: Number(u.port) || fallbackPort };
  } catch {
    return null;
  }
}

async function httpOk(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  const env = loadEnv();

  // --- Toolchain -----------------------------------------------------------
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old`, 'Install Node 20 or newer (22 recommended).');

  if (existsSync(path.join(ROOT, 'node_modules'))) ok('Dependencies installed');
  else fail('node_modules is missing', 'npm install');

  // --- Configuration -------------------------------------------------------
  if (existsSync(path.join(ROOT, '.env')) || existsSync(path.join(ROOT, '.env.local'))) {
    ok('.env found');
  } else {
    fail('No .env file', 'npm run setup');
  }

  const key = env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    warn('TOKEN_ENCRYPTION_KEY not set — connecting a social account will fail',
      'npm run setup, or add TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) to .env');
  } else if (Buffer.from(key, 'base64').length !== 32) {
    fail('TOKEN_ENCRYPTION_KEY is not 32 bytes of base64',
      'Replace it with the output of: openssl rand -base64 32');
  } else {
    ok('TOKEN_ENCRYPTION_KEY looks right');
  }

  // --- Database ------------------------------------------------------------
  let dbUp = false;
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    fail('DATABASE_URL not set', 'npm run setup');
  } else {
    const hp = hostPort(dbUrl, 5432);
    dbUp = hp ? await portOpen(hp.host, hp.port) : false;
    if (dbUp) ok(`PostgreSQL reachable on ${hp!.host}:${hp!.port}`);
    else fail(`Nothing listening on ${hp ? `${hp.host}:${hp.port}` : dbUrl}`,
      'Start PostgreSQL, then: npx prisma migrate deploy');
  }

  // Schema and seed, but only if something answered on the port — a driver
  // error against a dead socket says nothing a reader can act on.
  if (dbUp) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const orgs = await prisma.organization.count();
        ok('Schema applied');
        const contacts = await prisma.contact.count();
        if (orgs > 0 && contacts > 0) ok(`Seeded — ${orgs} workspace${orgs === 1 ? '' : 's'}, ${contacts} contacts`);
        else warn('Database is empty — every screen will be blank', 'npm run db:seed');
      } catch (e) {
        const msg = String(e);
        if (/does not exist|relation|P2021|P1010/i.test(msg)) {
          fail('Tables are missing', 'npx prisma migrate deploy && npm run db:seed');
        } else if (/@prisma\/client did not initialize|generate/i.test(msg)) {
          fail('Prisma client not generated', 'npx prisma generate');
        } else {
          fail(`Database query failed: ${msg.split('\n')[0].slice(0, 120)}`, 'npx prisma migrate deploy');
        }
      } finally {
        await prisma.$disconnect();
      }
    } catch {
      fail('Prisma client not generated', 'npx prisma generate');
    }
  }

  // --- Queue ---------------------------------------------------------------
  const redisUrl = env.REDIS_URL;
  let redisUp = false;
  if (!redisUrl) {
    warn('REDIS_URL not set — scheduled posts will not publish',
      'Add REDIS_URL="redis://localhost:6379" to .env');
  } else {
    const hp = hostPort(redisUrl, 6379);
    redisUp = hp ? await portOpen(hp.host, hp.port) : false;
    if (redisUp) ok(`Redis reachable on ${hp!.host}:${hp!.port}`);
    else warn(`Nothing listening on ${hp ? `${hp.host}:${hp.port}` : redisUrl} — scheduled work will not run`,
      'redis-server --port ' + (hp?.port ?? 6379) + ' --daemonize yes');
  }

  // --- The scheduler -------------------------------------------------------
  //
  // The single most common "the app is broken" report is a scheduled post that
  // never went out, and the cause is almost always that nobody is running the
  // worker. Nothing else in the system can tell you that: the app serves, the
  // calendar renders, the card sits on SCHEDULED forever.
  if (redisUp) {
    process.env.REDIS_URL ||= redisUrl!;
    const { workerPresence } = await import('../src/lib/queue');
    const presence = await workerPresence();
    if (presence.running) ok(`Scheduler running — last scan ${presence.agoSec}s ago`);
    else warn('Scheduler not running — nothing scheduled will send or publish', 'npm run worker');
  }

  // --- Local stand-ins -----------------------------------------------------
  //
  // Optional by design: you can click through the whole product without them.
  // They matter the moment you press send, so the wording says which is which.
  const MOCKS: [string, string | undefined][] = [
    ['Mastodon', env.MASTODON_BASE_URL ?? 'http://localhost:4321'],
    ['customer site', env.MOCK_SITE_URL ?? 'http://localhost:4322'],
    ['Resend (email)', env.RESEND_BASE_URL],
    ['Twilio (SMS)', env.TWILIO_BASE_URL],
    ['Meta', env.META_BASE_URL],
    ['Bluesky', env.BLUESKY_PDS_URL ?? 'http://localhost:4326'],
    ['Reddit', env.REDDIT_BASE_URL],
    ['Pinterest', env.PINTEREST_BASE_URL],
    ['Google Business', env.GBP_BASE_URL],
  ];
  const local = MOCKS.filter(([, url]) => url && /localhost|127\.0\.0\.1/.test(url));
  if (local.length === 0) {
    ok('No local stand-ins configured — pointing at real services');
  } else {
    const up = await Promise.all(local.map(([, url]) => httpOk(url!)));
    const down = local.filter((_, i) => !up[i]).map(([name]) => name);
    if (down.length === 0) ok(`All ${local.length} local stand-ins responding`);
    else warn(`Stand-ins not running: ${down.join(', ')} — sends to them will fail`, 'npm run mocks');
  }

  // --- The app itself ------------------------------------------------------
  const appUrl = env.APP_URL || 'http://localhost:3000';
  if (await httpOk(`${appUrl}/api/health`)) ok(`App answering on ${appUrl}`);
  else warn(`App not running on ${appUrl}`, 'npm run dev');

  // --- Report --------------------------------------------------------------
  const mark = { ok: '  \x1b[32m✓\x1b[0m', warn: '  \x1b[33m!\x1b[0m', fail: '  \x1b[31m✗\x1b[0m' };
  console.log('\nPerception — environment check\n');
  for (const r of results) {
    console.log(`${mark[r.level]} ${r.line}`);
    if (r.fix) console.log(`      \x1b[2m→ ${r.fix}\x1b[0m`);
  }

  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log('');
  if (fails > 0) {
    console.log(`\x1b[31m${fails} thing${fails === 1 ? '' : 's'} to fix before the app will run.\x1b[0m`);
  } else if (warns > 0) {
    console.log(`\x1b[33mReady to run, with ${warns} thing${warns === 1 ? '' : 's'} that will limit what works.\x1b[0m`);
  } else {
    console.log('\x1b[32mEverything is up.\x1b[0m');
  }
  console.log('');
  process.exit(fails > 0 ? 1 : 0);
}

main();
