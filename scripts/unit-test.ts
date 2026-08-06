/**
 * Unit checks for logic that is easy to get subtly wrong and impossible to
 * eyeball: AT Protocol facet byte offsets, grapheme counting, and token
 * encryption. Run with `npm run test:unit`.
 */
import { buildFacets, graphemeLength } from '../src/lib/publishers/bluesky';
import { encrypt, decrypt, pkceChallenge, safeEqual } from '../src/lib/oauth/crypto';
import { mastodonPublisher } from '../src/lib/publishers/mastodon';
import { readFileSync } from 'node:fs';
import { countSegments, encodingOf, previewSms, proposeDowngrade, checkQuietHours } from '../src/lib/sms';
import { checkBudget, forecastMonth, projectAds, projectEmail, projectSms } from '../src/lib/projection';
import { amount, money, range } from '../src/lib/pricing';
import { reachFor, reachSummary } from '../src/lib/audience';
import type { Contact as ContactShape } from '../src/lib/types';

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

console.log('\n== SMS segments: the arithmetic a bill is made of ==');
{
  // The boundaries. 160 is one segment; 161 is *two of 153*, not "one plus
  // one", because concatenation costs a header in every part. Getting this
  // wrong understates a long campaign by a whole segment per recipient.
  eq(countSegments('a'.repeat(160)).segments, 1, '160 GSM-7 characters is one segment');
  eq(countSegments('a'.repeat(161)).segments, 2, '161 characters is two segments (153 each, not 160)');
  eq(countSegments('a'.repeat(306)).segments, 2, '306 characters exactly fills two segments');
  eq(countSegments('a'.repeat(307)).segments, 3, '307 characters spills into a third');

  // The trap this whole module exists for.
  eq(encodingOf("Don't"), 'GSM-7', 'a straight apostrophe stays in the cheap alphabet');
  eq(encodingOf('Don\u2019t'), 'UCS-2', 'a curly apostrophe forces UCS-2');
  eq(countSegments('a'.repeat(70)).segments, 1, '70 plain characters is one segment');
  eq(countSegments('a'.repeat(69) + '\u2019').segments, 1, '70 characters with a curly quote still fits one');
  eq(countSegments('a'.repeat(70) + '\u2019').segments, 2, 'one more character and it costs two');

  // Surrogate pairs are two code units, and the carrier bills both.
  eq(countSegments('\u{1F600}'.repeat(35)).units, 70, '35 emoji are 70 UTF-16 units, not 35');
  eq(countSegments('\u{1F600}'.repeat(35)).segments, 1, '35 emoji fill exactly one UCS-2 segment');
  eq(countSegments('\u{1F600}'.repeat(36)).segments, 2, '36 emoji need a second');

  // Extended GSM characters cost two septets each.
  eq(countSegments('{}[]').units, 8, 'four bracket characters cost eight septets');
  // ...and an escape pair cannot straddle a boundary, so the walk beats the
  // naive division. 153 euro signs is three segments; ceil(306/153) says two.
  const euros = countSegments('\u20ac'.repeat(153));
  euros.segments === 3 && Math.ceil(euros.units / 153) === 2
    ? ok('escape pairs are not split across segments (153 euro signs = 3, formula says 2)')
    : bad(`escape-pair boundary handling wrong: ${euros.segments} segments for ${euros.units} septets`);

  eq(countSegments('').segments, 0, 'an empty message costs nothing');
}

