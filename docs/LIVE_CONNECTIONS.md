# Live connections — the real OAuth pipeline

Everything in the demo workspace is simulated. This is not: the code in
`src/lib/oauth/` and `src/app/api/connect/` performs genuine authorizations
against real platform endpoints.

## What is real

- **Authorize URLs** built against each platform's actual endpoint, with the
  real scope strings.
- **PKCE (S256)** where the provider requires it — Google, X, TikTok. Google
  additionally gets `access_type=offline` + `prompt=consent`, without which no
  refresh token is ever issued.
- **State verification** on the callback, compared in constant time. Without
  it, anyone could hand a user a crafted callback URL and bind an
  attacker-controlled account to their workspace.
- **Token exchange** — a real POST to the provider's token endpoint, handling
  both `body` and HTTP Basic client authentication.
- **AES-256-GCM encryption at rest** with a random 96-bit nonce per token.
  Tampering is detected by the auth tag rather than silently decrypting to
  garbage.
- **Tokens never reach the browser.** Not in an API response, not in a prop,
  not to the account owner. The status endpoint returns metadata only, and the
  suite asserts no secret ever appears in it.

## What we cannot do for you

Registering the app. Every provider except Bluesky requires you to create an
app in that platform's developer console, obtain a client id and secret, and
register a redirect URI — and most require passing app review before the
publishing scopes work with accounts other than your own. No tool can do that
on your behalf; anything claiming otherwise is using unofficial automation
that will get the account banned.

What the product *can* do is make it painless. The setup panel in
**Connections → Set up real connections** shows, per provider:

- whether credentials are present (never their values),
- the exact redirect URI to paste into the console, copyable,
- the exact env var names to set, copyable,
- the scopes we will request and how destinations get listed.

## Two connectors work right now

Both need no developer console and no review:

| | How you connect | Where the limit comes from |
|---|---|---|
| **Bluesky** | Handle + app password (Settings → App Passwords) | Protocol: 300 graphemes |
| **Mastodon** | Instance host + access token (Preferences → Development) | **The server** — read from `/api/v1/instance` at connect time |

They were chosen to be dissimilar on purpose. If one interface fits a
repo-and-DID model *and* a per-user-hostname REST model, it will fit the
Meta/LinkedIn/Google shapes too. Concretely, they disagree about almost
everything that matters:

- **Counting.** Bluesky counts graphemes and counts URLs in full. Mastodon
  counts code points and counts every URL as a flat 23 characters. The same
  string measures 64 on one and 44 on the other; the suite asserts they
  *disagree*, because a shared counter would be flattening a real rule.
- **Limits.** Bluesky's 300 is fixed by the protocol. Mastodon's is whatever
  the instance says — plenty run 1500. Assuming the 500 default would reject
  perfectly valid posts, so we read the server's own configuration and store
  it with the grant.
- **Expiry.** Bluesky access JWTs are short-lived, so a 401 means *refresh and
  retry*. Mastodon tokens don't expire, so a 401 means *revoked* — reconnect,
  never retry. Same status code, opposite correct response.
- **Idempotency.** Bluesky needs it built by us. Mastodon honours an
  `Idempotency-Key` header natively; verified against a mock instance that a
  repeated key returns the original status and creates no second post.

## Bluesky

AT Protocol needs no developer app, no console, and no review. Create an app
password in **Bluesky → Settings → App Passwords**, paste it with your handle,
and the connection is live. The app refuses anything that isn't an app
password (`xxxx-xxxx-xxxx-xxxx`), because app passwords are revocable
independently of the account password.

This connector exists to prove the pipeline end to end while the paperwork for
everything else is in flight.

## Setup

```bash
# 1. The encryption key is required before anything can connect.
openssl rand -base64 32          # → TOKEN_ENCRYPTION_KEY in .env.local

# 2. Optional: set APP_URL if you are not on localhost:3000
#    (it determines the redirect URI you register)

# 3. Per provider, from the setup panel:
#    create the app → register the printed redirect URI → set the two env vars
```

Then restart, open **Connections**, and the configured providers show a live
**Connect** button that sends you to the platform's own consent screen.

Grants are written to `.tokens/grants.json` (gitignored, mode 0600) — that
store is deliberately small and swappable, and is the seam where production
drops in Prisma. It exists so a developer can complete a real OAuth round trip
without provisioning Postgres first, not to run a business on.

## Endpoints

| Route | Does |
|---|---|
| `GET /api/connect/status` | What's configured, what's missing, which grants are live. No secrets. |
| `GET /api/connect/[channel]/start` | Mints state + PKCE, redirects to the platform. `428` with a fix if unconfigured. |
| `GET /api/connect/[channel]/callback` | Verifies state, exchanges the code, stores encrypted. |
| `POST /api/connect/bluesky` | Real AT Protocol session from handle + app password. |
| `GET /api/connect/bluesky` | Is the session live, and whose. |
| `DELETE /api/connect/bluesky` | Forget the session. |


## Publishing for real

`POST /api/publish { channel, text }` publishes through a stored grant.
Bluesky is implemented; every other channel returns **501 with a reason**
rather than pretending. Quick Post shows live accounts in their own green
block, visually separate from the demo workspace — a post the world can see
must never look like one that goes nowhere — and the confirmation says so
explicitly before you send.

### The two details that are easy to get silently wrong

**Facets use UTF-8 byte offsets, not JavaScript string indices.** Any emoji or
accented character before a link shifts the byte position. In our own test
string, `indexOf` gives 22 where the correct byte offset is 26 — a four-byte
drift caused by one 🍂 and an em dash. Get this wrong and the link either
highlights the wrong span or renders as plain text. We index the encoded
bytes, and `npm run test:unit` asserts the decoded slice equals the URL
exactly.

**The 300 limit counts graphemes, not `String.length`.** The family emoji
👨‍👩‍👧‍👦 is one grapheme, seven code points, and eleven UTF-16 units. Counting
with `.length` rejects valid posts. We use `Intl.Segmenter`.

### Token refresh

An expired access JWT is the most common recoverable failure, so the publisher
retries **once** after refreshing with the stored refresh JWT, rotating and
re-encrypting both. Only if the refresh itself fails does it ask the owner to
reconnect. Verified end to end against a local AT Protocol mock: first publish
hit an expired token, refreshed, retried, and succeeded.

### Testing

```bash
npm run test:unit   # facet byte offsets, grapheme counting, crypto, PKCE
npm run test:ui     # the browser suite, incl. publish refusals
npm test            # both
```
