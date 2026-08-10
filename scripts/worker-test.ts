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

  await facebookSection();

  await mediaSection();

  await metaFamilySection();

  await listenSection();

  await tierSection();

  await replySection();

  await feasibleSection();

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
  const liAvail = measurabilityOf('linkedin', 'impressions', { connected: [] });
  liAvail.state === 'not_ingested'
    ? ok('a channel that reports but has no reader is marked as our gap, not the platform\'s')
    : bad(`linkedin impressions reported as ${liAvail.state}`);

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


/**
 * Phase 12 — the first fit-ranked publisher, and the first real reach number.
 *
 * The ranking has recommended Facebook to the modelled industries since Phase
 * 5, while the registry could not publish there. This exercises the real
 * adapter over a real HTTP round trip against a stand-in Graph API — and the
 * part that moves the product: `post_impressions` comes back as a number, the
 * first channel where reach is not an honest null.
 */
async function facebookSection() {
  console.log('\n== Facebook: publish through the Graph API, and read reach back ==');

  const META = process.env.META_BASE_URL || 'http://localhost:4325';
  const up = await fetch(`${META}/__posts`).then((r) => r.ok).catch(() => false);
  if (!up) {
    if (process.env.META_BASE_URL) return bad('META_BASE_URL set but mock-meta is not running');
    return bad('mock-meta is not running — start it with: npm run mock:meta');
  }
  await fetch(`${META}/__reset`, { method: 'POST' });

  const { facebookPublisher } = await import('../src/lib/publishers/meta');
  const { canPublish } = await import('../src/lib/publishers/registry');
  const { measurabilityOf } = await import('../src/lib/measurability');

  canPublish('facebook') === false
    ? ok('with no grant, facebook is honestly not publishable')
    : bad('canPublish(facebook) true with nothing connected');

  saveGrant({
    channel: 'facebook',
    accessToken: process.env.MOCK_META_TOKEN || 'mock-page-token',
    refreshToken: null, expiresInSec: null, scopes: ['pages_manage_posts'],
    accountLabel: 'Summit Local (Page)',
    externalAccountId: process.env.MOCK_META_PAGE_ID || '108000000001',
  });

  try {
    canPublish('facebook') ? ok('with a grant, facebook is publishable') : bad('grant not seen by canPublish');

    const posted = await facebookPublisher.publish('Spring cleanups are booking now. Flat quotes, no site visit.', {});
    posted.ok ? ok(`published to the Page (${posted.id})`) : bad(`publish failed: ${posted.error}`);
    const wire = await fetch(`${META}/__posts`).then((r) => r.json());
    wire.count === 1 ? ok('exactly one post reached the platform') : bad(`platform saw ${wire.count}`);

    // The platform reports numbers — set them, read them through the adapter.
    await fetch(`${META}/__insights`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: posted.id, post_impressions: 4180, reactions: 23, comments: 5, shares: 4 }),
    });
    const m = await facebookPublisher.fetchMetrics!(posted.id!);
    m.ok && m.metrics?.impressions === 4180
      ? ok('impressions come back as a number (4,180) — the first channel where reach is real')
      : bad(`impressions: ${JSON.stringify(m)}`);
    m.metrics?.engagements === 32
      ? ok('engagement sums reactions, comments and shares (23+5+4 = 32)')
      : bad(`engagements: ${m.metrics?.engagements}`);

    measurabilityOf('facebook', 'impressions', { connected: ['facebook'] }).state === 'measured'
      ? ok('the report marks connected Facebook impressions measured')
      : bad('measurability disagrees with the reader that exists');

    // A revoked token is a reconnect, not a retry.
    await fetch(`${META}/__revoke`, { method: 'POST' });
    const dead = await facebookPublisher.publish('This one should be refused.', {});
    !dead.ok && dead.needsReconnect
      ? ok('Graph code 190 is classified as reconnect, not retry')
      : bad(`revoked publish: ${JSON.stringify(dead)}`);
  } finally {
    removeGrant('facebook');
  }
}


/**
 * Phase 13 — pictures through the pipe.
 *
 * The library has stored and alt-texted images since the media phase, and
 * nothing it held could reach a platform: every publisher was text-only,
 * which blocked Instagram outright and made "upload" a promise about a
 * database. This drives an image through each live adapter over the wire,
 * and checks the property that is easiest to lose: the alt text survives to
 * the platform, where it does its job.
 */
