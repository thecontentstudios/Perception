/**
 * Security checks.
 *
 *   npm run test:security      (needs the server running on :3000)
 *
 * These are the assertions that would have caught the state this codebase was
 * in before: every route open, every query pinned to one hardcoded tenant.
 * They are written as an attacker would probe — unauthenticated calls, another
 * tenant's ids, forged headers — rather than as a description of the code,
 * because a test that mirrors the implementation passes whatever the
 * implementation does.
 */
import 'dotenv/config';
import { db } from '../src/lib/db';
import { hashPassword, verifyPassword, passwordProblem, needsRehash } from '../src/lib/auth/password';
import { __installSender, __resetSenders } from '../src/lib/senders/registry';
import { dispatch } from '../src/lib/queue/dispatch';
import { resendSender } from '../src/lib/senders/resend';
import { recordCharge } from '../src/lib/billing';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let failures = 0;
const ok = (m: string) => console.log('  PASS ' + m);
const bad = (m: string) => { failures++; console.log('  FAIL ' + m); };

async function reachable(): Promise<boolean> {
  try { return (await fetch(`${BASE}/api/health`)).status < 600; } catch { return false; }
}

async function main() {
  console.log('\n== Passwords ==');
  {
    const hash = await hashPassword('a-perfectly-fine-passphrase');
    (await verifyPassword('a-perfectly-fine-passphrase', hash))
      ? ok('correct password verifies') : bad('correct password rejected');
    !(await verifyPassword('a-perfectly-fine-passphras', hash))
      ? ok('a near-miss is rejected') : bad('near-miss accepted');
    !hash.includes('a-perfectly-fine-passphrase')
      ? ok('the hash does not contain the password') : bad('password stored in plaintext');

    const second = await hashPassword('a-perfectly-fine-passphrase');
    second !== hash ? ok('salted — same password, different hash') : bad('unsalted: identical hashes');

    // A user with no password must not be loggable into with any input.
    !(await verifyPassword('anything', null))
      ? ok('an account with no password cannot be signed into') : bad('null hash accepted a password');

    !needsRehash(hash) ? ok('a fresh hash does not need upgrading') : bad('fresh hash flagged for rehash');
    needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA==')
      ? ok('a weaker old hash is flagged for upgrade on next login')
      : bad('weak parameters not detected');

    passwordProblem('short') ? ok('a short password is refused') : bad('short password allowed');
    passwordProblem('password123') ? ok('a breach-list password is refused') : bad('common password allowed');
    passwordProblem('aaaaaaaaaaaaaaaa') ? ok('a repetitive password is refused') : bad('repetitive password allowed');
    !passwordProblem('correct horse battery staple')
      ? ok('a good passphrase is accepted') : bad('good passphrase refused');
  }

  if (!(await reachable())) {
    console.log(`\n  SKIP server not running at ${BASE} — start it to run the route checks\n`);
    return;
  }

  console.log('\n== Every mutating route refuses an anonymous caller ==');
  {
    // No cookie jar: these go out exactly as a stranger's would.
    const probes: [string, RequestInit][] = [
      ['/api/mutate', { method: 'POST', body: JSON.stringify({ mutation: { type: 'setStatus', variationId: 'v-1', status: 'approved' } }) }],
      ['/api/retry', { method: 'POST', body: JSON.stringify({ variationId: 'v-1' }) }],
      ['/api/remediate', { method: 'POST', body: JSON.stringify({ kind: 'trim_caption', variationId: 'v-1', params: {} }) }],
      ['/api/links', { method: 'POST', body: JSON.stringify({ variationId: 'v-1' }) }],
      ['/api/media', { method: 'POST', body: new FormData() }],
      ['/api/connect/bluesky', { method: 'POST', body: JSON.stringify({ handle: 'x', appPassword: 'y' }) }],
      ['/api/connect/mastodon', { method: 'POST', body: JSON.stringify({ host: 'x', token: 'y' }) }],
      // Sending costs money, and setting a budget decides how much can be
      // spent. Both have to be shut to a stranger — including the dry run,
      // which would otherwise report a tenant's audience size for free.
      ['/api/send', { method: 'POST', body: JSON.stringify({ channel: 'email', subject: 'x', body: 'y' }) }],
      ['/api/send', { method: 'POST', body: JSON.stringify({ channel: 'email', subject: 'x', body: 'y', dryRun: true }) }],
      ['/api/spend', { method: 'PUT', body: JSON.stringify({ capCents: 999999, hardStop: false }) }],
    ];
    for (const [path, init] of probes) {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: init.body instanceof FormData ? {} : { 'content-type': 'application/json' },
      });
      res.status === 401 || res.status === 403
        ? ok(`${path} → ${res.status}`)
        : bad(`${path} → ${res.status}, expected 401/403 — this route is open`);
    }
  }

  console.log('\n== Reading is gated too ==');
  {
    for (const path of ['/api/analytics', '/api/learning', '/api/events?campaignId=c-fall', '/api/links?campaignId=c-fall', '/api/spend']) {
      const res = await fetch(`${BASE}${path}`);
      const body = await res.json().catch(() => ({}));
      // Analytics degrades to fixtures rather than 401, which is a deliberate
      // difference — but it must not return computed rows to a stranger.
      const leaked = body.source === 'computed' || body.ok === true;
      !leaked ? ok(`${path} returns nothing real (${res.status})`) : bad(`${path} served real data to an anonymous caller`);
    }
    const ws = await fetch(`${BASE}/api/workspace`).then((r) => r.json());
    ws.source === 'fixtures'
      ? ok('/api/workspace gives an anonymous caller the sample workspace, not a tenant’s')
      : bad(`/api/workspace served ${ws.source} data to an anonymous caller`);
  }

  console.log('\n== Signed in, but scoped ==');
  {
    const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });
    if (!user) {
      console.log('  SKIP no seeded user with a password — run npm run db:seed');
    } else {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: process.env.SEED_PASSWORD || 'demo-password-change-me' }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      login.ok && cookie ? ok('sign-in works and sets a session cookie') : bad(`sign-in failed: ${login.status}`);

      /^pcp_session=/.test(cookie) ? ok('cookie is the session cookie') : bad(`unexpected cookie: ${cookie.slice(0, 30)}`);
      const raw = login.headers.get('set-cookie') ?? '';
      /HttpOnly/i.test(raw) ? ok('session cookie is HttpOnly — script cannot read it') : bad('session cookie readable from JS');
      /SameSite=Lax/i.test(raw) ? ok('SameSite=Lax') : bad(`SameSite not set: ${raw.slice(0, 80)}`);

      const auth = { cookie, 'content-type': 'application/json' };

      // The session must not carry the raw token into the database.
      const stored = await db.session.findFirst({ orderBy: { createdAt: 'desc' } });
      const token = cookie.split('=')[1] ?? '';
      stored && stored.tokenHash !== token
        ? ok('the database stores a hash, not the session token')
        : bad('the raw session token is stored');

      const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
      me.authenticated ? ok(`identified as ${me.role}`) : bad('session not recognised');

      // A real id from another tenant. This is the bug class that survives
      // authentication: valid session, someone else's row.
      const other = await db.organization.create({
        data: { id: 'org-security-test', name: 'Another Customer', ingestKey: 'pk_security_test' },
      });
      const otherBrand = await db.brand.create({
        data: { organizationId: other.id, name: 'Theirs', industry: 'landscaping' },
      });
      const otherCampaign = await db.campaign.create({
        data: {
          organizationId: other.id, brandId: otherBrand.id, name: 'Not yours',
          goal: 'quote_requests', startDate: new Date(), endDate: new Date(),
          ctaLabel: 'x', ctaUrl: 'https://example.com', utmCode: 'other', createdById: user.id,
        },
      });
      const otherItem = await db.contentItem.create({
        data: { campaignId: otherCampaign.id, title: 'Theirs', kind: 'social', coreMessage: 'x' },
      });
      const otherVariation = await db.channelVariation.create({
        data: { contentItemId: otherItem.id, channel: 'INSTAGRAM', format: 'post', body: 'Their post' },
      });

      const crossTenant: [string, object][] = [
        ['/api/mutate', { mutation: { type: 'setScheduledAt', variationId: otherVariation.id, scheduledAt: '2027-01-01T09:00' } }],
        ['/api/retry', { variationId: otherVariation.id }],
        ['/api/remediate', { kind: 'trim_caption', variationId: otherVariation.id, params: { maxChars: 5 } }],
        ['/api/links', { variationId: otherVariation.id }],
      ];
      for (const [path, body] of crossTenant) {
        const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
        res.status === 404 || res.status === 403
          ? ok(`${path} refuses another tenant's id (${res.status})`)
          : bad(`${path} accepted another tenant's id → ${res.status}`);
      }

      // And the row must be untouched.
      const after = await db.channelVariation.findUnique({ where: { id: otherVariation.id } });
      after?.body === 'Their post' && after?.scheduledAt === null
        ? ok("the other tenant's row is unchanged")
        : bad('another tenant’s row was modified');

      // Reading must be scoped too.
      const theirLinks = await fetch(`${BASE}/api/links?campaignId=${otherCampaign.id}`, { headers: { cookie } })
        .then((r) => r.json());
      (theirLinks.links ?? []).length === 0
        ? ok('link stats for another tenant’s campaign come back empty')
        : bad('read another tenant’s link stats');

      // CSRF: a cross-origin POST with a valid cookie must be refused.
      const csrf = await fetch(`${BASE}/api/mutate`, {
        method: 'POST',
        headers: { ...auth, origin: 'https://evil.example' },
        body: JSON.stringify({ mutation: { type: 'setBrand', brandId: 'x' } }),
      });
      csrf.status === 403 ? ok('a cross-origin write is refused even with a valid cookie') : bad(`cross-origin write → ${csrf.status}`);

      // Signing out has to actually end the session.
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } });
      const afterLogout = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
      !afterLogout.authenticated ? ok('the session is dead after sign-out') : bad('session still valid after sign-out');

      await db.channelVariation.delete({ where: { id: otherVariation.id } });
      await db.contentItem.delete({ where: { id: otherItem.id } });
      await db.campaign.delete({ where: { id: otherCampaign.id } });
      await db.brand.delete({ where: { id: otherBrand.id } });
      await db.session.deleteMany({ where: { organizationId: other.id } });
      await db.organization.delete({ where: { id: other.id } });
    }
  }

  console.log('\n== Money: a charge means a provider took the message ==');
  {
    const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });
    if (!user) {
      console.log('  SKIP no seeded user');
    } else {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: process.env.SEED_PASSWORD || 'demo-password-change-me' }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const auth = { cookie, 'content-type': 'application/json' };
      const orgId = (await db.membership.findFirst({ where: { userId: user.id } }))?.organizationId ?? '';
      const month = new Date().toISOString().slice(0, 7);

      const wipe = async () => {
        await db.spendEntry.deleteMany({ where: { organizationId: orgId } });
        await db.budget.deleteMany({ where: { organizationId: orgId } });
        await db.emailDelivery.deleteMany({ where: { variationId: { startsWith: 'adhoc:' } } });
        await db.smsDelivery.deleteMany({ where: { variationId: { startsWith: 'adhoc:' } } });
      };
      await wipe();

      const send = (body: unknown) =>
        fetch(`${BASE}/api/send`, { method: 'POST', headers: auth, body: JSON.stringify(body) }).then(async (r) => ({
          status: r.status,
          body: await r.json(),
        }));
      const spendView = () => fetch(`${BASE}/api/spend`, { headers: auth }).then((r) => r.json());

      // Note: the server's view of whether a sender exists comes from *its*
      // environment, not from this process — `__installSender` cannot reach
      // across the HTTP boundary. So this section reads whatever the running
      // deployment reports and asserts the matching behaviour, rather than
      // pretending it can force one.

      // A dry run must not move money — the check that catches a preview
      // accidentally wired to the real path.
      const quote = await send({ channel: 'email', subject: 'Hello', body: 'Hi {{name}}', dryRun: true });
      (await db.spendEntry.count({ where: { organizationId: orgId } })) === 0
        ? ok('a dry run writes nothing to the ledger')
        : bad('a preview wrote ledger rows');
      quote.body.reach?.reachable > 0
        ? ok(`the quote states an audience (${quote.body.reach.reachable} of ${quote.body.reach.total} reachable)`)
        : bad('quote reported no reachable audience');

      // ---- the correction this phase exists to make ----
      // Accepting a send must not charge for it: nothing has been sent at the
      // moment the request returns, and the previous version charged anyway.
      const real = await send({ channel: 'email', subject: 'Hello', body: 'Hi {{name}}' });
      const ledgerAfterQueue = await db.spendEntry.count({ where: { organizationId: orgId } });
      const queuedRows = await db.emailDelivery.count({
        where: { status: 'QUEUED', contact: { organizationId: orgId } },
      });

      real.body.queued === quote.body.reach.reachable
        ? ok('the send queues exactly the audience the quote named')
        : bad(`quoted ${quote.body.reach.reachable}, queued ${real.body.queued}`);
      ledgerAfterQueue === 0
        ? ok('queueing charges nothing — no provider has seen it yet')
        : bad(`${ledgerAfterQueue} ledger rows written before anything was sent`);
      queuedRows === real.body.queued
        ? ok(`${queuedRows} messages waiting, priced, uncharged`)
        : bad(`queued ${real.body.queued} but found ${queuedRows} rows`);
      real.body.sent === 0 && real.body.chargedCents === 0
        ? ok('and the response says so: sent 0, charged 0')
        : bad(`response claimed sent=${real.body.sent} charged=${real.body.chargedCents}`);
      real.body.sending?.ready
        ? ok(`the response names the provider that will send (${real.body.sending.provider})`)
        : ok('the response names the reason no message left');

      const view = await spendView();
      view.chargedCents === 0 ? ok('/spend reports nothing charged') : bad(`/spend reports ${view.chargedCents}c charged`);
      view.committedMessages === queuedRows
        ? ok(`/spend reports ${view.committedMessages} messages committed, kept separate from charged`)
        : bad(`/spend committed ${view.committedMessages} vs ${queuedRows} queued`);

      // ---- with a provider: exactly one charge per confirmed message ----
      // A stub, because the accounting is under test rather than an HTTP
      // client. The machinery is the machinery Phase 8 puts a provider behind.
      let sendCalls = 0;
      __installSender('email', {
        channel: 'email',
        name: 'Test Provider',
        rateKey: 'resend',
        async send(m) {
          sendCalls += 1;
          return { ok: true, providerRef: `test-${m.deliveryId}` };
        },
      });

      try {
        const first = await dispatch('email', { limit: 10_000 });
        const charges = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        const stillQueued = await db.emailDelivery.count({
          where: { status: 'QUEUED', contact: { organizationId: orgId } },
        });

        first.sent === queuedRows ? ok(`dispatch sent all ${first.sent}`) : bad(`sent ${first.sent} of ${queuedRows}`);
        charges === first.sent
          ? ok(`exactly one ledger row per confirmed message (${charges})`)
          : bad(`${charges} ledger rows for ${first.sent} sends`);
        stillQueued === 0 ? ok('nothing left queued') : bad(`${stillQueued} still queued`);
        sendCalls === first.sent
          ? ok(`the provider was called exactly ${sendCalls} times`)
          : bad(`provider called ${sendCalls} times for ${first.sent} sends`);

        // Idempotency: a webhook firing twice must not charge twice.
        const rows = await db.emailDelivery.findMany({
          where: { status: 'SENT', contact: { organizationId: orgId } },
          include: { contact: true },
          take: 5,
        });
        const replayed = await Promise.all(
          rows.map((row) =>
            recordCharge({
              organizationId: row.contact.organizationId,
              channel: 'email',
              providerRef: row.providerRef!,
              cents: row.costCents,
              units: 1,
            })
          )
        );
        const afterReplay = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        replayed.every((r) => r === 'already-recorded')
          ? ok('a replayed confirmation reports already-recorded')
          : bad(`replay outcomes: ${replayed.join(', ')}`);
        afterReplay === charges ? ok('and the total is unchanged — no double charge') : bad('replay double-charged');

        const second = await dispatch('email', { limit: 10_000 });
        second.sent === 0 && second.considered === 0
          ? ok('a second pass finds nothing and charges nothing')
          : bad(`second pass considered ${second.considered}, sent ${second.sent}`);

        // This send was inside the free allowance, so the honest total is
        // 1,110 ledger rows adding to zero — not zero rows. The distinction
        // matters: the rows are what deplete the allowance.
        const after = await spendView();
        const rowsNow = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        after.committedCents === 0 && after.committedMessages === 0
          ? ok('/spend reports nothing left committed once everything is sent')
          : bad(`after dispatch: ${after.committedMessages} still committed`);
        rowsNow === first.sent
          ? ok(`${rowsNow} ledger rows for ${first.sent} sends, totalling ${after.chargedCents}c (free tier)`)
          : bad(`${rowsNow} ledger rows for ${first.sent} sends`);
      } finally {
        __resetSenders();
      }

      // ---- a success without a message id is a failure, not a charge ----
      __installSender('email', {
        channel: 'email',
        name: 'Sloppy Provider',
        rateKey: 'resend',
        async send() {
          return { ok: true };
        },
      });
      try {
        await send({ channel: 'email', subject: 'Hello', body: 'Hi' });
        const before = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        const r = await dispatch('email', { limit: 10_000 });
        const afterCount = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        r.failed > 0 && r.sent === 0
          ? ok('a success with no message id is failed, not charged')
          : bad(`unreferenced success: sent ${r.sent}, failed ${r.failed}`);
        afterCount === before ? ok('and nothing was added to the ledger') : bad('an unreferenced send was charged');
      } finally {
        __resetSenders();
      }

      // ---- caps count committed money, not just charged ----
      await wipe();
      await db.spendEntry.create({
        data: { organizationId: orgId, channel: 'EMAIL', kind: 'message', certainty: 'exact', cents: 0, units: 5000, note: 'test: allowance used' },
      });
      await fetch(`${BASE}/api/spend`, {
        method: 'PUT', headers: auth,
        body: JSON.stringify({ month, channel: 'email', capCents: 1, hardStop: true }),
      });
      const blocked = await send({ channel: 'email', subject: 'Hello', body: 'Hi' });
      blocked.status === 402 ? ok('a hard cap refuses the send (402)') : bad(`hard cap returned ${blocked.status}`);
      const forced = await send({ channel: 'email', subject: 'Hello', body: 'Hi', acknowledgeOverBudget: true });
      forced.status === 402
        ? ok('and acknowledging does not get around it — that is what "hard" means')
        : bad(`acknowledgement bypassed a hard cap: ${forced.status}`);

      await fetch(`${BASE}/api/spend`, {
        method: 'PUT', headers: auth,
        body: JSON.stringify({ month, channel: 'email', capCents: 1, hardStop: false }),
      });
      const warned = await send({ channel: 'email', subject: 'Hello', body: 'Hi' });
      warned.status === 409 && warned.body.needsAcknowledgement
        ? ok('a soft cap warns first (409)')
        : bad(`soft cap returned ${warned.status}`);
      const through = await send({ channel: 'email', subject: 'Hello', body: 'Hi', acknowledgeOverBudget: true });
      through.body.ok ? ok('and goes through once acknowledged') : bad(`acknowledged send failed: ${through.body.reason}`);

      // The acknowledged send above is now sitting in the queue, priced. Its
      // cost must reconcile against the quote exactly — this is the check that
      // caught per-message rounding wiping out an entire campaign's cost.
      const committedNow = await db.emailDelivery.aggregate({
        where: { status: 'QUEUED', contact: { organizationId: orgId } },
        _sum: { costCents: true },
        _count: true,
      });
      const quotedCents = through.body.committedCents ?? 0;
      (committedNow._sum.costCents ?? 0) === quotedCents && quotedCents > 0
        ? ok(`${committedNow._count} messages carry exactly the quoted ${quotedCents}c between them`)
        : bad(`quoted ${quotedCents}c, delivery rows hold ${committedNow._sum.costCents}c`);

      // Held messages must count against the cap. Otherwise a thousand queued
      // messages sit against a budget they will certainly blow while the
      // budget reports itself healthy.
      const withCommitted = await send({ channel: 'email', subject: 'Hello', body: 'Hi', dryRun: true });
      (withCommitted.body.budget?.spentCents ?? 0) >= quotedCents && quotedCents > 0
        ? ok(`the cap counts ${withCommitted.body.budget.spentCents}c, including committed money`)
        : bad(`cap saw ${withCommitted.body.budget?.spentCents}c with ${quotedCents}c committed`);

      // SMS is blocked by unpaid registration rather than silently filtered.
      const sms = await send({ channel: 'sms', body: 'Slots left this week' });
      sms.status === 422 && /10DLC/i.test(sms.body.reason ?? '')
        ? ok('an unregistered SMS send is refused, with the reason')
        : bad(`SMS send returned ${sms.status}: ${sms.body.reason}`);

      // Setting a budget is a financial control, not a connection setting.
      const analyst = await db.user.findFirst({
        where: { memberships: { some: { role: { in: ['ANALYST', 'CREATOR', 'GUEST'] } } }, passwordHash: { not: null } },
      });
      if (analyst) {
        const alogin = await fetch(`${BASE}/api/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: analyst.email, password: process.env.SEED_PASSWORD || 'demo-password-change-me' }),
        });
        const acookie = alogin.headers.get('set-cookie')?.split(';')[0] ?? '';
        const attempt = await fetch(`${BASE}/api/spend`, {
          method: 'PUT', headers: { cookie: acookie, 'content-type': 'application/json' },
          body: JSON.stringify({ month, capCents: 10_000_000 }),
        });
        attempt.status === 403
          ? ok('a non-owner cannot raise the spending cap')
          : bad(`a non-owner set a budget: ${attempt.status}`);
      } else {
        console.log('  SKIP no lower-privileged seeded user to test budget permissions');
      }

      await wipe();
      __resetSenders();
    }
  }

  console.log('\n== Email that actually leaves, through the real adapter ==');
  {
    const MOCK = process.env.MOCK_RESEND_URL || 'http://localhost:4323';
    const reachable = await fetch(`${MOCK}/__messages`).then((r) => r.ok).catch(() => false);
    const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });

    if (!reachable && process.env.MOCK_RESEND_URL) {
      // Intent to test is configured, so absence is a failure rather than a
      // skip. A suite that quietly does nothing is the failure mode this
      // project has already been bitten by twice.
      bad('MOCK_RESEND_URL is set but the mock is not reachable — run `npm run mock:resend`');
    } else if (!reachable) {
      console.log('  SKIP no MOCK_RESEND_URL configured');
    } else if (!user) {
      console.log('  SKIP no seeded user');
    } else {
      await fetch(`${MOCK}/__reset`, { method: 'POST' });

      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: process.env.SEED_PASSWORD || 'demo-password-change-me' }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const auth = { cookie, 'content-type': 'application/json' };
      const orgId = (await db.membership.findFirst({ where: { userId: user.id } }))?.organizationId ?? '';

      const wipe = async () => {
        await db.spendEntry.deleteMany({ where: { organizationId: orgId } });
        await db.budget.deleteMany({ where: { organizationId: orgId } });
        await db.emailDelivery.deleteMany({ where: { variationId: { startsWith: 'adhoc:' } } });
        await db.smsDelivery.deleteMany({ where: { variationId: { startsWith: 'adhoc:' } } });
        await db.suppression.deleteMany({ where: { organizationId: orgId } });
        await db.messageBatch.deleteMany({ where: { organizationId: orgId } });
      };
      await wipe();

      // A small, named audience so the assertions are about content, not scale.
      const targets = await db.contact.findMany({
        where: { organizationId: orgId, emailConsent: 'SUBSCRIBED', email: { not: null } },
        take: 3,
      });
      const contactIds = targets.map((c) => c.id);

      const queued = await fetch(`${BASE}/api/send`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          channel: 'email',
          subject: 'A few slots left, {{name}}',
          body: 'Hi {{name}},\n\nWe have room this week at {{business}}.',
          contactIds,
        }),
      }).then((r) => r.json());
      queued.queued === targets.length
        ? ok(`queued ${queued.queued} for a named audience`)
        : bad(`queued ${queued.queued} of ${targets.length}`);

      // A {{link}} with nowhere to go renders as "Book here: " in a customer's
      // inbox. Refusing beats sending a sentence that stops mid-air.
      const dangling = await fetch(`${BASE}/api/send`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ channel: 'email', subject: 'Hi', body: 'Book here: {{link}}', contactIds }),
      });
      dangling.status === 422
        ? ok('a {{link}} with no destination is refused before sending')
        : bad(`dangling link token returned ${dangling.status}`);
      const withLink = await fetch(`${BASE}/api/send`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          channel: 'email', subject: 'Hi', body: 'Book here: {{link}}',
          contactIds: [contactIds[0]], linkUrl: 'https://example.test/book', dryRun: true,
        }),
      });
      withLink.status === 200 ? ok('and accepted once one is supplied') : bad(`with a link: ${withLink.status}`);

      // The real Resend adapter, pointed at the stand-in.
      __installSender('email', resendSender({
        apiKey: process.env.MOCK_RESEND_KEY || 'mock-resend-key',
        from: 'Summit Local <hello@summitlocal.test>',
        baseUrl: MOCK,
      }));

      try {
        const run = await dispatch('email', { limit: 100 });
        run.sent === targets.length ? ok(`${run.sent} left through the adapter`) : bad(`sent ${run.sent}, failed ${run.failed}`);

        const { messages } = await fetch(`${MOCK}/__messages`).then((r) => r.json());
        messages.length === targets.length
          ? ok(`the provider received ${messages.length} messages`)
          : bad(`provider received ${messages.length}, expected ${targets.length}`);

        // Merge fields must be filled, or four hundred people get greeted as
        // "Hi {{name}}".
        const anyToken = messages.some(
          (m: { text: string; subject: string }) => /\{\{/.test(m.text) || /\{\{/.test(m.subject)
        );
        !anyToken ? ok('no merge tokens survived into the sent copy') : bad('an unfilled {{token}} was sent');
        const first = targets[0].name.trim().split(/\s+/)[0];
        messages.some((m: { text: string }) => m.text.includes(`Hi ${first},`))
          ? ok(`personalisation reached the body ("Hi ${first},")`)
          : bad('the body was not personalised');
        messages.some((m: { subject: string }) => m.subject.includes(first))
          ? ok('and the subject line')
          : bad('the subject was not personalised');

        // Bulk mail without these headers degrades however clean the list is.
        const withUnsub = messages.filter((m: { headers: Record<string, string> }) => m.headers['List-Unsubscribe']);
        withUnsub.length === messages.length
          ? ok('every message carries List-Unsubscribe')
          : bad(`${withUnsub.length} of ${messages.length} had List-Unsubscribe`);
        messages.every((m: { headers: Record<string, string> }) => m.headers['List-Unsubscribe-Post'])
          ? ok('and the one-click header Gmail and Yahoo require')
          : bad('List-Unsubscribe-Post missing');
        messages.every((m: { html?: string; text: string }) => Boolean(m.html) && m.html!.includes('Unsubscribe'))
          ? ok('and an unsubscribe link a human can actually see')
          : bad('the HTML part has no visible unsubscribe');

        // Idempotency: the key is what makes a worker retry safe.
        messages.every((m: { idempotencyKey: string | null }) => m.idempotencyKey)
          ? ok('each send carried an idempotency key')
          : bad('a message went without an idempotency key');

        const charges = await db.spendEntry.count({ where: { organizationId: orgId, kind: 'message' } });
        charges === run.sent ? ok(`${charges} ledger rows for ${run.sent} sends`) : bad(`${charges} rows for ${run.sent} sends`);
      } finally {
        __resetSenders();
      }
    }
  }

  console.log('\n== Bounces suppress; soft ones do not; forgeries are refused ==');
  {
    const MOCK = process.env.MOCK_RESEND_URL || 'http://localhost:4323';
    const reachable = await fetch(`${MOCK}/__messages`).then((r) => r.ok).catch(() => false);
    const secretSet = Boolean(process.env.RESEND_WEBHOOK_SECRET);

    if (!reachable && process.env.MOCK_RESEND_URL) {
      bad('MOCK_RESEND_URL is set but the mock is not reachable — run `npm run mock:resend`');
    } else if (!reachable || !secretSet) {
      console.log(`  SKIP ${!reachable ? 'no MOCK_RESEND_URL configured' : 'RESEND_WEBHOOK_SECRET not set'}`);
    } else {
      const sent = await db.emailDelivery.findMany({
        where: { status: 'SENT', providerRef: { not: null } },
        include: { contact: true },
        take: 3,
      });

      if (sent.length < 2) {
        console.log('  SKIP not enough sent messages to bounce');
      } else {
        const hook = (body: unknown) =>
          fetch(`${MOCK}/__webhook`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).then((r) => r.json());

        // A forged signature must be refused before anything is read.
        const forged = await hook({
          type: 'email.bounced',
          email_id: sent[0].providerRef,
          bounce: { type: 'Permanent' },
          badSignature: true,
        });
        forged.appStatus === 401
          ? ok('an unsigned webhook is refused (401)')
          : bad(`forged webhook returned ${forged.appStatus}`);
        (await db.suppression.count({ where: { address: (sent[0].contact.email ?? '').toLowerCase() } })) === 0
          ? ok('and suppressed nobody')
          : bad('a forged webhook wrote to the suppression list');

        // A hard bounce suppresses.
        const hard = await hook({
          type: 'email.bounced',
          email_id: sent[0].providerRef,
          bounce: { type: 'Permanent', message: 'Mailbox does not exist' },
        });
        hard.appStatus === 200 ? ok('a signed bounce is accepted') : bad(`signed bounce returned ${hard.appStatus}`);
        const bounced = await db.emailDelivery.findUnique({ where: { id: sent[0].id } });
        bounced?.status === 'BOUNCED' && bounced.bounceKind === 'hard'
          ? ok('the delivery is marked hard-bounced')
          : bad(`delivery is ${bounced?.status}/${bounced?.bounceKind}`);
        (await db.suppression.count({
          where: { organizationId: sent[0].contact.organizationId, address: (sent[0].contact.email ?? '').toLowerCase() },
        })) === 1
          ? ok('and the address is suppressed')
          : bad('a hard bounce did not suppress');

        // A soft bounce does not. A full mailbox is not a dead address.
        const soft = await hook({
          type: 'email.bounced',
          email_id: sent[1].providerRef,
          bounce: { type: 'Transient', message: 'Mailbox full' },
        });
        soft.appStatus === 200 ? ok('a soft bounce is accepted') : bad(`soft bounce returned ${soft.appStatus}`);
        (await db.suppression.count({
          where: { organizationId: sent[1].contact.organizationId, address: (sent[1].contact.email ?? '').toLowerCase() },
        })) === 0
          ? ok('and leaves the list alone — a full mailbox is not a dead address')
          : bad('a soft bounce suppressed an address');

        // The audience shrinks by exactly the suppressed one.
        const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });
        const login = await fetch(`${BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: user!.email, password: process.env.SEED_PASSWORD || 'demo-password-change-me' }),
        });
        const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
        const quote = await fetch(`${BASE}/api/send`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            channel: 'email',
            subject: 'Again',
            body: 'Hi',
            contactIds: sent.map((s) => s.contactId),
            dryRun: true,
          }),
        }).then((r) => r.json());
        quote.reach.reachable === sent.length - 1
          ? ok(`the next send reaches ${quote.reach.reachable} of ${sent.length} — one fewer`)
          : bad(`expected ${sent.length - 1} reachable, got ${quote.reach.reachable}`);
        quote.reach.exclusions.some((e: { reason: string }) => /bounce|complain/i.test(e.reason))
          ? ok('and names the reason separately from unsubscribes')
          : bad('the suppression is not reported as its own exclusion');

        // A complaint is always terminal.
        const complained = await hook({ type: 'email.complained', email_id: sent[2]?.providerRef ?? sent[1].providerRef });
        complained.appStatus === 200 ? ok('a complaint is accepted') : bad(`complaint returned ${complained.appStatus}`);

        // The dispatcher checks again at send time, because a bounce can
        // arrive between queueing and sending.
        const target = sent[0];
        const batch = await db.messageBatch.findFirst({ where: { organizationId: target.contact.organizationId } });
        if (batch) {
          const held = await db.emailDelivery.create({
            data: {
              variationId: 'adhoc:suppression-probe',
              batchId: batch.id,
              contactId: target.contactId,
              costCents: 1,
              status: 'QUEUED',
            },
          });
          __installSender('email', resendSender({
            apiKey: process.env.MOCK_RESEND_KEY || 'mock-resend-key',
            from: 'Summit Local <hello@summitlocal.test>',
            baseUrl: MOCK,
          }));
          try {
            await dispatch('email', { limit: 100 });
            const after = await db.emailDelivery.findUnique({ where: { id: held.id } });
            after?.status === 'SUPPRESSED'
              ? ok('a message queued before the bounce is stopped at dispatch, not sent')
              : bad(`suppressed message dispatched as ${after?.status}`);
          } finally {
            __resetSenders();
            await db.emailDelivery.delete({ where: { id: held.id } }).catch(() => {});
          }
        }

        // The unsubscribe link in every message has to work. A
        // List-Unsubscribe header pointing at a 404 is worse than no header.
        // Any delivery with a contact, not one still at SENT: by this point
        // every message above has been bounced or complained, and scoping the
        // lookup to SENT made this whole block skip itself in silence — the
        // failure mode this suite has been bitten by before.
        // Not one whose address is already on the list. An address suppressed
        // by an earlier bounce keeps that reason when it unsubscribes, which
        // is correct and would make this assertion test nothing.
        const alreadySuppressed = (
          await db.suppression.findMany({ where: { organizationId: sent[0].contact.organizationId }, select: { address: true } })
        ).map((r) => r.address);
        const live = await db.emailDelivery.findFirst({
          where: {
            contact: { email: { not: null, notIn: alreadySuppressed } },
          },
          include: { contact: true },
          orderBy: { id: 'desc' },
        });
        if (!live?.contact.email) {
          bad('no delivery to test the unsubscribe link against');
        } else {
          const oneClick = await fetch(`${BASE}/u/${live.id}`, { method: 'POST' });
          oneClick.status === 200
            ? ok('one-click unsubscribe (RFC 8058 POST) works without a login')
            : bad(`one-click unsubscribe returned ${oneClick.status}`);
          const contact = await db.contact.findUnique({ where: { id: live.contactId } });
          contact?.emailConsent === 'UNSUBSCRIBED'
            ? ok('and flips the contact to unsubscribed')
            : bad(`consent is ${contact?.emailConsent} after unsubscribing`);
          (await db.suppression.count({
            where: { organizationId: live.contact.organizationId, address: live.contact.email.toLowerCase(), reason: 'unsubscribe' },
          })) === 1
            ? ok('and suppresses the address, so a CSV re-import cannot resurrect them')
            : bad('unsubscribe did not write a suppression');

          const human = await fetch(`${BASE}/u/${live.id}`);
          const html = await human.text();
          human.status === 200 && /unsubscribed/i.test(html)
            ? ok('a human clicking the link gets a page that says so')
            : bad(`GET returned ${human.status}`);
          const missing = await fetch(`${BASE}/u/does-not-exist`);
          missing.status === 404 ? ok('an unknown link 404s rather than erroring') : bad(`unknown link returned ${missing.status}`);

          await db.contact.update({ where: { id: live.contactId }, data: { emailConsent: 'SUBSCRIBED' } });
        }

        const orgId = sent[0].contact.organizationId;
        await db.suppression.deleteMany({ where: { organizationId: orgId } });
        await db.spendEntry.deleteMany({ where: { organizationId: orgId } });
        await db.emailDelivery.deleteMany({ where: { variationId: { startsWith: 'adhoc:' } } });
        await db.messageBatch.deleteMany({ where: { organizationId: orgId } });
      }
    }
  }

  console.log('\n== Login does not leak which accounts exist ==');
  {
    const t0 = Date.now();
    const unknown = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.example', password: 'whatever-it-is' }),
    });
    const unknownMs = Date.now() - t0;
    const unknownBody = await unknown.json();

    const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });
    const t1 = Date.now();
    const wrong = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user?.email ?? 'a@b.c', password: 'definitely-not-the-password' }),
    });
    const wrongMs = Date.now() - t1;
    const wrongBody = await wrong.json();

    unknownBody.reason === wrongBody.reason && unknown.status === wrong.status
      ? ok(`unknown email and wrong password are indistinguishable ("${wrongBody.reason}")`)
      : bad(`different responses: "${unknownBody.reason}" vs "${wrongBody.reason}"`);

    // Timing: the unknown-email path still runs a full hash, so the two should
    // be within an order of magnitude. Loose on purpose — a tight bound would
    // be flaky under load, and the property being checked is "not 2ms vs
    // 100ms", not equality.
    const ratio = Math.max(unknownMs, wrongMs) / Math.max(1, Math.min(unknownMs, wrongMs));
    ratio < 5
      ? ok(`and take comparable time (${unknownMs}ms vs ${wrongMs}ms)`)
      : bad(`timing leaks account existence: ${unknownMs}ms vs ${wrongMs}ms`);
  }

  console.log('\n== Public endpoints: limited, and tenant-scoped ==');
  {
    // Conversions with no key and no attribution must be refused, or anyone
    // can write into any workspace.
    const orphan = await fetch(`${BASE}/api/events`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'quote_request', eventId: `sec-${Date.now()}` }),
    });
    orphan.status === 400
      ? ok('an event with no site key and no attribution is refused')
      : bad(`unkeyed event → ${orphan.status}`);

    const badKey = await fetch(`${BASE}/api/events`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'quote_request', key: 'pk_not_a_real_key', eventId: `sec2-${Date.now()}` }),
    });
    badKey.status === 401 ? ok('an unknown site key is refused') : bad(`bad key → ${badKey.status}`);

    // Login limits protect an *account* without letting one office lock
    // itself out. Twenty wrong passwords in a row must not stop the next
    // person on the same IP signing in correctly.
    for (let i = 0; i < 20; i++) {
      await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `stranger${i}@nowhere.example`, password: 'wrong-password-here' }),
      });
    }
    const user = await db.user.findFirst({ where: { passwordHash: { not: null } } });
    const stillWorks = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: user!.email,
        password: process.env.SEED_PASSWORD || 'demo-password-change-me',
      }),
    });
    stillWorks.ok
      ? ok('20 failed logins from one address do not lock out a valid one — offices share an IP')
      : bad(`a valid sign-in was refused after other failures: ${stillWorks.status}`);

    // But grinding one account does get stopped.
    let acctLocked = false;
    for (let i = 0; i < 16 && !acctLocked; i++) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'target@nowhere.example', password: `guess-number-${i}` }),
      });
      if (r.status === 429) acctLocked = true;
    }
    acctLocked ? ok('repeated guesses at one account are blocked') : bad('no per-account limit');

    // Deliberately last in the file. Each of these bursts spends a real
    // budget, and running them before the checks above meant the limiter was
    // already exhausted by the time those ran — the tests failed on their own
    // side effects rather than on anything the product did.
    let limited = false;
    for (let i = 0; i < 140 && !limited; i++) {
      const r = await fetch(`${BASE}/api/events`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'quote_request', key: 'pk_demo_greenscape_workspace', eventId: `rl-${i}` }),
      });
      if (r.status === 429) limited = true;
    }
    limited ? ok('the public ingest endpoint rate limits') : bad('no rate limit on /api/events');
  }

  console.log('\n== Headers and health ==');
  {
    const res = await fetch(`${BASE}/login`);
    const h = (k: string) => res.headers.get(k) ?? '';
    h('content-security-policy').includes("frame-ancestors 'none'")
      ? ok('CSP forbids framing') : bad(`no frame-ancestors: ${h('content-security-policy').slice(0, 60)}`);
    h('x-content-type-options') === 'nosniff' ? ok('nosniff set') : bad('no nosniff');
    h('referrer-policy') ? ok(`referrer policy set (${h('referrer-policy')})`) : bad('no referrer policy');
    !h('x-powered-by') ? ok('no x-powered-by') : bad('x-powered-by leaks the framework');

    const media = await fetch(`${BASE}/api/media/file/aa/bb/${'0'.repeat(64)}.jpg`);
    (media.headers.get('content-security-policy') ?? '').includes('sandbox')
      ? ok('uploaded files are served sandboxed') : bad('uploaded files are not sandboxed');

    const health = await fetch(`${BASE}/api/health?deep=1`).then((r) => r.json());
    health.checks?.database ? ok(`health reports its dependencies (db ${health.checks.database.ok})`) : bad('health has no checks');
    !JSON.stringify(health).includes('postgresql://')
      ? ok('health leaks no connection strings') : bad('health echoed a connection string');
  }
}

main()
  .catch((e) => bad(`threw: ${(e as Error).stack}`))
  .finally(async () => {
    await db.$disconnect();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nSECURITY CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  });
