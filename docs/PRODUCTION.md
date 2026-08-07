# Running this in production

What is in place, what is deliberately not, and what an operator has to decide.

---

## What the audit found

Before this pass, the honest state was:

- **No authentication anywhere.** Every route — including every mutation —
  answered any caller who could reach the port.
- **One hardcoded tenant.** `ORG.id` from the demo fixtures appeared in nine
  files. The schema had `organizationId` on every table and not one query used
  it as a variable.
- **No rate limiting** on the two endpoints that are deliberately public.

Multi-tenancy was nominal: the columns were there, the isolation was not.

---

## Authentication

Server-side sessions, not JWTs. A JWT cannot be revoked before it expires,
which makes "sign out everywhere" and "that laptop was stolen" impossible to
honour. A session is a row, and ending one is a `DELETE`.

- The cookie holds 32 random bytes; the database stores **only its SHA-256**,
  so a database dump does not hand over live sessions. No slow hash there on
  purpose — the token already has 256 bits of entropy, so there is nothing to
  brute force. That reasoning does not transfer to passwords, which is why
  those use scrypt.
- Passwords use **scrypt from Node's standard library**. Not because it beats
  argon2 on the margins, but because a native-addon dependency in the auth path
  breaks on a platform upgrade, and "nobody can log in" is a worse outage than
  almost anything else this product can do. Cost parameters are stored in the
  hash, so raising them later upgrades people on next login rather than forcing
  a reset.
- **Membership is re-read on every request** rather than trusted from the
  session row. Roles change and people leave; a session that keeps its old role
  until expiry is how a former employee still has access on their way out.
- Login returns **the same message and the same status** for unknown email,
  wrong password, and no-password-set — and takes comparable time, because a
  2ms rejection for an unknown address says exactly as much as the message
  would have.

## Authorization

Seven roles, six capabilities. The one worth naming: **approving is separate
from creating.** The whole point of an approval step is that the author is not
always the person who signs it off, and collapsing them removes the control the
customer thought they had. `/api/mutate` re-checks `approve` when the mutation
is an approval, so a creator cannot approve their own post by calling the API
directly.

## Tenant isolation

Authentication answers *who are you*. It does not stop a signed-in customer
passing somebody else's id — that is the bug that survives auth, and it is the
one the tests probe hardest.

Every write re-reads its target **through the organization**: `ownVariation`,
`ownDestination`, `ownAccount`, `ownBrandId`. An id from another tenant
resolves to nothing and the request 404s. It returns 404 rather than 403
deliberately — confirming that an id exists but belongs to someone else is
itself a disclosure.

The worker has no session, so it takes the organization from the row it is
about to publish. That is the only correct source once more than one tenant
exists.

## The two deliberately public endpoints

`/api/events` and `/r/[code]` cannot be authenticated — they are called by
visitors' browsers and by customers' own websites.

- **Which tenant** is answered by a public per-organization `ingestKey` the
  snippet carries, or by the click, which already belongs to exactly one
  organization. A key naming one tenant plus a click naming another is refused
  rather than reconciled.
- The key is **public by design**: it ships in the page source of every
  customer site. It identifies a workspace and authorizes nothing.
- Both are rate limited. Over the limit, `/r/[code]` still redirects and only
  skips the recording — a broken link is the worse failure.

## What the CSP taught us

The first policy was a static `script-src 'self'`, and it **took the entire
application down**: Next emits inline bootstrap scripts, the browser refused
every one, and the app rendered a blank body. Three things came out of fixing
it properly:

1. `'unsafe-inline'` would have restored the app and removed the only thing the
   policy protects against. An injected `<script>` is inline too.
2. A nonce has to be generated per request, so it lives in middleware, not
   config.
3. **Next can only stamp a nonce onto a page it renders per request.** The app
   pages were statically prerendered, so there was no nonce to stamp. The root
   layout is now `force-dynamic` — which is right anyway for a product where
   every page shows one customer's workspace.

`'strict-dynamic'` was tried and removed: it makes browsers ignore `'self'`, so
every chunk request was refused. Stricter on paper, broken in practice unless
every script tag carries the nonce.

`style-src` still allows `'unsafe-inline'`. React writes style attributes and
there is no nonce mechanism for those. That is a real gap, not an oversight —
CSS injection is much narrower than script injection, but it is not nothing.

## Configuration

`src/lib/config.ts` runs at boot and **refuses to start** in production with a
missing encryption key or a non-HTTPS `APP_URL`. Loopback is exempt, because
`npm start` sets `NODE_ENV=production` and refusing to run the build you want
to test before deploying helps nobody.

`DATABASE_URL` is a warning, not a problem: the app is built to run on
fixtures, and an operator deliberately deploying the demo should not be blocked
— but should see it every restart.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | for real use | Without it, the sample workspace, stored nowhere |
| `TOKEN_ENCRYPTION_KEY` | **yes in production** | 32 bytes base64: `openssl rand -base64 32` |
| `APP_URL` | **yes in production** | Must be https unless loopback — the session cookie's Secure flag follows it |
| `REDIS_URL` | for scheduling | Without it nothing publishes on a schedule, and rate limits are per-instance |
| `TRUSTED_PROXY_COUNT` | set it | How many proxy hops to skip when reading the client IP. `0` if exposed directly |
| `SEED_PASSWORD` | if seeding | The default is well-known and printed as such |

`TRUSTED_PROXY_COUNT` deserves a note. `x-forwarded-for` is **appendable by the
client** — a request can arrive with a forged header and the real proxy simply
adds to it. So the trustworthy value is the *last* entry, and how many to skip
depends on your deployment. An IP-keyed rate limit that reads a spoofable
header is one an attacker opts out of.

---

## Still open, honestly

**The OAuth token store is a JSON file.** `.tokens/grants.json` is
process-local and single-tenant. The `ConnectedAccount.encryptedTokens` column
exists and is unused. This is the largest remaining gap: multi-tenant token
storage has to move into the database before a second customer connects an
account.

**The S3 driver does not exist.** `src/lib/storage.ts` is an interface with a
local-filesystem implementation. The seam is real and tested; the S3 side is
not written.

**No 2FA.** The `twoFactorEnabled` column exists and nothing reads it.

**No account lifecycle.** No signup, no invitations, no password reset, no
email verification. Users exist because the seed created them.

**No CSRF tokens.** State-changing routes check the `Origin` header, which
handles the browser case — a cross-site page cannot forge an `Origin`. Absent
`Origin` is allowed, because non-browser clients cannot be CSRF victims. A
double-submit token would be belt and braces.

**Publishing has only ever run against mocks.** Bluesky and Mastodon are real
implementations verified against real protocols; Instagram, LinkedIn and the
rest need platform review before they can be exercised at all.

**Sessions are swept but not on a schedule.** `sweepExpiredSessions()` exists;
nothing calls it periodically yet.

---

## Verifying it

```bash
npm run test:security     # 41 checks: auth, isolation, headers, rate limits
npm test                  # all five suites, 254 checks
```

The security suite is written as an attacker would probe — unauthenticated
calls, another tenant's ids, forged origins, timing — rather than as a
description of the code. A test that mirrors the implementation passes whatever
the implementation does.
