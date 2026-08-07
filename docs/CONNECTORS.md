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
| X (Twitter) | X API v2 | 2 | post (280 chars, ≤2:20 video) | ✖ | ✖ | ✔ | ✔ | ✔ | **Posting requires a paid API tier — price it before committing** |
| Threads | Threads API (Meta) | 2 | post (500 chars, 1 tag) | ✖ | ✖ | ✔ | ✔ | ✔ | GA API; rides the same Meta app + review |
| Mastodon | Mastodon REST API v1 | 2 | post (per-instance limit, often 500–1500) | ✔ | ✔ | ✔ | ✔ | ✔ | Open network, **no review**; token created in the user's own instance settings. Limit and rules are per-instance and read at connect time |
| Bluesky | AT Protocol | 2 | post (300 chars) | ✖ | ✖ | ✔ | ✖ | ✔ | Open protocol, **no review at all** — easiest connector to ship; no ads product |
| Pinterest | Pinterest API v5 | 2 | pin (2:3 best) | ✖ | ✔ | ✔ | ✔ | ✖ | Long content half-life; every Pin needs a destination link (preflight enforces) |
| Reddit | Reddit Data API | 2 | post | ✖ | ✔ | ✔ | ✖ | ✔ | Per-subreddit self-promotion rules; hashtags flagged as spam by preflight |
| Nextdoor | Partner program | 3 | post | ✖ | ✖ | ✖ | ✖ | ✖ | **Posting API partner-gated — assisted manual publishing until access lands**; Nextdoor Ads open |
| Snapchat | Snap Marketing API / Public Profiles | 3 | story (9:16, ≤60s) | ✖ | ✖ | ✖ | ✔ | ✖ | Organic limited to approved profiles; ads are the dependable path |
| WhatsApp Business | Cloud API (Meta) | 3 | template message | ✔ | ✖ | ✖ | ✔ | ✔ | Pre-approved templates + opt-in required; opt-out enforced by preflight |
| SMS | Twilio or similar | 3 | sms | ✔ | ✖ | ✖ | ✔ | ✔ | 10DLC registration; consent + STOP language required |

### Ads-only surfaces (no posting feed — HUD spend/lead sync)

| Network | Product | Cost model | Note |
|---------|---------|-----------|------|
| Google Ads (Search) | Google Ads API | CPC | Intent capture; campaign spend + conversions sync read-only into the HUD |
| Google Local Services Ads | LSA program | per-lead | "Google Guaranteed" badge; home-services categories; business verification required |
| Microsoft Ads (Bing) | Microsoft Advertising API | CPC | Imports Google campaigns; cheaper CPCs, older/desktop audience |
| Yelp Ads | Yelp Ads program | CPC | Placement at the moment of local comparison; reviews do the selling |

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
