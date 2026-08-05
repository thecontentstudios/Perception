/**
 * Unit checks for logic that is easy to get subtly wrong and impossible to
 * eyeball: AT Protocol facet byte offsets, grapheme counting, and token
 * encryption. Run with `npm run test:unit`.
 */
import { buildFacets, graphemeLength } from '../src/lib/publishers/bluesky';
import { encrypt, decrypt, pkceChallenge, safeEqual } from '../src/lib/oauth/crypto';
import { mastodonPublisher } from '../src/lib/publishers/mastodon';

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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL UNIT CHECKS PASSED');
process.exit(failures ? 1 : 0);