console.log('\n== SMS: naming the character that costs the money ==');
{
  const c = countSegments('Don\u2019t miss it');
  eq(c.culprits.length, 1, 'exactly one culprit found');
  eq(c.culprits[0]?.codePoint, 'U+2019', 'the culprit is identified by code point, not by looks');
  eq(c.culprits[0]?.replacement, "'", 'a plain equivalent is offered');

  const d = proposeDowngrade('Don\u2019t miss our sale \u2014 25% off\u2026');
  eq(d.after.encoding, 'GSM-7', 'swapping typographic characters returns the message to GSM-7');
  eq(d.text, "Don't miss our sale - 25% off...", 'the rewrite says the same thing');
  eq(d.changed.length, 3, 'three distinct characters reported as changed');

  // Emoji are a choice, not a typo — they must survive a downgrade untouched.
  const e = proposeDowngrade('Sale today \u{1F600}');
  eq(e.text, 'Sale today \u{1F600}', 'an emoji is never silently removed');
  eq(e.after.encoding, 'UCS-2', 'and the message stays UCS-2, honestly');
}

console.log('\n== SMS: the parts you cannot opt out of ==');
{
  const p = previewSms('Sale on now');
  p.optOutAdded && p.fullText.includes('Reply STOP')
    ? ok('opt-out language is appended and counted')
    : bad('opt-out not appended');
  const q = previewSms('Sale on now. Text STOP to quit.');
  !q.optOutAdded ? ok('a hand-written opt-out is not duplicated') : bad('second opt-out appended over the top of one');

  // Quiet hours are the recipient's, not the sender's.
  const morning = checkQuietHours(new Date('2026-08-06T14:00:00Z'), -7); // 7am Pacific
  const midday = checkQuietHours(new Date('2026-08-06T18:00:00Z'), -7); // 11am Pacific
  const night = checkQuietHours(new Date('2026-08-07T04:00:00Z'), -7); // 9pm Pacific
  !morning.allowed && midday.allowed && !night.allowed
    ? ok('quiet hours block 7am and 9pm local, allow 11am')
    : bad(`quiet hours wrong: 7am=${morning.allowed} 11am=${midday.allowed} 9pm=${night.allowed}`);
  morning.nextOpening && morning.nextOpening > new Date('2026-08-06T14:00:00Z')
    ? ok('a blocked send is told when it may go')
    : bad('no next opening offered');
}

