/**
 * The Phase 1.4 acceptance test, run for real.
 *
 *   npm run test:worker
 *
 * The claim being checked is the one in the build plan: *a post scheduled two
 * minutes out publishes on its own with the browser closed.* Nothing here
 * touches a browser. It schedules a post a few seconds ahead, starts the
 * worker as a separate process, and waits to see whether the post went out —
 * against a mock instance that speaks real Mastodon over real HTTP.
 *
 * Requires Postgres, Redis, and `node scripts/mock-mastodon.js`.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { db } from '../src/lib/db';
import { saveGrant, removeGrant } from '../src/lib/oauth/store';
import { reconcileAccount, reconcileDisconnect } from '../src/lib/oauth/reconcile';
import { publishQueue } from '../src/lib/queue';
import { slotKey } from '../src/lib/queue/scheduler';
import { runPublishJob } from '../src/lib/queue/publish-job';

let failures = 0;
const ok = (m: string) => console.log('  PASS ' + m);
const bad = (m: string) => { failures++; console.log('  FAIL ' + m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOCK_PORT = Number(process.env.MOCK_PORT || 4321);
const HOST = `localhost:${MOCK_PORT}`;
const TEST_ID = 'v-worker-test';

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

  if (!(await reachable(`http://${HOST}/__posts`))) {
    console.log(`\n  SKIP mock instance not running — start it with:\n        node scripts/mock-mastodon.js ${MOCK_PORT}\n`);
    return;
  }

  console.log('\n== Worker: a scheduled post publishes with nothing watching ==');

  // A grant pointing at the mock instance. The publisher reads host and limit
  // from externalAccountId, which is where per-instance facts live.
  saveGrant({
    channel: 'mastodon',
    accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
    refreshToken: null,
    expiresInSec: null,
    scopes: ['write:statuses'],
    accountLabel: '@greenscape',
    externalAccountId: `${HOST}|1|500`,
  });
  // The workspace row is the other half of "connected", and it is what
  // preflight reads at fire time — connecting through the UI writes both.
  await reconcileAccount({
    channel: 'mastodon',
    accountLabel: '@greenscape',
    externalAccountId: `${HOST}|1|500`,
    scopes: ['write:statuses'],
    expiresAt: null,
  });

  // A post due 5 seconds from now, on a real campaign so preflight has
  // something to check against.
  const item = await db.contentItem.findFirst({ where: { campaign: { status: 'ACTIVE' } } });
  if (!item) return bad('no content item to attach a test post to');

  const dueAt = new Date(Date.now() + 5_000);
  await db.publicationAttempt.deleteMany({ where: { variationId: TEST_ID } });
  await db.publishedPost.deleteMany({ where: { variationId: TEST_ID } });
  await db.channelVariation.deleteMany({ where: { id: TEST_ID } });
  await db.channelVariation.create({
    data: {
      id: TEST_ID, contentItemId: item.id, channel: 'MASTODON', format: 'update',
      status: 'APPROVED', scheduledAt: dueAt,
      body: 'Fall cleanup slots are open — book before the leaves win. https://greenscapenj.com/fall',
      hashtags: ['#fallcleanup'], hasUnsubscribeFooter: false,
    },
  });
  // Drop any queued job from an earlier run so this is a clean fire.
  await publishQueue().remove(slotKey(TEST_ID, dueAt)).catch(() => {});

  const before = await fetch(`http://${HOST}/__posts`).then((r) => r.json());

  // Start the worker exactly as an operator would.
  const worker = spawn('npx', ['tsx', 'worker.ts'], {
    env: { ...process.env, SCAN_INTERVAL_MS: '2000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  worker.stdout.on('data', (d) => lines.push(String(d).trim()));
  worker.stderr.on('data', (d) => lines.push('ERR ' + String(d).trim()));

  // Wait for the post to go out, checking as we go rather than sleeping blind.
  let published = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const v = await db.channelVariation.findUnique({ where: { id: TEST_ID } });
    if (v?.status === 'PUBLISHED' || v?.status === 'FAILED') { published = v; break; }
  }

  worker.kill('SIGTERM');
  await sleep(600);

  if (!published) {
    bad('post never resolved within 30s');
    console.log('  worker log:\n    ' + lines.join('\n    '));
  } else {
    published.status === 'PUBLISHED'
      ? ok(`post published on its own at ${published.publishedAt?.toISOString().slice(11, 19)} (due ${dueAt.toISOString().slice(11, 19)})`)
      : bad(`post ended FAILED — worker log:\n    ${lines.join('\n    ')}`);
  }

  const after = await fetch(`http://${HOST}/__posts`).then((r) => r.json());
  after.count === before.count + 1
    ? ok('exactly one status reached the instance')
    : bad(`expected 1 new status, got ${after.count - before.count}`);

  const post = await db.publishedPost.findUnique({ where: { variationId: TEST_ID } });
  post?.url ? ok(`PublishedPost row recorded (${post.url})`) : bad('no PublishedPost row');

  const attempts = await db.publicationAttempt.findMany({ where: { variationId: TEST_ID } });
  attempts.length === 1 && attempts[0].success
    ? ok('one successful PublicationAttempt recorded')
    : bad(`expected 1 successful attempt, got ${attempts.length}`);
  attempts[0]?.finishedAt ? ok('attempt has a finish time') : bad('attempt never finished');

  const audit = await db.auditEvent.findFirst({
    where: { target: TEST_ID, action: 'publish.succeeded' },
  });
  audit ? ok('audit row explains what happened') : bad('no audit row for the publish');

  // Idempotency: replaying the same slot must not produce a second status.
  const replay = await runPublishJob({ variationId: TEST_ID, idempotencyKey: slotKey(TEST_ID, dueAt) });
  const afterReplay = await fetch(`http://${HOST}/__posts`).then((r) => r.json());
  replay.status === 'skipped' && afterReplay.count === after.count
    ? ok(`replaying the same job posts nothing new (${replay.detail})`)
    : bad(`replay produced ${afterReplay.count - after.count} extra status(es), result ${replay.status}`);

  await cleanup();

  // ---------------------------------------------------------------------
  console.log('\n== Failure surfaces: kill a token mid-flight ==');
  // The Phase 1.5 acceptance test. A revoked token is the most common real
  // failure in this product, and the thing that has to work is not the
  // failing — it is what the owner sees afterwards and whether the fix fixes.
  const failAt = new Date(Date.now() - 1000);
  await db.channelVariation.create({
    data: {
      id: TEST_ID, contentItemId: item.id, channel: 'MASTODON', format: 'update',
      status: 'APPROVED', scheduledAt: failAt,
      body: 'This one is going out with a dead token.',
      hashtags: [], hasUnsubscribeFooter: false,
    },
  });

  // Revoke: keep the workspace row connected (so preflight lets it through)
  // and break the credential, which is exactly what a revoked token looks
  // like from here — valid yesterday, 401 today.
  saveGrant({
    channel: 'mastodon',
    accessToken: 'revoked-token',
    refreshToken: null,
    expiresInSec: null,
    scopes: ['write:statuses'],
    accountLabel: '@greenscape',
    externalAccountId: `${HOST}|1|500`,
  });
  await reconcileAccount({
    channel: 'mastodon', accountLabel: '@greenscape',
    externalAccountId: `${HOST}|1|500`, scopes: ['write:statuses'], expiresAt: null,
  });

  const failKey = slotKey(TEST_ID, failAt);
  const failed = await runPublishJob({ variationId: TEST_ID, idempotencyKey: failKey });
  failed.status === 'failed' ? ok(`publish failed as expected (${failed.detail})`) : bad(`expected failure, got ${failed.status}`);
  failed.retryable === false
    ? ok('a revoked token is classified terminal, not retryable')
    : bad('a revoked token was marked retryable — retries cannot fix it');

  const row = await db.channelVariation.findUnique({ where: { id: TEST_ID } });
  row?.status === 'FAILED' ? ok('post is marked failed') : bad(`status is ${row?.status}, expected FAILED`);
  row?.claimedAt === null ? ok('claim released on failure') : bad('failed post still holds its claim');

  const failAttempt = await db.publicationAttempt.findFirst({ where: { variationId: TEST_ID } });
  failAttempt?.errorCode === 'auth_expired'
    ? ok(`attempt recorded the reason (${failAttempt.errorCode})`)
    : bad(`expected errorCode auth_expired, got ${failAttempt?.errorCode}`);
  failAttempt?.errorMessage ? ok('attempt carries a human-readable message') : bad('no error message stored');

  const failAudit = await db.auditEvent.findFirst({ where: { target: TEST_ID, action: 'publish.failed' } });
  failAudit ? ok('audit row records the failure') : bad('no audit row for the failure');

  // The read path is what Home renders from, so this is the real check that
  // the failure reaches the screen — not that a row exists somewhere.
  const { loadWorkspace } = await import('../src/lib/queries');
  const { ORG } = await import('../src/lib/demo-data');
  const w = await loadWorkspace(ORG.id);
  const onScreen = w.variations.find((v) => v.id === TEST_ID);
  onScreen?.failure?.code === 'auth_expired'
    ? ok('failure surfaces through the read path with its code, so Home offers the right fix')
    : bad(`read path shows failure ${JSON.stringify(onScreen?.failure)}`);

  // And the fix has to work. Restore the token, retry, and it should publish.
  saveGrant({
    channel: 'mastodon',
    accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
    refreshToken: null, expiresInSec: null, scopes: ['write:statuses'],
    accountLabel: '@greenscape', externalAccountId: `${HOST}|1|500`,
  });
  await db.channelVariation.update({ where: { id: TEST_ID }, data: { status: 'SCHEDULED', claimedAt: null } });
  const fixed = await runPublishJob({ variationId: TEST_ID, idempotencyKey: failKey });
  fixed.status === 'published'
    ? ok('after reconnecting, the retry publishes — the fix actually fixes')
    : bad(`retry after fix gave ${fixed.status}: ${fixed.detail}`);

  const attemptsNow = await db.publicationAttempt.findMany({ where: { variationId: TEST_ID }, orderBy: { attemptNumber: 'asc' } });
  attemptsNow.length === 2 && attemptsNow[0].success === false && attemptsNow[1].success === true
    ? ok('both attempts recorded, in order, with their outcomes')
    : bad(`expected a failed then a successful attempt, got ${attemptsNow.map((a) => a.success).join(',')}`);

  await cleanup();
}

/** Leave the demo workspace exactly as found, so the suite re-runs. */
async function cleanup() {
  await db.publicationAttempt.deleteMany({ where: { variationId: TEST_ID } });
  await db.publishedPost.deleteMany({ where: { variationId: TEST_ID } });
  await db.auditEvent.deleteMany({ where: { target: TEST_ID } });
  await db.channelVariation.deleteMany({ where: { id: TEST_ID } });
  removeGrant('mastodon');
  await reconcileDisconnect('mastodon');
  await publishQueue().obliterate({ force: true }).catch(() => {});
}

main()
  .catch((e) => { bad(`threw: ${(e as Error).message}`); })
  .finally(async () => {
    await db.$disconnect();
    await publishQueue().close().catch(() => {});
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nWORKER CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  });