async function mediaSection() {
  console.log('\n== An image travels with the post, alt text and all ==');

  const fakePng = new TextEncoder().encode('not-really-a-png-but-137-bytes-of-stand-in-image-payload-' + 'x'.repeat(79));
  const media = [{ bytes: fakePng, mime: 'image/png', altText: 'A crew mulching a garden bed at dusk' }];

  // Mastodon — against the mock already running for the worker sections.
  {
    const { mastodonPublisher } = await import('../src/lib/publishers/mastodon');
    saveGrant({
      channel: 'mastodon',
      accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
      refreshToken: null, expiresInSec: null, scopes: ['write:statuses', 'write:media'],
      accountLabel: '@greenscape', externalAccountId: `${HOST}|1|500`,
    });
    try {
      const out = await mastodonPublisher.publish('New beds going in this week.', { media });
      out.ok ? ok('mastodon: photo post published') : bad(`mastodon publish failed: ${out.error}`);
      const wire = await fetch(`${MOCK}/__posts`).then((r) => r.json());
      const last = wire.posts[wire.posts.length - 1];
      last?.media_attachments?.length === 1
        ? ok('mastodon: the status carries its attachment')
        : bad(`mastodon attachments: ${JSON.stringify(last?.media_attachments)}`);
      last?.media_attachments?.[0]?.description === media[0].altText
        ? ok('mastodon: alt text survived as description')
        : bad(`mastodon description: ${last?.media_attachments?.[0]?.description}`);
    } finally {
      removeGrant('mastodon');
    }
  }

  // Bluesky — against its own stand-in PDS.
  {
    const BSKY = process.env.BLUESKY_PDS_URL || 'http://localhost:4326';
    const up = await fetch(`${BSKY}/__posts`).then((r) => r.ok).catch(() => false);
    if (!up) {
      bad('mock-bluesky is not running — start it with: node scripts/mock-bluesky.js');
    } else {
      await fetch(`${BSKY}/__reset`, { method: 'POST' });
      process.env.BLUESKY_PDS_URL = BSKY;
      const { publishToBluesky } = await import('../src/lib/publishers/bluesky');
      saveGrant({
        channel: 'bluesky',
        accessToken: process.env.MOCK_BSKY_TOKEN || 'mock-bsky-access-jwt',
        refreshToken: 'mock-refresh', expiresInSec: 7200, scopes: ['app-password session'],
        accountLabel: '@greenscape.bsky.social', externalAccountId: 'did:plc:mockmockmock',
      });
      try {
        const out = await publishToBluesky('New beds going in this week.', {
          did: 'did:plc:mockmockmock', handle: 'greenscape.bsky.social', media,
        });
        out.ok ? ok('bluesky: photo post published') : bad(`bluesky publish failed: ${out.error}`);
        const wire = await fetch(`${BSKY}/__posts`).then((r) => r.json());
        const rec = wire.records[wire.records.length - 1];
        rec?.embed?.$type === 'app.bsky.embed.images' && rec.embed.images?.length === 1
          ? ok('bluesky: the record embeds the uploaded blob')
          : bad(`bluesky embed: ${JSON.stringify(rec?.embed)?.slice(0, 120)}`);
        rec?.embed?.images?.[0]?.alt === media[0].altText
          ? ok('bluesky: alt text survived — required by the embed schema itself')
          : bad(`bluesky alt: ${rec?.embed?.images?.[0]?.alt}`);
      } finally {
        removeGrant('bluesky');
      }
    }
  }

  // Facebook — the photos edge, where the text becomes the caption.
  {
    const META = process.env.META_BASE_URL || 'http://localhost:4325';
    const { facebookPublisher } = await import('../src/lib/publishers/meta');
    await fetch(`${META}/__reset`, { method: 'POST' });
    saveGrant({
      channel: 'facebook',
      accessToken: process.env.MOCK_META_TOKEN || 'mock-page-token',
      refreshToken: null, expiresInSec: null, scopes: ['pages_manage_posts'],
      accountLabel: 'Summit Local (Page)',
      externalAccountId: process.env.MOCK_META_PAGE_ID || '108000000001',
    });
    try {
      const out = await facebookPublisher.publish('New beds going in this week.', { media });
      out.ok ? ok('facebook: photo post published via the /photos edge') : bad(`facebook publish failed: ${out.error}`);
      const wire = await fetch(`${META}/__posts`).then((r) => r.json());
      const last = wire.posts[wire.posts.length - 1];
      last?.photo === true && last?.message === 'New beds going in this week.'
        ? ok('facebook: the text rode as the photo caption')
        : bad(`facebook post: ${JSON.stringify(last)?.slice(0, 120)}`);
      last?.altText === media[0].altText
        ? ok('facebook: alt text survived the multipart trip')
        : bad(`facebook alt: ${last?.altText}`);
      last?.bytes === fakePng.length
        ? ok(`facebook: every byte arrived (${last.bytes})`)
        : bad(`facebook bytes: sent ${fakePng.length}, platform saw ${last?.bytes}`);
    } finally {
      removeGrant('facebook');
    }
  }

  // The other half of the acceptance: an approved image that has vanished
  // from storage fails the job before anything reaches a platform. A
  // text-only post standing in for a photo post is not a smaller version of
  // it — it is a different post nobody approved.
  {
    const { runPublishJob } = await import('../src/lib/queue/publish-job');
    const item = await db.contentItem.findFirst({ select: { id: true, campaign: { select: { organizationId: true } } } });
    if (!item) {
      bad('no content item to attach the missing-media check to');
    } else {
      const vid = 'v-media-missing-test';
      await db.channelVariation.deleteMany({ where: { id: vid } });
      await db.channelVariation.create({
        data: {
          id: vid, contentItemId: item.id, channel: 'MASTODON', format: 'update',
          status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 1000),
          body: 'This post should never leave the building.', hashtags: [], hasUnsubscribeFooter: false,
        },
      });
      const ghost = await db.mediaAsset.create({
        data: {
          organizationId: item.campaign.organizationId, kind: 'image',
          storageKey: 'aa/aa/' + '0'.repeat(64) + '.png', fileName: 'ghost.png',
          mimeType: 'image/png', sizeBytes: 1, altText: 'A file that is not there',
        },
      });
      await db.variationMedia.create({ data: { variationId: vid, assetId: ghost.id } });
      saveGrant({
        channel: 'mastodon', accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
        refreshToken: null, expiresInSec: null, scopes: ['write:statuses'],
        accountLabel: '@greenscape', externalAccountId: `${HOST}|1|500`,
      });
      try {
        const before = (await fetch(`${MOCK}/__posts`).then((r) => r.json())).count;
        const out = await runPublishJob({ variationId: vid, idempotencyKey: `missing-media-${vid}` });
        out.status === 'failed' && /missing/.test(out.detail)
          ? ok(`a vanished image fails the job (${out.detail})`)
          : bad(`expected media failure, got ${out.status}: ${out.detail}`);
        const after = (await fetch(`${MOCK}/__posts`).then((r) => r.json())).count;
        after === before
          ? ok('and nothing reached the platform — no text-only stand-in was posted')
          : bad('a post went out despite the missing image');
      } finally {
        removeGrant('mastodon');
        await db.publicationAttempt.deleteMany({ where: { variationId: vid } });
        await db.variationMedia.deleteMany({ where: { variationId: vid } });
        await db.mediaAsset.delete({ where: { id: ghost.id } }).catch(() => {});
        await db.channelVariation.deleteMany({ where: { id: vid } });
      }
    }
  }
}


