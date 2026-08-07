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
const MOCK = `http://${HOST}`;
const TEST_ID = 'v-worker-test';
const ORG_ID = 'org-1';

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

  // Start from a known state: the mock honours idempotency keys the way real
  // Mastodon does, so a key left over from a run in the same minute would make
  // a genuine publish look like it did nothing.
  await fetch(`http://${HOST}/__reset`, { method: 'POST' });

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
    organizationId: ORG_ID,
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

  await db.metric.deleteMany({ where: { variationId: TEST_ID } });
  await db.publicationAttempt.deleteMany({ where: { variationId: TEST_ID } });
  await db.publishedPost.deleteMany({ where: { variationId: TEST_ID } });
  await db.channelVariation.deleteMany({ where: { id: TEST_ID } });

  const before = await fetch(`http://${HOST}/__posts`).then((r) => r.json());

  // Start the worker exactly as an operator would.
  const worker = spawn('npx', ['tsx', 'worker.ts'], {
    env: { ...process.env, SCAN_INTERVAL_MS: '2000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  let up = false;
  worker.stdout.on('data', (d) => {
    const t = String(d).trim();
    lines.push(t);
    if (t.includes('worker up')) up = true;
  });
  worker.stderr.on('data', (d) => lines.push('ERR ' + String(d).trim()));

  // Wait for the worker to actually be listening before scheduling anything.
  // `npx tsx` cold-starts in seconds, and counting that against the publish
  // window made this test fail intermittently under load — a flaky test is
  // worse than no test, because it teaches you to re-run instead of read.
  for (let i = 0; i < 60 && !up; i++) await sleep(500);
  up ? ok('worker started') : bad(`worker never came up: ${lines.join(' | ')}`);

  const dueAt = new Date(Date.now() + 3_000);
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
    organizationId: ORG_ID,
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

  await metricsSection();

  await cleanup();
}

/**
 * Phase 11 — the platform's own numbers, and the ones it will never give.
 *
 * The post published above is still up on the stand-in, so this reads it back
 * the way the refresher does in production.
 */
async function metricsSection() {
  console.log('\n== Reading the numbers back off the platform ==');

  const { refreshPlatformMetrics } = await import('../src/lib/metrics');
  const { measurabilityOf } = await import('../src/lib/measurability');

  const post = await db.publishedPost.findUnique({ where: { variationId: TEST_ID } });
  if (!post) return bad('nothing was published, so there is nothing to measure');

  // Give the post some engagement the platform will report.
  await fetch(`${MOCK}/__engage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: post.externalId, favourites: 7, reblogs: 3, replies: 2 }),
  });

  const first = await refreshPlatformMetrics(ORG_ID);
  first.written === 1
    ? ok(`read one post's numbers off the platform (attempted ${first.attempted})`)
    : bad(`expected 1 reading, got ${first.written} of ${first.attempted}: ${JSON.stringify(first.failed)}`);

  const reading = await db.metric.findFirst({
    where: { variationId: TEST_ID },
    orderBy: { capturedAt: 'desc' },
  });

  reading?.engagements === 12
    ? ok('engagement is the sum of favourites, boosts and replies (7+3+2 = 12)')
    : bad(`expected 12 engagements, got ${reading?.engagements}`);

  // The check this whole phase exists for. Mastodon does not report reach to
  // anybody, so a 0 here would be the product inventing a number that says
  // nobody saw the post.
  reading?.impressions === null
    ? ok('impressions are null, not zero — Mastodon reports no view count at all')
    : bad(`impressions came back as ${reading?.impressions}, which claims a reach nobody reported`);

  reading?.source === 'mastodon'
    ? ok('the reading records which platform said it')
    : bad(`source is ${reading?.source}`);

  // And the availability answer has to say *why*, not just that it is missing.
  const avail = measurabilityOf('mastodon', 'impressions', { connected: ['mastodon'] });
  avail.state === 'unavailable'
    ? ok(`a permanently missing number is marked unavailable, not "not connected"`)
    : bad(`state is ${avail.state} — an owner would go looking for a setting that does not exist`);
  /does not report/.test(avail.reason)
    ? ok(`and says so in words: ${avail.reason}`)
    : bad(`reason reads "${avail.reason}"`);

  // Email is the opposite case: measured, with no platform involved.
  const emailAvail = measurabilityOf('email', 'impressions', { connected: [] });
  emailAvail.state === 'measured'
    ? ok('email impressions are measured — we know exactly what was delivered')
    : bad(`email impressions reported as ${emailAvail.state}, which is the bug this phase fixes`);

  // A channel nobody connected but which does report is a third thing again.
  const fbAvail = measurabilityOf('facebook', 'impressions', { connected: [] });
  fbAvail.state === 'not_ingested'
    ? ok('a channel that reports but has no reader is marked as our gap, not the platform\'s')
    : bad(`facebook impressions reported as ${fbAvail.state}`);

  // A deleted post stops being asked about.
  await fetch(`${MOCK}/__delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: post.externalId }),
  });

  const second = await refreshPlatformMetrics(ORG_ID);
  second.missing === 1
    ? ok('a deleted post is recorded as gone rather than reported as an error')
    : bad(`expected 1 missing, got ${second.missing} missing / ${second.failed.length} failed`);

  const third = await refreshPlatformMetrics(ORG_ID);
  third.attempted === 0
    ? ok('and is not asked about again — a deleted post does not come back')
    : bad(`re-asked ${third.attempted} times about a post that is gone`);

  // The hardening this section taught us. A post the platform has never
  // confirmed must not be tombstoned on a single 404 — that is what happened
  // when the stand-in was an older build without the endpoint, and it silently
  // stopped every future reading.
  await db.metric.deleteMany({ where: { variationId: TEST_ID } });
  const neverSeen = await refreshPlatformMetrics(ORG_ID);
  neverSeen.missing === 0 && neverSeen.failed.length === 1
    ? ok('a 404 on a post we have never read is an error, not a deletion')
    : bad(`expected 1 failure and 0 missing, got ${neverSeen.failed.length} / ${neverSeen.missing}`);
  (await db.metric.count({ where: { variationId: TEST_ID, postMissing: true } })) === 0
    ? ok('and writes no tombstone, so a fixed endpoint starts working again')
    : bad('wrote a permanent "gone" marker on the strength of one 404');

  // The last good reading must not be read as current.
  const { computePerformance } = await import('../src/lib/analytics');
  const perf = await computePerformance(ORG_ID);
  const stale = perf.performance.flatMap((p) => p.byChannel).find((c) => c.channel === 'mastodon');
  stale === undefined || stale.engagements === null
    ? ok('a gone post drops out of the report instead of showing its last known figures')
    : bad(`report still shows ${stale.engagements} engagements for a deleted post`);

  await db.metric.deleteMany({ where: { variationId: TEST_ID } });
}

/** Leave the demo workspace exactly as found, so the suite re-runs. */
async function cleanup() {
  await db.publicationAttempt.deleteMany({ where: { variationId: TEST_ID } });
  await db.publishedPost.deleteMany({ where: { variationId: TEST_ID } });
  await db.auditEvent.deleteMany({ where: { target: TEST_ID } });
  await db.channelVariation.deleteMany({ where: { id: TEST_ID } });
  removeGrant('mastodon');
  await reconcileDisconnect(ORG_ID, 'mastodon');
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
