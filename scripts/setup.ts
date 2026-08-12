/**
 * Get from a fresh clone to a running app in one command.
 *
 *     npm run setup
 *
 * What it does, in order: write a `.env` if there isn't one (generating the
 * keys rather than asking anyone to paste them), apply the schema, and seed a
 * workspace. Then it prints the login.
 *
 * Two rules it holds to:
 *
 *   - **It never overwrites.** An existing `.env` is left exactly as it is and
 *     only missing keys are appended, because the one file in the repo that
 *     holds credentials is the one file a setup script must not clobber.
 *   - **It stops on the first thing it cannot do.** If Postgres is not
 *     listening, it says so and stops rather than running migrate against
 *     nothing and printing a stack trace.
 *
 * `npm run doctor` checks the same ground without changing anything; this
 * script is the version that fixes what it finds.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const say = (s: string) => console.log(s);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const good = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const note = (s: string) => console.log(`  \x1b[2m${s}\x1b[0m`);
const stop = (s: string, fix?: string): never => {
  console.error(`\n  \x1b[31m✗ ${s}\x1b[0m`);
  if (fix) console.error(`    \x1b[2m→ ${fix}\x1b[0m\n`);
  process.exit(1);
};

/**
 * The defaults a local install needs, with keys generated fresh.
 *
 * Anything already in the environment wins. Without that, running
 * `DATABASE_URL=… npm run setup` would migrate and seed the database you named
 * while writing the *default* one into `.env` — so setup prints "Ready" and
 * the app then starts against an empty database on a port nothing is on. The
 * override is the whole point of passing it.
 */
function defaults(): Record<string, string> {
  const generated: Record<string, string> = {
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/perception?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AUTH_SECRET: randomBytes(32).toString('base64'),
    MEDIA_ROOT: './.media',

    // Local stand-ins. Deleting these lines is what switches a channel over to
    // the real service — the adapter code does not change.
    RESEND_API_KEY: 'test-key',
    RESEND_FROM: 'hello@summitlocal.co',
    RESEND_BASE_URL: 'http://localhost:4323',
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'test-token',
    TWILIO_FROM: '+15005550006',
    TWILIO_BASE_URL: 'http://localhost:4324',
    META_BASE_URL: 'http://localhost:4325',
    BLUESKY_PDS_URL: 'http://localhost:4326',
    REDDIT_BASE_URL: 'http://localhost:4327',
    PINTEREST_BASE_URL: 'http://localhost:4328',
    GBP_BASE_URL: 'http://localhost:4329',
  };

  for (const key of Object.keys(generated)) {
    const fromEnv = process.env[key];
    if (fromEnv) generated[key] = fromEnv;
  }
  return generated;
}

function parseEnv(text: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) keys.add(line.slice(0, eq).trim());
  }
  return keys;
}

function readValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ENV_PATH)) return undefined;
  for (const raw of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0 && line.slice(0, eq).trim() === key) {
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return undefined;
}

function portOpen(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (r: boolean) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  say('\n\x1b[1mPerception — setup\x1b[0m');

  // --- 1. Environment file -------------------------------------------------
  step('1. Configuration');
  const wanted = defaults();
  if (!existsSync(ENV_PATH)) {
    const body = [
      '# Written by `npm run setup`. Safe to edit.',
      '#',
      '# The *_BASE_URL lines point at local stand-in servers (`npm run mocks`).',
      '# To use a real service instead, put in real credentials and DELETE that',
      '# service\'s _BASE_URL line — the adapter then talks to production.',
      '',
      ...Object.entries(wanted).map(([k, v]) => `${k}="${v}"`),
      '',
    ].join('\n');
    writeFileSync(ENV_PATH, body, { mode: 0o600 });
    good('Wrote .env with freshly generated keys');
  } else {
    const have = parseEnv(readFileSync(ENV_PATH, 'utf8'));
    const missing = Object.entries(wanted).filter(([k]) => !have.has(k));
    if (missing.length === 0) {
      good('.env already has everything — left untouched');
    } else {
      appendFileSync(ENV_PATH,
        `\n# Appended by \`npm run setup\`\n${missing.map(([k, v]) => `${k}="${v}"`).join('\n')}\n`);
      good(`.env kept as-is; appended ${missing.length} missing key${missing.length === 1 ? '' : 's'}`);
    }
  }

  // --- 2. Database ---------------------------------------------------------
  step('2. Database');
  const dbUrl = readValue('DATABASE_URL')!;
  let host = 'localhost';
  let port = 5432;
  try {
    const u = new URL(dbUrl);
    host = u.hostname || host;
    port = Number(u.port) || port;
  } catch {
    stop(`DATABASE_URL is not a valid URL: ${dbUrl}`);
  }
  if (!(await portOpen(host, port))) {
    stop(`No PostgreSQL on ${host}:${port}`,
      'Start it (e.g. `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name perception-db postgres:16`), then run this again.');
  }
  good(`PostgreSQL reachable on ${host}:${port}`);

  note('Applying schema…');
  try {
    run('npx', ['prisma', 'migrate', 'deploy']);
    run('npx', ['prisma', 'generate']);
  } catch {
    stop('Could not apply the schema.',
      `Check that the database in DATABASE_URL exists and the user can create tables.`);
  }
  good('Schema applied');

  // --- 3. Seed -------------------------------------------------------------
  step('3. Sample workspace');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let contacts = 0;
  try {
    contacts = await prisma.contact.count();
  } finally {
    await prisma.$disconnect();
  }
  if (contacts > 0) {
    good(`Already seeded — ${contacts} contacts, left alone`);
  } else {
    run('npx', ['tsx', 'prisma/seed.ts']);
    good('Seeded');
  }

  // --- 4. What to do next --------------------------------------------------
  const password = process.env.SEED_PASSWORD || 'demo-password-change-me';
  say('\n\x1b[1mReady.\x1b[0m Start it with:\n');
  say('  npm run dev              \x1b[2m# the app on http://localhost:3000\x1b[0m');
  say('  npm run worker           \x1b[2m# scheduled sends and publishes (separate terminal)\x1b[0m');
  say('  npm run mocks            \x1b[2m# stand-in email/SMS/social servers (separate terminal)\x1b[0m');
  say('\nSign in with:\n');
  say(`  dana@summitlocal.co / ${password}`);
  say('\n\x1b[2mIf anything looks wrong later: npm run doctor\x1b[0m\n');
}

main().catch((e) => stop(String(e).split('\n')[0]));
