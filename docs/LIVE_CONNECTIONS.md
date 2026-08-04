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

## Bluesky works right now

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