console.log('\n== Projection: exact money and guessed money never merge ==');
{
  // Email inside and outside a free allowance.
  const free = projectEmail({ provider: 'ses', recipients: 1000, sentThisMonth: 0, domainVerified: true });
  eq(free.exactCents, 0, '1,000 sends inside a 3,000 free allowance cost nothing');
  const paid = projectEmail({ provider: 'ses', recipients: 1000, sentThisMonth: 3000, domainVerified: true });
  eq(paid.exactCents, 10, 'the same send costs 10 cents once the allowance is gone');
  const half = projectEmail({ provider: 'ses', recipients: 1000, sentThisMonth: 2500, domainVerified: true });
  eq(half.exactCents, 5, 'a send straddling the allowance is billed only for the part outside it');

  const unverified = projectEmail({ provider: 'ses', recipients: 100, sentThisMonth: 0, domainVerified: false });
  unverified.blockers.length > 0
    ? ok('an unverified sending domain blocks the send')
    : bad('unverified domain allowed through');

  // SMS: the fixed costs that dominate a small list.
  const sms = projectSms({ body: 'Three slots left. Book now.', recipients: 400, country: 'US', paidFixedCostIds: [] });
  const fixed = sms.items.filter((i) => i.kind === 'fixed').reduce((s, i) => s + i.cents, 0);
  const msgs = sms.items.filter((i) => i.kind === 'message').reduce((s, i) => s + i.cents, 0);
  fixed > msgs * 3
    ? ok(`on 400 contacts setup (${fixed}c) dwarfs the messages (${msgs}c) — the point of showing it`)
    : bad(`setup ${fixed}c vs messages ${msgs}c — expected setup to dominate`);
  sms.blockers.some((b) => /10DLC/i.test(b.label))
    ? ok('unpaid 10DLC registration blocks the send')
    : bad('a text can be sent without registering');

  const registered = projectSms({ body: 'Three slots left. Book now.', recipients: 400, country: 'US', paidFixedCostIds: ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'] });
  eq(registered.blockers.length, 0, 'once registered, nothing blocks');
  eq(registered.exactCents, msgs, 'and the cost is just the messages');

  // A curly apostrophe must show up as money, not just as a warning.
  const plain = projectSms({ body: "Don't miss it", recipients: 1000, country: 'US', paidFixedCostIds: ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'] });
  const curly = projectSms({ body: 'Don\u2019t miss it', recipients: 1000, country: 'US', paidFixedCostIds: ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'] });
  eq(plain.exactCents, curly.exactCents, 'a short message costs the same either way (both fit one segment)');
  // 130 characters plus the 23-character opt-out is 153 — one GSM-7 segment
  // with room to spare, and three UCS-2 segments. This is the worst case and
  // it is not contrived: it is a normal-length promotional text.
  const paidIds = ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'];
  const longPlain = projectSms({ body: 'a'.repeat(129) + "'", recipients: 1000, country: 'US', paidFixedCostIds: paidIds });
  const longCurly = projectSms({ body: 'a'.repeat(129) + '\u2019', recipients: 1000, country: 'US', paidFixedCostIds: paidIds });
  longCurly.exactCents === longPlain.exactCents * 3
    ? ok(`one invisible character triples a 130-character send (${longPlain.exactCents}c -> ${longCurly.exactCents}c on 1,000 contacts)`)
    : bad(`expected a 3x jump, got ${longPlain.exactCents}c vs ${longCurly.exactCents}c`);
  longCurly.notes.some((n) => /U\+2019/.test(n))
    ? ok('and the projection names the character responsible')
    : bad('the cost jumped without saying why');
}

console.log('\n== Ads: the spend is exact, the outcome is a range ==');
{
  const ads = projectAds([{ channel: 'facebook', dailyBudgetCents: 2000, days: 14 }]);
  eq(ads.exactCents, 28000, 'a $20/day flight for 14 days costs exactly $280');
  eq(ads.items[0]?.certainty, 'exact', 'the spend is not an estimate — you set it');
  eq(ads.outcomes.length, 1, 'one outcome range reported');
  const o = ads.outcomes[0];
  o && o.low < o.high
    ? ok(`impressions stay a range: ${o.low.toLocaleString('en-US')}-${o.high.toLocaleString('en-US')}`)
    : bad('outcome collapsed to a single number');

  const thin = projectAds([{ channel: 'tiktok', dailyBudgetCents: 300, days: 7 }]);
  thin.notes.some((n) => /learning phase/i.test(n))
    ? ok('an underfunded flight is called out rather than quietly under-delivering')
    : bad('no warning for a budget below the platform minimum');

  // Formatting must never invent a midpoint.
  range({ lowCents: 700, highCents: 2500 }).includes('\u2013')
    ? ok('a range renders as a range')
    : bad('range() collapsed to one number');

  // Zero is "free" when it is a price and zero when it is a quantity. Mixing
  // them produced "only free is left of your cap", which is not a sentence.
  eq(money(0), 'free', 'a zero price is "free"');
  eq(amount(0), '0\u00a2', 'a zero quantity is a number');
  eq(money(2500), '$25.00', 'dollars render with cents below $100');
  eq(amount(1), '1\u00a2', 'a whole cent has no decimals');
  eq(amount(1.1), '1.10\u00a2', 'a fractional rate keeps them — 1.1c must not round to 1c');
  eq(amount(75), '75\u00a2', 'sub-dollar amounts stay in cents');
  const headroom = checkBudget({ capCents: 100, spentCents: 100, projectedCents: 50, hardStop: true });
  !headroom.message.includes('free')
    ? ok('a budget message never calls an empty balance "free"')
    : bad('budget message says: ' + headroom.message);
}

console.log('\n== Budgets: a hard cap actually stops ==');
{
  const soft = checkBudget({ capCents: 50000, spentCents: 48000, projectedCents: 5000, hardStop: false });
  soft.wouldExceed && !soft.blocked ? ok('a soft cap warns and lets it through') : bad('soft cap behaved like a hard one');
  const hard = checkBudget({ capCents: 50000, spentCents: 48000, projectedCents: 5000, hardStop: true });
  hard.blocked ? ok('a hard cap refuses the send') : bad('hard cap did not block');
  const fine = checkBudget({ capCents: 50000, spentCents: 1000, projectedCents: 500, hardStop: true });
  !fine.wouldExceed && fine.message.includes('left') ? ok('inside the cap it reports headroom') : bad('no headroom reported');
}

console.log('\n== Forecast: it refuses to extrapolate from nothing ==');
{
  const early = forecastMonth({ spentCents: 1200, committedCents: 0, now: new Date('2026-08-02T12:00:00Z') });
  eq(early.projectedMonthEndCents, 1200, 'on day 2 it reports spend, not a run rate');
  /too early|days in/i.test(early.basis) ? ok('and says why') : bad('no explanation for the refusal: ' + early.basis);

  const mid = forecastMonth({ spentCents: 15500, committedCents: 5000, now: new Date('2026-08-15T12:00:00Z') });
  // 155c/day x 31 days + 5000 committed
  eq(mid.projectedMonthEndCents, Math.round((15500 / 15) * 31) + 5000, 'mid-month it carries the run rate to month end and adds commitments');
  mid.projectedMonthEndCents > mid.spentCents ? ok('the projection exceeds spend-to-date') : bad('projection below spend');
}

console.log('\n== Reach: who can actually be reached ==');
{
  const mk = (n: number, over: Partial<ContactShape>): ContactShape => ({
    id: `c${n}`, name: `Person ${n}`, email: `p${n}@example.com`, phone: '+15550000000',
    brandId: 'b1', segmentIds: [], emailConsent: 'subscribed', smsConsent: 'subscribed',
    source: 'seed', addedAt: '2026-01-01', lastActivity: '2026-01-01', ...over,
  });
  const contacts = [
    mk(1, {}),
    mk(2, { smsConsent: 'pending' }),
    mk(3, { phone: null }),
    mk(4, { emailConsent: 'unsubscribed', smsConsent: 'unsubscribed' }),
    mk(5, { emailConsent: 'pending', smsConsent: 'unsubscribed' }),
  ];
  const email = reachFor(contacts, 'email');
  const sms = reachFor(contacts, 'sms');
  eq(email.reachable, 3, 'email reaches everyone subscribed with an address');
  eq(sms.reachable, 1, 'SMS reaches far fewer — pending consent counts as no');
  sms.exclusions.some((e) => /TCPA/.test(e.fix ?? ''))
    ? ok('the reason pending consent is excluded is stated, with the penalty')
    : bad('no explanation for excluding pending SMS consent');
  reachSummary(sms).includes('1 of 5') ? ok('the summary leads with the shortfall') : bad('summary hides the gap: ' + reachSummary(sms));
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
  // The write path is tenant-scoped now, so these need a principal rather
  // than a bare organization id — which is the point: there is no way to call
  // it without saying who is acting.
  const actor = {
    userId: 'u-dana', organizationId: fx.ORG.id, role: 'owner' as const,
    email: 'dana@example.com', name: 'Dana Reyes', sessionId: 'test',
  };

    // Approving is two rows, one user action. Forgetting the second leaves the
    // approvals queue showing work that is already done.
    {
      const pending = await db.approval.findFirst({ where: { decision: 'PENDING' } });
      if (!pending) {
        console.log('  SKIP no pending approval in the seed');
      } else {
        const before = await db.channelVariation.findUnique({ where: { id: pending.variationId } });
        await applyMutation(actor, { type: 'setStatus', variationId: pending.variationId, status: 'approved' });
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
        await applyMutation(actor, {
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
        await applyMutation(actor, { type: 'toggleDestination', destinationId: d.id });
        const mid = await db.publishDestination.findUnique({ where: { id: d.id } });
        await applyMutation(actor, { type: 'toggleDestination', destinationId: d.id });
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