/**
 * Phase 14 — Instagram and Threads, the two-step half of the Meta family.
 *
 * Same container → publish dance, opposite relationships to media: an
 * Instagram feed post *is* a photo and the API has no caption-only shape,
 * while Threads is text-first with images optional. The refusals are as much
 * the product as the successes.
 */
async function metaFamilySection() {
  console.log('\n== Instagram and Threads: the two-step, and honest refusals ==');

  const META = process.env.META_BASE_URL || 'http://localhost:4325';
  process.env.THREADS_BASE_URL = META;
  await fetch(`${META}/__reset`, { method: 'POST' });

  const { instagramPublisher, threadsPublisher } = await import('../src/lib/publishers/meta-family');
  const { measurabilityOf } = await import('../src/lib/measurability');

  const bytes = new TextEncoder().encode('stand-in-image-bytes');
  const withUrl = [{ bytes, mime: 'image/jpeg', altText: 'Fresh mulch, ready to spread', publicUrl: 'https://media.example.test/mulch.jpg' }];

  saveGrant({
    channel: 'instagram', accessToken: process.env.MOCK_META_TOKEN || 'mock-page-token',
    refreshToken: null, expiresInSec: null, scopes: ['instagram_content_publish'],
    accountLabel: '@summitlocal', externalAccountId: process.env.MOCK_META_IG_ID || '17840000000001',
  });
  saveGrant({
    channel: 'threads', accessToken: process.env.MOCK_META_TOKEN || 'mock-page-token',
    refreshToken: null, expiresInSec: null, scopes: ['threads_content_publish'],
    accountLabel: '@summitlocal', externalAccountId: process.env.MOCK_META_THREADS_ID || '9990000000001',
  });

  try {
    // The Instagram refusals, which are facts about the platform.
    const noMedia = await instagramPublisher.publish('A caption with no photo.', {});
    !noMedia.ok && /no text-only posts/.test(noMedia.error ?? '')
      ? ok('instagram refuses a text-only post, in words about the platform')
      : bad(`text-only IG: ${JSON.stringify(noMedia).slice(0, 120)}`);

    const noUrl = await instagramPublisher.publish('A photo with no public address.', {
      media: [{ bytes, mime: 'image/jpeg', altText: null }],
    });
    !noUrl.ok && /public URL/.test(noUrl.error ?? '')
      ? ok('instagram refuses an unfetchable image instead of handing Meta localhost')
      : bad(`no-url IG: ${JSON.stringify(noUrl).slice(0, 120)}`);

    // The real thing: container, then publish.
    const igPost = await instagramPublisher.publish('New beds going in this week.', { media: withUrl });
    igPost.ok ? ok(`instagram: two-step publish landed (${igPost.id})`) : bad(`IG publish: ${igPost.error}`);
    const wire1 = await fetch(`${META}/__posts`).then((r) => r.json());
    const ig = wire1.posts.find((p: { id: string }) => String(p.id).startsWith('instagram_'));
    ig?.imageUrl === withUrl[0].publicUrl && ig?.text === 'New beds going in this week.'
      ? ok('instagram: the container carried the image url and caption')
      : bad(`IG wire: ${JSON.stringify(ig).slice(0, 140)}`);
    ig?.altText === withUrl[0].altText
      ? ok('instagram: alt text survived')
      : bad(`IG alt: ${ig?.altText}`);

    // Threads: text-first.
    const thText = await threadsPublisher.publish('Quick note: we are booking spring slots.', {});
    thText.ok ? ok(`threads: a text-only post is a post (${thText.id})`) : bad(`threads text: ${thText.error}`);

    const thImg = await threadsPublisher.publish('And a photo.', { media: withUrl });
    thImg.ok ? ok('threads: with an image when one is fetchable') : bad(`threads image: ${thImg.error}`);

    // Metrics: views are Threads' name for reach; both come back as numbers.
    await fetch(`${META}/__insights`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: thText.id, views: 903, likes: 12, replies: 3, reposts: 2, quotes: 1 }),
    });
    const tm = await threadsPublisher.fetchMetrics!(thText.id!);
    tm.ok && tm.metrics?.impressions === 903 && tm.metrics?.engagements === 18
      ? ok('threads: views 903 and engagement 18 read back through the adapter')
      : bad(`threads metrics: ${JSON.stringify(tm)}`);

    await fetch(`${META}/__insights`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: igPost.id, impressions: 2411, likes: 41, comments: 6, shares: 2 }),
    });
    const im = await instagramPublisher.fetchMetrics!(igPost.id!);
    im.ok && im.metrics?.impressions === 2411 && im.metrics?.engagements === 49
      ? ok('instagram: impressions 2,411 and engagement 49 read back')
      : bad(`IG metrics: ${JSON.stringify(im)}`);

    measurabilityOf('instagram', 'impressions', { connected: ['instagram'] }).state === 'measured' &&
    measurabilityOf('threads', 'impressions', { connected: ['threads'] }).state === 'measured'
      ? ok('the report marks both channels measured once connected')
      : bad('measurability disagrees with the readers that exist');
  } finally {
    removeGrant('instagram');
    removeGrant('threads');
  }
}


