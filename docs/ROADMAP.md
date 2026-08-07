# Perception — Roadmap: from prototype to working product

This document is the MVP spec turned into a build order. It audits where the
prototype already proves the spec, then sequences the remaining work into
**loops** — short cycles that each end in something demoable and true, not a
percentage on a burndown. Ship Loop 3 and you have a product; everything after
makes it a business.

Companion docs: [`MVP_SPEC.md`](MVP_SPEC.md) (what and why),
[`ARCHITECTURE.md`](ARCHITECTURE.md) (how), [`CONNECTORS.md`](CONNECTORS.md)
(platform reality).

---

## Where we are: the P0 audit

What the clickable prototype already proves versus what production still owes.
"Proven" means the design, domain model, and rules are working code in this
repo; "owed" is the real-service replacement behind the same interfaces.

| P0 item | Proven in prototype | Still owed by production |
|---|---|---|
| P0.1 Workspaces | Org → brands → role model; brand filter scoping every screen | Auth, sessions, Postgres persistence, org-scoped queries |
| P0.2 Campaign + composer | Full five-step flow; shared message vs. per-channel overrides; drafts-only AI posture | Model-backed generation behind the same `generateCampaign` contract |
| P0.3 Core connectors | Connector contract, FB/IG/LinkedIn adapters, capability sheets, live validation | Real OAuth, media upload, publish, metrics; Meta App Review + LinkedIn MDP approval |
| P0.4 Email | Preview, CAN-SPAM structural blocks (footer/subject), suppression concept | Block editor UI, MJML rendering, provider integration, real suppression at send |
| P0.5 Calendar | Month/week/lanes/list, drag-reschedule, side-panel edit, ideas tray, bulk approve | Persistence only — the interaction design is done |
| P0.6 Safeguards | The whole preflight engine runs live in-editor | Re-run server-side at publish time (connections die between approval and fire) |
| P0.7 States & approvals | Full state machine + approver flows in UI | Server-side enforcement + notifications |
| P0.8 Publishing pipeline | Designed end-to-end in ARCHITECTURE.md; failure/retry/reconnect UX proven | The actual BullMQ workers, idempotency keys, audit writes |
| P0.9 Media library | Library, alt-text-once, preflight enforcement, per-destination ratio/duration data | S3 uploads, FFmpeg renditions |
| P0.10 Tracking + analytics | Outcome-first dashboards, plain-language reports, tables behind every chart | Link redirector, conversion snippet, metrics-sync jobs |
| P0.11 Industry templates | 9 templates across 4 industries wired into the composer | Grow the catalog from beta feedback |

The pattern: **the product design and domain logic are done; production owes
persistence, auth, and real I/O** — all behind interfaces that already exist.

---

## The loops

Each loop has a goal, a scope, and an exit test phrased as something you can
watch happen. Loops are roughly two weeks with a small team; run them in
order — each one stands on the previous.

### Loop 0 — Steel thread

**Goal:** a deployed, authenticated, persistent skeleton.

- Staging + production environments, CI, deploy pipeline
- PostgreSQL + `prisma migrate` from the existing schema
- Auth (Clerk or Auth0): sign-up, org creation, memberships with roles
- Seeder that loads the demo workspace into a real org (the demo data is the
  living spec — it becomes the test fixture)

**Exit test:** two users in two orgs each see only their own seeded workspace,
in staging, over HTTPS.

### Loop 1 — Campaigns and calendar persist

**Goal:** the prototype tour, on a database.

- CRUD + server-side state machine for campaigns, content items, variations
- Approvals with server enforcement (creator can't approve own work if brand
  requires review)
- Calendar and composer read/write the API instead of the in-memory store

**Exit test:** run the full README tour on persisted data; reload anywhere and
nothing resets.

### Loop 2 — Media pipeline

**Goal:** real files with real constraints.

- S3 uploads, alt text, tags; usage tracking
- FFmpeg probe on upload (duration, dimensions) feeding the same preflight
  rules the prototype runs
- Renditions per destination (ratio crops, duration trims)

**Exit test:** upload an actual 118-second 9:16 video; the calendar shows the
same "too long for Instagram Reels" block the demo shows, computed from the
real file.

### Loop 3 — First real publish ⭐ *the product moment*

**Goal:** one connector, end to end, trustworthy.

- Meta OAuth with encrypted token vault (envelope encryption, KMS)
- Facebook Pages adapter live: destinations, media upload, publish
- BullMQ publish worker: fire at the scheduled minute, idempotency key per
  (variation, slot), `PublicationAttempt` recorded either way, audit events
- Failure surfacing: non-retryable errors become the visible failed state with
  working reconnect → retry

**Exit test #1:** schedule a post in Perception; watch it appear on a real
Facebook Page at the scheduled minute, with the audit trail.
**Exit test #2 (the one that matters):** revoke the token mid-schedule; the
post fails *visibly*, Home shows the fix path, reconnect + retry publishes it.
Nothing double-posts when the worker is killed and restarted.

### Loop 4 — Three networks + token health

**Goal:** the multi-channel promise, for real.

- Instagram professional + LinkedIn adapters live
- Token-health scheduler: refresh ahead of expiry, downgrade to
  `EXPIRING`/`NEEDS_RECONNECT`, notify before failure, hold dependent posts
  with the visible reason

**Exit test:** one campaign, approved once, publishes to Facebook, Instagram,
and LinkedIn; the expiry drill (let a token lapse) alerts before any publish
fails.

### Loop 5 — Email for real

**Goal:** the email studio ships.

- Block editor (header/text/image/button/product/coupon/testimonial/divider/
  footer — stored as the JSON `blocks` already in the schema), MJML → HTML
