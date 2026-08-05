/**
 * Unit checks for logic that is easy to get subtly wrong and impossible to
 * eyeball: AT Protocol facet byte offsets, grapheme counting, and token
 * encryption. Run with `npm run test:unit`.
 */
import { buildFacets, graphemeLength } from '../src/lib/publishers/bluesky';
import { encrypt, decrypt, pkceChallenge, safeEqual } from '../src/lib/oauth/crypto';
import { mastodonPublisher } from '../src/lib/publishers/mastodon';
import { readFileSync } from 'node:fs';

let failures = 0;
const ok = (m: string) => console.log('  PASS ' + m);
const bad = (m: string) => { failures++; console.log('  FAIL ' + m); };
const eq = (actual: unknown, expected: unknown, m: string) =>
  JSON.stringify(actual) === JSON.stringify(expected) ? ok(m) : bad(`${m} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

console.log('\n== Grapheme counting (Bluesky counts graphemes, not UTF-16 units) ==');
eq(graphemeLength('👨‍👩‍👧‍👦'), 1, 'family emoji is 1 grapheme (String.length says 11)');
eq(graphemeLength('café 🇯🇵'), 6, 'accents and flags counted once each');
eq(graphemeLength('hello'), 5, 'ascii unchanged');

console.log('\n== Facet byte offsets (UTF-8 bytes, not string indices) ==');
{
  const text = 'Fall cleanup 🍂 — see https://example.com/quote #tag';
  const facets = buildFacets(text);
  const bytes = Buffer.from(text, 'utf8');
  const slice = (f: { index: { byteStart: number; byteEnd: number } }) =>
    bytes.subarray(f.index.byteStart, f.index.byteEnd).toString('utf8');
  eq(slice(facets[0]), 'https://example.com/quote', 'link facet spans exactly the URL');
  eq(slice(facets[1]), '#tag', 'tag facet spans exactly the hashtag');
  const naive = text.indexOf('https://example.com/quote');
  facets[0].index.byteStart !== naive
    ? ok(`byte offset (${facets[0].index.byteStart}) correctly differs from JS index (${naive})`)
    : bad('byte offset equals JS index — multibyte handling is wrong');
}
{
  const f = buildFacets('see https://example.com/a. next');
  eq(f[0].features[0].uri, 'https://example.com/a', 'trailing full stop excluded from URL');
}
{
  const f = buildFacets('link https://example.com/#anchor here');
  eq(f.length, 1, 'URL fragment does not produce a bogus hashtag facet');
}
{
  const f = buildFacets('no links or tags here');
  eq(f.length, 0, 'plain text yields no facets');
}

console.log('\n== Schema matches the domain (drift guard) ==');
{
  // Both of these drifted silently and only surfaced when the database was
  // first used: nine channels and one connection status were missing from the
  // Prisma enums. Cheap to assert, expensive to discover at runtime.
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const types = readFileSync('src/lib/types.ts', 'utf8');

  const prismaEnum = (name: string): string[] => {
    const block = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))?.[1] ?? '';
    return block.split('\n').map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l)).sort();
  };
  const domainUnion = (name: string): string[] => {
    const block = types.match(new RegExp(`export type ${name} =([\\s\\S]*?);`))?.[1] ?? '';
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1].toUpperCase()).sort();
  };

  for (const [enumName, typeName] of [
    ['Channel', 'Channel'],
    ['ConnectionStatus', 'ConnectionStatus'],
    ['VariationStatus', 'VariationStatus'],
    ['CampaignStatus', 'CampaignStatus'],
  ] as [string, string][]) {
    const a = prismaEnum(enumName);
    const b = domainUnion(typeName);
    if (b.length === 0) { bad(`${typeName}: domain union not found`); continue; }
    const onlyDb = a.filter((x) => !b.includes(x));
    const onlyDomain = b.filter((x) => !a.includes(x));
    onlyDb.length === 0 && onlyDomain.length === 0
      ? ok(`${enumName}: schema and domain agree (${a.length} values)`)
      : bad(`${enumName} drift — only in schema: [${onlyDb}], only in domain: [${onlyDomain}]`);
  }
}

console.log('\n== Mastodon counts text its own way ==');
{
  // Mastodon counts every URL as a flat 23 characters, whatever its length.
  const shortUrl = 'See https://a.co';
  const longUrl = 'See https://greenscapenj.com/fall-cleanup?utm_campaign=fall-2026&utm_source=mastodon';
  eq(
    mastodonPublisher.measure(shortUrl),
    mastodonPublisher.measure(longUrl),
    'a long tracking URL costs the same as a short one'
  );
  eq(mastodonPublisher.measure('hello'), 5, 'plain text counted normally');

  // The two platforms must not share a counting rule.
  const mixed = 'Fall cleanup 👨‍👩‍👧‍👦 https://greenscapenj.com/a-very-long-tracking-url';
  const bs = graphemeLength(mixed);
  const ma = mastodonPublisher.measure(mixed);
  bs !== ma
    ? ok(`Bluesky (${bs}) and Mastodon (${ma}) count the same text differently, as they should`)
    : bad('both publishers counted identically — a platform rule is being flattened');

  eq(mastodonPublisher.capabilities.limitIsPerInstance, true, 'Mastodon limit is marked per-instance');
}

console.log('\n== Token encryption ==');
{
  const secret = 'EAAB-page-token';
  const enc = encrypt(secret);
  eq(decrypt(enc), secret, 'round-trips');
  !enc.includes(secret) ? ok('ciphertext does not contain plaintext') : bad('plaintext leaked into ciphertext');
  encrypt(secret) !== encrypt(secret) ? ok('nonce randomised per encryption') : bad('deterministic ciphertext — nonce reused');
  const parts = enc.split('.');
  const body = Buffer.from(parts[3], 'base64url');
  body[0] ^= 1;
  parts[3] = body.toString('base64url');
  try { decrypt(parts.join('.')); bad('tampered ciphertext decrypted'); }
  catch { ok('tampering rejected by the GCM auth tag'); }
}

console.log('\n== PKCE + state ==');
{
  const v = 'a'.repeat(64);
  const c = pkceChallenge(v);
  c !== v && c.length === 43 ? ok('S256 challenge derived correctly') : bad('bad PKCE challenge');
  safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') ? ok('constant-time compare behaves') : bad('state compare wrong');
}

/**
 * The read path needs a live database, so it is the one async section here.
 * It skips rather than fails without `DATABASE_URL`, because `npm test` has to
 * keep passing on a fresh clone that has not set Postgres up yet.
 */
async function readPathChecks() {
  console.log('\n== Read path: database rows round-trip to domain shapes ==');
  // Next loads .env for the app; a bare tsx process does not, and silently
  // skipping because of that would be worse than not having the check.
  (await import('dotenv')).config({ quiet: true });
  if (!process.env.DATABASE_URL) {
    console.log('  SKIP no DATABASE_URL — run `npm run db:migrate && npm run db:seed` to cover this');
    return;
  }
  // The strongest check available: the fixtures seeded the database, so
  // loading it back must reproduce them. Anything the translation layer drops,
  // renames, or reshapes shows up as a diff against its own input.
  const { loadWorkspace } = await import('../src/lib/queries');
  const { db } = await import('../src/lib/db');
  const fx = await import('../src/lib/demo-data');

  // The browser suite writes real conversions through /api/events. Clearing
  // the previous run's here — before it runs again — keeps the demo workspace
  // from slowly filling with test leads that would later show up in analytics.
  //
  // Two shapes to catch: the ones the suite posts directly (prefixed ids) and
  // the ones the *snippet* generates on the mock customer site, whose ids it
  // mints itself. Those are identified by where they came from instead.
  await db.conversion.deleteMany({
    where: {
      OR: [
        { externalId: { startsWith: 'ui-test-' } },
        { attribution: { path: ['referrer'], string_contains: 'localhost:4322' } },
      ],
    },
  });

  // Likewise the photo the browser suite uploads each run. Content-addressed
  // storage means the bytes are shared, so only the row needs clearing — and
  // only when nothing is using it, which is the same check a real delete needs.
  const testUploads = await db.mediaAsset.findMany({
    where: { fileName: 'fall-cleanup-crew.png' },
    select: { id: true, _count: { select: { usages: true } } },
  });
  const unused = testUploads.filter((m) => m._count.usages === 0).map((m) => m.id);
  if (unused.length > 0) await db.mediaAsset.deleteMany({ where: { id: { in: unused } } });

  try {
    const w = await loadWorkspace(fx.ORG.id);

    // Presence, not equality. Once the write path exists the database is a
    // superset of the seed — a destination discovered during a connect flow is
    // a row the fixtures never had, and asserting counts would call that a
    // regression. What must hold is that nothing seeded went missing.
    const allPresent = <T extends { id: string }>(got: T[], want: T[], label: string) => {
      const have = new Set(got.map((x) => x.id));
      const lost = want.filter((x) => !have.has(x.id)).map((x) => x.id);
      lost.length === 0
        ? ok(`every seeded ${label} came back (${got.length} rows)`)
        : bad(`${label} missing from the read path: ${lost.join(', ')}`);
    };
    allPresent(w.campaigns, fx.CAMPAIGNS, 'campaign');
    allPresent(w.items, fx.CONTENT_ITEMS, 'content item');
    allPresent(w.variations, fx.VARIATIONS, 'variation');
    allPresent(w.destinations, fx.DESTINATIONS, 'destination');

    // Dates are the fragile part: the UI compares 'YYYY-MM-DD' strings, so a
    // Date leaking through — or a timezone shifting one — breaks the calendar
    // silently on machines east of UTC.
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const minute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    w.campaigns.every((c) => day.test(c.startDate) && day.test(c.endDate))
      ? ok('campaign dates are day strings, not Dates')
      : bad('a campaign date is not a YYYY-MM-DD string');
    w.variations.every((v) => !v.scheduledAt || minute.test(v.scheduledAt))
      ? ok('scheduled times are minute strings')
      : bad('a scheduledAt is not a YYYY-MM-DDTHH:mm string');

    // Field-level round trip on the campaign the whole demo hangs on.
    const fall = w.campaigns.find((c) => c.id === 'c-fall');
    const fallFx = fx.CAMPAIGNS.find((c) => c.id === 'c-fall')!;
    eq(fall?.name, fallFx.name, 'campaign name survives the round trip');
    eq(fall?.status, fallFx.status, 'status lowercased back to the domain union');
    eq(fall?.startDate, fallFx.startDate, 'start date unshifted by timezone');
    eq(fall?.cta, fallFx.cta, 'call to action reassembled from its two columns');

    // campaignId is a fixture convenience the schema does not store; the read
    // path has to rebuild it through ContentItem or every screen loses its
    // grouping.
    const orphans = w.variations.filter((v) => !v.campaignId).length;
    eq(orphans, 0, 'every variation resolved its campaign through the content item');

    // The one failed publish is stored as a PublicationAttempt row and has to
    // come back as the inline `failure` the Home screen renders.
    const failed = w.variations.filter((v) => v.failure);
    eq(failed.length, fx.VARIATIONS.filter((v) => v.failure).length, 'the failed publish survives as an attempt row');
    eq(failed[0]?.failure?.code, fx.VARIATIONS.find((v) => v.failure)!.failure!.code, 'failure code preserved');

    // Media placeholders are encoded into storageKey by the seed; if that
    // decode drifts, the library renders grey boxes instead of the demo art.
    const withArt = w.media.filter((m) => m.gradient[0].startsWith('#') && m.glyph).length;
    eq(withArt, w.media.length, 'every media asset decoded its placeholder art');

    // Enum translation is one .toLowerCase() away from producing values no
    // switch statement handles, and TypeScript cannot catch a bad cast.
    const { CHANNEL_META } = await import('../src/lib/channels');
    const badChannel = w.variations.find((v) => !(v.channel in CHANNEL_META));
    badChannel
      ? bad(`variation channel '${badChannel.channel}' is not a domain channel`)
      : ok('every channel value is a legal domain channel');
    console.log('\n== Write path: the server derives what the reducer derives ==');
    const { applyMutation } = await import('../src/lib/mutations');

    // Approving is two rows, one user action. Forgetting the second leaves the
    // approvals queue showing work that is already done.
    {
      const pending = await db.approval.findFirst({ where: { decision: 'PENDING' } });
      if (!pending) {
        console.log('  SKIP no pending approval in the seed');
      } else {
        const before = await db.channelVariation.findUnique({ where: { id: pending.variationId } });
        await applyMutation(fx.ORG.id, { type: 'setStatus', variationId: pending.variationId, status: 'approved' });
        const after = await db.approval.findUnique({ where: { id: pending.id } });
        eq(after?.decision, 'APPROVED', 'approving a post also decides its pending approval');
        after?.decidedAt ? ok('decision timestamped') : bad('approval decided with no decidedAt');
        // Restore.
        await db.approval.update({ where: { id: pending.id }, data: { decision: 'PENDING', decidedAt: null } });
        await db.channelVariation.update({ where: { id: pending.variationId }, data: { status: before!.status } });
      }
    }

    // A route that writes whatever the client names is a mass-assignment hole.
    // The whitelist has to hold even when the field exists on the model.
    {
      const v = await db.channelVariation.findFirst({ where: { status: 'DRAFT' } });
      if (!v) {
        console.log('  SKIP no draft variation in the seed');
      } else {
        await applyMutation(fx.ORG.id, {
          type: 'updateVariation',
          variationId: v.id,
          patch: { body: 'edited by the test', status: 'PUBLISHED', publishedAt: new Date().toISOString() },
        });
        const after = await db.channelVariation.findUnique({ where: { id: v.id } });
        eq(after?.body, 'edited by the test', 'a whitelisted field is written');
        eq(after?.status, v.status, 'status ignored — it is not the composer’s to set');
        eq(after?.publishedAt, v.publishedAt, 'publishedAt ignored — only publishing sets that');
        eq(after?.overridden, true, 'editing marks the variation overridden');
        await db.channelVariation.update({
          where: { id: v.id },
          data: { body: v.body, overridden: v.overridden },
        });
      }
    }

    console.log('\n== Learning loop: does it find what the data actually says? ==');
    {
      const { learn, bestTimeFor, MIN_POSTS, MIN_CLICKS } = await import('../src/lib/learning');

      // The seed plants exactly two patterns and nothing else: reels convert
      // about 3× plain posts, and each brand has its own peak hour. Asserting
      // the loop *rediscovers* them is far stronger than asserting it returns
      // a well-formed answer — a broken query can still be well-formed.
      const l = await learn(fx.ORG.id);
      l.sample.posts > 0 ? ok(`${l.sample.posts} posts, ${l.sample.clicks} clicks to learn from`) : bad('no history seeded');

      const format = l.findings.find((f) => f.dimension === 'format');
      format?.best.label === 'short videos' && (format.lift ?? 0) > 2
        ? ok(`found the planted format pattern: ${format.lift!.toFixed(1)}× lift for short videos`)
        : bad(`format finding wrong: ${format ? `${format.best.label} ${format.lift}×` : 'none'}`);

      const timing = l.findings.find((f) => f.dimension === 'hour');
      timing && (timing.lift ?? 0) > 1.5
        ? ok(`found a real timing difference: ${timing.sentence}`)
        : bad(`no timing finding: ${timing?.sentence ?? 'none'}`);

      // Every claim has to carry the sample it rests on, or a reader cannot
      // judge it.
      l.findings.every((f) => f.best.posts >= MIN_POSTS && f.best.clicks >= MIN_CLICKS)
        ? ok(`every finding clears the sample floor (${MIN_POSTS} posts, ${MIN_CLICKS} clicks)`)
        : bad('a finding was reported from below the sample floor');
      l.findings.every((f) => /\d/.test(f.sentence))
        ? ok('every sentence contains the number behind it')
        : bad('a finding stated a conclusion with no number');

      // Refusing to answer is a feature. A brand with no history must get the
      // default *and say so* rather than borrow a learned answer's authority.
      const unknown = await bestTimeFor(fx.ORG.id, 'b-does-not-exist');
      unknown.learned === false && unknown.reason === null
        ? ok('a brand with no history gets a default that admits it is a default')
        : bad(`empty brand claimed a learned time: ${JSON.stringify(unknown)}`);

      // And the times have to actually be per-brand, not one answer relabelled.
      const times = await Promise.all(
        fx.BRANDS.map(async (b) => ({ id: b.id, ...(await bestTimeFor(fx.ORG.id, b.id)) }))
      );
      const learned = times.filter((t) => t.learned);
      learned.length >= 2 ? ok(`${learned.length} brands learned from their own history`) : bad('fewer than 2 brands learned');
      new Set(learned.map((t) => t.time)).size > 1
        ? ok(`brands got different times (${learned.map((t) => `${t.id}:${t.time}`).join(', ')})`)
        : bad(`every brand got the same time — likely a global default in disguise (${learned[0]?.time})`);
      learned.every((t) => t.reason && /\d/.test(t.reason))
        ? ok('each learned time cites its own numbers')
        : bad('a learned time had no numeric justification');

      // A performance suggestion must quote the finding verbatim. Re-describing
      // it is how the number and the claim drift apart.
      const { performanceSuggestions } = await import('../src/lib/suggest-performance');
      const sugg = performanceSuggestions(l, {
        channels: ['instagram', 'facebook', 'tiktok'],
        ctaLabel: 'Book now', ctaUrl: 'https://example.com', coreMessage: 'Test',
      });
      sugg.length > 0 ? ok(`${sugg.length} performance-backed suggestions`) : bad('no performance suggestions');
      sugg.every((s) => s.source === 'performance')
        ? ok('all tagged as performance-sourced')
        : bad('a suggestion claimed the wrong source');
      format && sugg.some((s) => s.reasons.includes(format.sentence))
        ? ok('a suggestion quotes the finding verbatim, so the number cannot drift')
        : bad('no suggestion carries the finding’s own sentence');
    }

    // Toggle is an intent to flip, not a target value; applying it twice has to
    // land back where it started or the connections screen lies.
    {
      const d = await db.publishDestination.findFirst();
      if (d) {
        await applyMutation(fx.ORG.id, { type: 'toggleDestination', destinationId: d.id });
        const mid = await db.publishDestination.findUnique({ where: { id: d.id } });
        await applyMutation(fx.ORG.id, { type: 'toggleDestination', destinationId: d.id });
        const end = await db.publishDestination.findUnique({ where: { id: d.id } });
        mid?.enabled !== d.enabled && end?.enabled === d.enabled
          ? ok('toggling a destination twice returns it to its original state')
          : bad('destination toggle is not an involution');
      }
    }
  } catch (e) {
    bad(`read path threw: ${(e as Error).message}`);
  } finally {
    await db.$disconnect();
  }
}

readPathChecks().then(() => {
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL UNIT CHECKS PASSED');
  process.exit(failures ? 1 : 0);
});