/**
 * Phase 15 — the product can hear.
 *
 * Publishing without listening is a megaphone: for eleven phases the only
 * thing that ever wrote a social conversation was the seed. This stages a
 * Mastodon mention and a Bluesky reply on the stand-ins, polls through the
 * real listener, and checks the three properties that matter — words arrive,
 * likes do not, and polling twice cannot write twice.
 */
async function listenSection() {
  console.log('\n== Replies reach the inbox, and a like is not a conversation ==');

  const BSKY = process.env.BLUESKY_PDS_URL || 'http://localhost:4326';
  await fetch(`${MOCK}/__reset`, { method: 'POST' });
  await fetch(`${BSKY}/__reset`, { method: 'POST' });

  const { pollSocialInbox } = await import('../src/lib/listen');

  saveGrant({
    channel: 'mastodon', accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
    refreshToken: null, expiresInSec: null, scopes: ['read:notifications'],
    accountLabel: '@greenscape', externalAccountId: `${HOST}|1|500`,
  });
  saveGrant({
    channel: 'bluesky', accessToken: process.env.MOCK_BSKY_TOKEN || 'mock-bsky-access-jwt',
    refreshToken: 'mock-refresh', expiresInSec: 7200, scopes: ['app-password session'],
    accountLabel: '@greenscape.bsky.social', externalAccountId: 'did:plc:mockmockmock',
  });

  try {
    await fetch(`${MOCK}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'mention', from: 'Dana Whitfield', text: 'Do you service the north side? Would love a quote.', statusId: 777001 }),
    });
    await fetch(`${MOCK}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'favourite', from: 'A Fan', statusId: 777002 }),
    });
    await fetch(`${BSKY}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'reply', from: 'Marcus Cole', text: 'Booked for Tuesday - thanks!', uri: 'at://did:plc:marcus/app.bsky.feed.post/replyone' }),
    });
    await fetch(`${BSKY}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'like', from: 'Quiet Fan' }),
    });

    const before = await db.conversation.count({ where: { organizationId: ORG_ID, channel: { in: ['MASTODON', 'BLUESKY'] } } });
    const first = await pollSocialInbox(ORG_ID);
    first.created === 2
      ? ok('two conversations arrived: a Mastodon mention and a Bluesky reply')
      : bad(`created ${first.created}, errors: ${JSON.stringify(first.errors)}`);

    const rows = await db.conversation.findMany({
      where: { organizationId: ORG_ID, channel: { in: ['MASTODON', 'BLUESKY'] }, externalRef: { not: null } },
      orderBy: { receivedAt: 'desc' },
    });
    rows.some((r) => r.fromName === 'Dana Whitfield' && /north side/.test(r.excerpt) && r.channel === 'MASTODON')
      ? ok('the mention carries who said it and what they said, HTML stripped')
      : bad(`mastodon row: ${JSON.stringify(rows.find((r) => r.channel === 'MASTODON'))?.slice(0, 140)}`);
    rows.some((r) => r.fromName === 'Marcus Cole' && r.kind === 'comment' && r.channel === 'BLUESKY')
      ? ok('the reply landed as a comment from its author')
      : bad('bluesky reply missing or mislabelled');
    !rows.some((r) => /Fan/.test(r.fromName))
      ? ok('a like is engagement, not mail — the inbox does not ask you to answer a heart')
      : bad('a like became a conversation');

    const second = await pollSocialInbox(ORG_ID);
    second.created === 0 && second.duplicates >= 2
      ? ok(`polling again writes nothing (${second.duplicates} already seen) — no cursor to corrupt`)
      : bad(`second poll created ${second.created}`);

    const audit = await db.auditEvent.findFirst({
      where: { organizationId: ORG_ID, action: 'inbox.polled' },
      orderBy: { at: 'desc' },
    });
    audit ? ok(`the poll left its visible last-run (${audit.detail})`) : bad('no inbox.polled audit row');

    // The metrics side of "the product can hear": refresh writes its own
    // last-run, and the report carries it as "as of".
    await refreshMetricsProof();

    // Cleanup the staged conversations.
    await db.conversation.deleteMany({
      where: { organizationId: ORG_ID, externalRef: { in: rows.map((r) => r.externalRef!).filter(Boolean) } },
    });
    void before;
  } finally {
    removeGrant('mastodon');
    removeGrant('bluesky');
  }
}