- Provider integration (SES or Postmark), test sends, domain setup flow
  (SPF/DKIM/DMARC status)
- Suppression enforced at send; welcome sequence + click-based follow-up

**Exit test:** send a campaign email to a seeded list; unsubscribe one
contact; the next send suppresses them automatically; CAN-SPAM blocks fire on
a footer-less draft exactly as the prototype shows.

### Loop 6 — Tracking and analytics on live data

**Goal:** the outcome dashboard stops being a fixture.

- Link redirector minting tagged short links + QR per campaign
- Conversion snippet + webhook ingestion (form, booking, trial, purchase)
- Metrics-sync jobs per connector feeding `Metric` rows
- The analytics screens read live aggregates; plain-language report generated
  from real numbers

**Exit test:** click a tracked link, submit the demo quote form, and watch the
lead attributed to campaign + channel on the dashboard within a minute.

### Loop 7 — Beta hardening

**Goal:** four real businesses run on it.

- 2FA enforcement options, export + deletion tools, rate limiting, request
  audit
- Onboarding (industry → template → first campaign in under 15 minutes)
- Publication-success metric instrumented and alarmed (target ≥ 99%)
- Support tooling: impersonation with consent, failure triage queue

**Exit test:** private beta with one business per launch industry runs two
weeks; ≥ 99% publication success; every failure that occurred surfaced itself
with an actionable fix.

---

## Parallel track A — platform reviews (starts during Loop 0)

Reviews gate launch dates, not code. File early, build against test accounts.

| Application | Needed for | When to file | Lead-time reality |
|---|---|---|---|
| Meta App Review (pages_*, instagram_*) | Loops 3–4 | Loop 0 | Weeks; dev-mode test users unblock development meanwhile |
| LinkedIn Marketing Developer Platform | Loop 4 | Loop 0 | Application + use-case review |
| Google Business Profile API access | P1 channel | Loop 1 | Per-project approval queue |
| X API paid tier decision | Tier-2 surface | Loop 5 | Commercial decision — posting sits behind paid tiers; price it as an add-on or absorb |
| Pinterest API review | Tier-2 | Loop 5 | Standard review |
| Threads (rides the Meta app) | Tier-2 | with Meta review | Same app, additional surface |
| TikTok content audit | Tier-3 | Loop 6 | Unaudited apps = private/draft uploads only |
| YouTube API compliance audit | Tier-3 | Loop 6 | Unaudited projects = uploads locked private |
| Nextdoor partner program | Tier-3 | Loop 6 | Partner-gated; assisted-manual mode ships regardless |
| Google Ads / LSA / Microsoft / Yelp | HUD v2 (read-only sync) | post-beta | Ads APIs are open; LSA needs per-category business verification |

## Parallel track B — surface expansion tiers

The strategy stays *depth first*: three excellent connectors + email + the
calendar before breadth. Expansion follows adoption signal, in tiers that
match API reality (full matrix in [`CONNECTORS.md`](CONNECTORS.md)):

- **Tier 1 (the MVP):** Facebook, Instagram, LinkedIn, Email, Website, then
  Google Business Profile.
- **Tier 2 (cheap wins):** Bluesky (open protocol, no review — the easiest
  connector we will ever ship), Threads (same Meta app), Pinterest, X (once
  the paid-tier economics are priced), Reddit (organic-with-care + ads).
- **Tier 3 (gated):** TikTok and YouTube (audits), Snapchat (ads-first),
  WhatsApp (template messaging), SMS (10DLC), Nextdoor (partner or assisted
  manual).
- **Ads-only (HUD v2):** read-only spend + lead sync from Google Ads, Local
  Services Ads, Microsoft Ads, and Yelp Ads into the HUD and campaign
  attribution. **Full ads management stays out of scope** — the HUD tells
  owners where paid money works; it does not replace Ads Manager.

## The Ad HUD's role

The HUD (in the left nav) is the map of this whole document, rendered for the
owner instead of the engineer:

- **v1 — shipped in this prototype:** the full landscape (21 surfaces),
  organic + paid capability, cost models, per-industry fit scoring, coverage
  and gap recommendations per business, honest API reality-checks drawn from
  the same capability sheets the connectors use.
- **v2 — post-beta:** live spend + lead sync from the ads-only networks, so
  "what the surfaces are producing" covers paid and organic side by side.
- **v3:** recommendations reference actual campaign history ("search captured
  38 leads your Reels created — raise the LSA budget in October").

## Risk register

| Risk | Hits | Mitigation |
|---|---|---|
| Meta/LinkedIn review slips | Beta date | File in Loop 0; build on dev-mode accounts; beta can run with test users |
| X API pricing changes again | Tier-2 cost model | Decide at Tier 2, not before; price as add-on if needed |
| Email deliverability (cold domain) | Loop 5+ | Warm the sending domain from Loop 3; provider-managed IPs; DMARC from day one |
| Nextdoor API never opens | The local promise | Assisted-manual publishing (reminder + ready-to-paste kit) ships regardless — the HUD already marks it honestly |
| Rate limits at multi-tenant scale | Publish reliability | Per-tenant queues with jitter; publication-success metric alarms at < 99% |
| Ads-scope creep | Focus | HUD stays read-only on paid until the organic core hits its reliability bar |

## Working agreements

1. No channel ships without its preflight rules — validation is part of the
   adapter, not an afterthought.
2. No publish path is enabled for real accounts until it is idempotent and
   audited.
3. The demo workspace stays the living spec: new capabilities land there
   first, so the clickable product and the shipped product never diverge.
