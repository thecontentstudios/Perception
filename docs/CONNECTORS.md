# Perception — Connector Strategy

"Connect everywhere" means a dependable connector framework built on official
platform APIs — never unsupported browser automation.

## The contract

Every destination implements one interface
(`src/lib/connectors/contract.ts`):

connect · refreshAuth · listDestinations · **validate** · uploadMedia ·
publish (idempotent) · enqueue · edit? · remove? · getStatus ·
collectMetrics · pullEvents · normalizeError

Each adapter translates the universal campaign (`ChannelVariation` +
`MediaAsset`s) into its platform's format. Adding a destination is a new
adapter plus a registry entry (`src/lib/connectors/registry.ts`) — the
campaign system, calendar, preflight engine, and workers don't change.

`validate` is pure and synchronous so the UI runs it live while editing; the
same capability sheet that drives validation renders the Connections screen.

## Capability matrix (first + second release)

| Platform | API | Wave | Formats | Native schedule | Edit | Delete | Metrics | Inbox | Key constraint |
|----------|-----|------|---------|-----------------|------|--------|---------|-------|----------------|
| Facebook Pages | Meta Graph API | 1 | post, story | ✔ | ✔ | ✔ | ✔ | ✔ | App Review for pages_* scopes |
| Instagram professional | Instagram Graph API | 1 | post, reel, story | ✖ (we fire at time) | ✖ | ✖ | ✔ | ✔ | Requires IG pro account linked to a FB Page |
| LinkedIn | Posts API | 1 | post | ✖ | ✔ | ✔ | ✔ | ✔ | Marketing Developer Platform approval for org posting |
| Google Business Profile | Business Profile API | 1 (fast follow) | update | ✖ | ✔ | ✔ | ✔ | reviews/Q&A | Per-project access approval; no video in local posts |
| Email | SES / Postmark / SendGrid / Mailgun | 1 | email | ✔ | ✖ | ✖ | ✔ | replies | SPF + DKIM + DMARC before send; CAN-SPAM enforced structurally |
| Website | WordPress REST / Shopify Admin / webhooks | 1 | banner, blog, landing page | ✔ | ✔ | ✔ | ✔ | ✖ | Conversion snippet feeds analytics |
| TikTok | Content Posting API | 2 | video (9:16, ≤10 min) | ✖ | ✖ | ✖ | ✔ | ✔ | **Unaudited apps limited to private/draft uploads — audit early** |
| YouTube | Data API v3 | 2 | video, short | ✔ | ✔ | ✔ | ✔ | ✔ | **Uploads from unaudited projects locked private; quota cost high** |
| SMS | Twilio or similar | 2 | sms | ✔ | ✖ | ✖ | ✔ | ✔ | 10DLC registration; consent + STOP language required |
| Pinterest / Threads / Bluesky / X | official APIs (Bluesky = AT Protocol) | 2 | varies | varies | varies | varies | varies | varies | Scoped per-platform during expansion |

**Platform approval work starts in Phase 1 (product definition), not after the
interface is finished** — Meta App Review, LinkedIn MDP access, TikTok
audit, and YouTube API compliance all gate go-live dates.

## Error normalization

Adapters map raw platform errors to one shape:

`auth_expired` · `permission_missing` · `rate_limited` · `media_rejected` ·
`content_rejected` · `destination_missing` · `network` · `unknown`

with `retryable` and `userAction`. Retry policy and UI messaging key off this
shape, so a LinkedIn 401 and a Meta 190 produce the same honest experience:
a visible failed state, the reason, and the one-click fix.

## Never silently discard

If a platform can't take a piece of content (video too long, ratio
unsupported, format unavailable), the item is **held with a human-readable
warning and a suggested fix** — it is never dropped, downscaled, or skipped
without the owner seeing why.