async function refreshMetricsProof() {
  const { refreshPlatformMetrics } = await import('../src/lib/metrics');
  const { computePerformance } = await import('../src/lib/analytics');
  await refreshPlatformMetrics(ORG_ID);
  const audit = await db.auditEvent.findFirst({
    where: { organizationId: ORG_ID, action: 'metrics.refreshed' },
    orderBy: { at: 'desc' },
  });
  audit ? ok(`metrics refresh leaves its last-run too (${audit.detail})`) : bad('no metrics.refreshed audit row');
  const perf = await computePerformance(ORG_ID);
  perf.meta.metricsAsOf && Date.now() - new Date(perf.meta.metricsAsOf).getTime() < 60_000
    ? ok('and the report says when its numbers are from — a stale number can look stale')
    : bad(`metricsAsOf: ${perf.meta.metricsAsOf}`);
}


/**
 * Phase 17 — the registry widens, and the gaps say which kind of gap they are.
 */
async function tierSection() {
  console.log('\n== Reddit publishes, and every gap names its kind ==');

  const REDDIT = process.env.REDDIT_BASE_URL || 'http://localhost:4327';
  const up = await fetch(`${REDDIT}/__posts`).then((r) => r.ok).catch(() => false);
  if (!up) return bad('mock-reddit is not running — node scripts/mock-reddit.js');
  await fetch(`${REDDIT}/__reset`, { method: 'POST' });

  const { redditPublisher } = await import('../src/lib/publishers/reddit');
  const { publisherTier } = await import('../src/lib/publishers/tiers');

  saveGrant({
    channel: 'reddit', accessToken: process.env.MOCK_REDDIT_TOKEN || 'mock-reddit-token',
    refreshToken: null, expiresInSec: null, scopes: ['submit'],
    accountLabel: 'r/summitlocal', externalAccountId: 'summitlocal',
  });
  try {
    const out = await redditPublisher.publish('Spring cleanups are booking now\nFlat quotes, no site visit. Book online.', {});
    out.ok && out.id?.startsWith('t3_')
      ? ok(`reddit: submitted as a self post (${out.id})`)
      : bad(`reddit publish: ${JSON.stringify(out).slice(0, 120)}`);
    const wire = await fetch(`${REDDIT}/__posts`).then((r) => r.json());
    wire.posts[0]?.title === 'Spring cleanups are booking now' && /Flat quotes/.test(wire.posts[0]?.text)
      ? ok('the first line became the title, the rest the body')
      : bad(`reddit wire: ${JSON.stringify(wire.posts[0]).slice(0, 120)}`);

    await fetch(`${REDDIT}/__score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: out.id, score: 44, comments: 7 }),
    });
    const m = await redditPublisher.fetchMetrics!(out.id!);
    m.ok && m.metrics?.engagements === 51 && m.metrics?.impressions === null
      ? ok('score+comments read back (51); impressions stay null — view counts are moderator-only')
      : bad(`reddit metrics: ${JSON.stringify(m)}`);

    // The tier answers: computed for live, stated for the rest.
    publisherTier('reddit').tier === 'live'
      ? ok('reddit now answers "live" — the tier is computed from the registry, not written')
      : bad(`reddit tier: ${publisherTier('reddit').tier}`);
    publisherTier('linkedin').tier === 'approval_gated'
      ? ok('linkedin says it waits on their approval, not ours')
      : bad(`linkedin tier: ${publisherTier('linkedin').tier}`);
    const nd = publisherTier('nextdoor');
    nd.tier === 'no_api' && /no posting API/i.test(nd.reason) && /flight/.test(nd.alternative ?? '')
      ? ok('nextdoor says no API exists — and routes the budget to the ad brief instead')
      : bad(`nextdoor: ${JSON.stringify(nd)}`);
  } finally {
    removeGrant('reddit');
  }
}


/**
 * The product can answer — the other half of hearing.
 *
 * The inbox's "Send reply" button used to flip a status flag and claim
 * "Reply sent from your connected account." This drives real replies through
 * each channel's real wire shape and checks the one refusal that matters
 * most: STOP means stop, even mid-conversation.
 */
async function replySection() {
  console.log('\n== The inbox answers, and STOP still means stop ==');

  const BSKY = process.env.BLUESKY_PDS_URL || 'http://localhost:4326';
  const TWILIO = process.env.TWILIO_BASE_URL || 'http://localhost:4324';
  await fetch(`${MOCK}/__reset`, { method: 'POST' });
  await fetch(`${BSKY}/__reset`, { method: 'POST' });
  await fetch(`${TWILIO}/__reset`, { method: 'POST' });

  const { sendReply } = await import('../src/lib/reply');
  const { pollSocialInbox } = await import('../src/lib/listen');
  const { __installSender, __resetSenders } = await import('../src/lib/senders/registry');
  const { twilioSender } = await import('../src/lib/senders/twilio');
  const { suppress, unsuppress } = await import('../src/lib/suppression');

  saveGrant({
    channel: 'mastodon', accessToken: process.env.MOCK_TOKEN || 'mock-access-token',
    refreshToken: null, expiresInSec: null, scopes: ['write:statuses'],
    accountLabel: '@greenscape', externalAccountId: `${HOST}|1|500`,
  });
  saveGrant({
    channel: 'bluesky', accessToken: process.env.MOCK_BSKY_TOKEN || 'mock-bsky-access-jwt',
    refreshToken: 'mock-refresh', expiresInSec: 7200, scopes: ['app-password session'],
    accountLabel: '@greenscape.bsky.social', externalAccountId: 'did:plc:mockmockmock',
  });

  try {
    // --- Mastodon: mention in, threaded status out -----------------------
    await fetch(`${MOCK}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'mention', from: 'Dana Whitfield', text: 'Do you service the north side?', statusId: 888001 }),
    });
    await pollSocialInbox(ORG_ID);
    const mastoConvo = await db.conversation.findFirst({
      where: { organizationId: ORG_ID, externalRef: 'mastodon:888001' },
    });
    if (!mastoConvo) return bad('the staged mention never reached the inbox');

    const mastoReply = await sendReply(ORG_ID, mastoConvo.id, 'We do! Booking link in our bio.');
    mastoReply.ok ? ok('mastodon reply accepted') : bad(`mastodon reply: ${JSON.stringify(mastoReply)}`);
    const mastoWire = await fetch(`${MOCK}/__posts`).then((r) => r.json());
    const threaded = mastoWire.posts.find((p: { in_reply_to_id?: string }) => p.in_reply_to_id === '888001');
    threaded ? ok('and it is threaded — in_reply_to_id names the question') : bad('reply not threaded to the mention');
    (await db.conversation.findUnique({ where: { id: mastoConvo.id } }))?.status === 'replied'
      ? ok('the conversation is marked replied because a reply exists, not before')
      : bad('status not replied after a real send');

    // --- Bluesky: reply in, threaded record out with true root -----------
    // Create the parent post on the PDS first so the reply has a cid to cite.
    const parentRes = await fetch(`${BSKY}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MOCK_BSKY_TOKEN || 'mock-bsky-access-jwt'}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'did:plc:marcus', collection: 'app.bsky.feed.post', record: { text: 'Do you do weekends?' } }),
    }).then((r) => r.json());
    await fetch(`${BSKY}/__notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'reply', from: 'Marcus Cole', text: 'Do you do weekends?', uri: parentRes.uri }),
    });
    await pollSocialInbox(ORG_ID);
    const bskyConvo = await db.conversation.findFirst({
      where: { organizationId: ORG_ID, externalRef: `bluesky:${parentRes.uri}` },
    });
    if (!bskyConvo) return bad('the staged bluesky reply never reached the inbox');

    const bskyReply = await sendReply(ORG_ID, bskyConvo.id, 'Saturdays, yes — book by Thursday.');
    bskyReply.ok ? ok('bluesky reply accepted') : bad(`bluesky reply: ${JSON.stringify(bskyReply)}`);
    const bskyWire = await fetch(`${BSKY}/__posts`).then((r) => r.json());
    const rec = bskyWire.records.find((r: { reply?: { parent?: { uri: string } } }) => r.reply?.parent?.uri === parentRes.uri);
    rec && rec.reply.parent.cid === parentRes.cid
      ? ok('the record carries reply refs with the parent\u2019s real cid')
      : bad(`bluesky reply refs: ${JSON.stringify(rec?.reply)}`);

    // --- SMS: question in via the real webhook, answer out, STOP refusal --
    const phone = '+14155550142';
    await db.contact.deleteMany({ where: { organizationId: ORG_ID, phone } });
    await db.contact.create({
      data: {
        organizationId: ORG_ID, name: 'Tessa Nguyen', email: 'tessa-reply@example.com', phone,
        emailConsent: 'SUBSCRIBED', smsConsent: 'SUBSCRIBED', source: 'reply test',
      },
    });
    const inbound = await fetch(`${TWILIO}/__inbound`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: phone, body: 'Can you fit me in Tuesday?' }),
    }).then((r) => r.json());
    inbound.appStatus === 200 ? ok('the question arrived through the signed webhook') : bad(`inbound: ${JSON.stringify(inbound)}`);

    const smsConvo = await db.conversation.findFirst({
      where: { organizationId: ORG_ID, channel: 'SMS', fromAddress: phone },
      orderBy: { receivedAt: 'desc' },
    });
    if (!smsConvo) return bad('the SMS question has no conversation row');
    smsConvo.fromAddress === phone
      ? ok('the conversation carries the number an answer goes to')
      : bad(`fromAddress: ${smsConvo.fromAddress}`);

    __installSender('sms', twilioSender({
      accountSid: process.env.MOCK_TWILIO_SID || 'ACmock00000000000000000000000000',
      authToken: process.env.MOCK_TWILIO_TOKEN || 'mock-twilio-auth-token',
      from: '+15550001111', baseUrl: TWILIO,
    }));
    try {
      const before = (await fetch(`${TWILIO}/__messages`).then((r) => r.json())).messages.length;
      const smsReply = await sendReply(ORG_ID, smsConvo.id, 'Tuesday 2pm works - see you then!');
      smsReply.ok ? ok('the text reply went out through the real adapter') : bad(`sms reply: ${JSON.stringify(smsReply)}`);
      const wire = await fetch(`${TWILIO}/__messages`).then((r) => r.json());
      wire.messages.length === before + 1 && wire.messages[wire.messages.length - 1].to === phone
        ? ok('and reached the carrier, addressed to the asker')
        : bad('reply did not reach the carrier');
      const charged = await db.spendEntry.findFirst({ where: { organizationId: ORG_ID, providerRef: smsReply.ok ? smsReply.providerRef! : '' } });
      charged && charged.cents >= 1
        ? ok(`and was charged like any other message (${charged.cents}\u00a2)`)
        : bad('the reply was not charged');

      // STOP after asking does not reopen the door.
      await suppress({ organizationId: ORG_ID, channel: 'sms', address: phone, reason: 'unsubscribe', detail: 'reply test STOP' });
      const refused = await sendReply(ORG_ID, smsConvo.id, 'One more thing...');
      !refused.ok && /opted out/.test(refused.error)
        ? ok('a reply to someone who has since texted STOP is refused, in words')
        : bad(`post-STOP reply: ${JSON.stringify(refused)}`);
      await unsuppress(ORG_ID, 'sms', phone);
      await db.spendEntry.deleteMany({ where: { organizationId: ORG_ID, note: { contains: phone } } });
    } finally {
      __resetSenders();
    }

    // Cleanup.
    await db.conversation.deleteMany({ where: { id: { in: [mastoConvo.id, bskyConvo.id, smsConvo.id] } } });
    await db.consentRecord.deleteMany({ where: { contact: { phone } } });
    await db.contact.deleteMany({ where: { organizationId: ORG_ID, phone } });
  } finally {
    removeGrant('mastodon');
    removeGrant('bluesky');
  }
}


/**
 * The feasible tier closes: Pinterest and Google Business publish.
 *
 * Eight of eighteen now. Pinterest is the second image-only platform and
 * the first where the platform's own outbound-click count is real; Google
 * Business reaches somebody searching for you right now, and keeps no like
 * count on posts — the honest tables say so.
 */
async function feasibleSection() {
  console.log('\n== Pinterest pins and Google Business posts, 8 of 18 ==');

  const PIN = process.env.PINTEREST_BASE_URL || 'http://localhost:4328';
  const GBP = process.env.GBP_BASE_URL || 'http://localhost:4329';
  for (const [base, name] of [[PIN, 'pinterest'], [GBP, 'gbp']] as const) {
    const up = await fetch(`${base}/__posts`).then((r) => r.ok).catch(() => false);
    if (!up) return bad(`mock-${name} is not running`);
    await fetch(`${base}/__reset`, { method: 'POST' });
  }

  const { pinterestPublisher } = await import('../src/lib/publishers/pinterest');
  const { gbpPublisher } = await import('../src/lib/publishers/gbp');
  const { publisherTier } = await import('../src/lib/publishers/tiers');

  saveGrant({
    channel: 'pinterest', accessToken: process.env.MOCK_PINTEREST_TOKEN || 'mock-pinterest-token',
    refreshToken: null, expiresInSec: null, scopes: ['pins:write'],
    accountLabel: '@summitlocal', externalAccountId: 'board-summit-1',
  });
  saveGrant({
    channel: 'google_business', accessToken: process.env.MOCK_GBP_TOKEN || 'mock-gbp-token',
    refreshToken: null, expiresInSec: null, scopes: ['business.manage'],
    accountLabel: 'Summit Local — Main St', externalAccountId: 'accounts/108/locations/42',
  });

  try {
    const img = [{ bytes: new TextEncoder().encode('img'), mime: 'image/jpeg', altText: 'Spring beds', publicUrl: 'https://media.example.test/beds.jpg' }];

    // Pinterest: image-only, board-addressed, title from the first line.
    const noImg = await pinterestPublisher.publish('A pin with no image', {});
    !noImg.ok && /no text-only pins/.test(noImg.error ?? '')
      ? ok('pinterest refuses a text-only pin, in words about the platform')
      : bad(`pinterest text-only: ${JSON.stringify(noImg).slice(0, 100)}`);

    const pin = await pinterestPublisher.publish('Spring cleanups\nFlat quotes, book online.', { media: img });
    pin.ok ? ok(`pinterest: pin created (${pin.id})`) : bad(`pin: ${pin.error}`);
    const pinWire = await fetch(`${PIN}/__posts`).then((r) => r.json());
    pinWire.pins[0]?.board_id === 'board-summit-1' && pinWire.pins[0]?.title === 'Spring cleanups'
      ? ok('the pin carries its board and the first line as title')
      : bad(`pin wire: ${JSON.stringify(pinWire.pins[0]).slice(0, 120)}`);

    await fetch(`${PIN}/__metrics`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pin.id, impressions: 1500, saves: 22, clicks: 31 }),
    });
    const pm = await pinterestPublisher.fetchMetrics!(pin.id!);
    pm.ok && pm.metrics?.impressions === 1500 && pm.metrics?.clicks === 31
      ? ok('pinterest reports reach and its own outbound clicks (1,500 / 31)')
      : bad(`pinterest metrics: ${JSON.stringify(pm)}`);

    // Google Business: text-first, resource-name ids, insights per post.
    const post = await gbpPublisher.publish('Now booking spring cleanups — call or book online.', {});
    post.ok && /localPosts\//.test(post.id ?? '')
      ? ok(`google business: post live (${post.id?.split('/localPosts/')[1]})`)
      : bad(`gbp post: ${JSON.stringify(post).slice(0, 120)}`);

    await fetch(`${GBP}/__metrics`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: post.id, views: 812, clicks: 47 }),
    });
    const gm = await gbpPublisher.fetchMetrics!(post.id!);
    gm.ok && gm.metrics?.impressions === 812 && gm.metrics?.clicks === 47 && gm.metrics?.engagements === null
      ? ok('gbp reports search views and click-throughs; engagement stays null — Google keeps no like count')
      : bad(`gbp metrics: ${JSON.stringify(gm)}`);

    publisherTier('pinterest').tier === 'live' && publisherTier('google_business').tier === 'live'
      ? ok('both answer "live" — the tier stays computed, never written')
      : bad(`tiers: ${publisherTier('pinterest').tier}/${publisherTier('google_business').tier}`);
  } finally {
    removeGrant('pinterest');
    removeGrant('google_business');
  }
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
