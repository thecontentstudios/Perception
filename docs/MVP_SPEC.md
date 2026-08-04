# Perception — Prioritized MVP Specification

**Positioning:** One campaign, everywhere your customers are. Plan social posts, email, and website promotions from one simple calendar.

**Central idea:** Create one campaign, adapt it to every channel, approve it once, and manage the results from one place. The campaign — not the individual post — is the product's central object.

This document turns the product blueprint into a build order. The clickable prototype in this repository demonstrates every P0 flow with demo data; the production milestones below replace the simulated parts with real services.

---

## P0 — the MVP is not shippable without these

| # | Capability | Acceptance criteria |
|---|-----------|---------------------|
| P0.1 | **Multi-business workspaces** | An org owns brands; every query is org-scoped; a user belongs to orgs through role-carrying memberships (owner, admin, manager, creator, approver, analyst, guest). |
| P0.2 | **Campaign object + composer** | Five-step guided flow: outcome → source material → generate drafts → visual review → approve & schedule. AI output is always drafts; nothing publishes without explicit approval. Owner writes the message once; per-channel variations can be overridden without losing the shared message. |
| P0.3 | **Connectors: Facebook Pages, Instagram professional, LinkedIn** | OAuth connect/reconnect, destination listing, media upload, publish, status, metrics pull, comment ingestion — all through the shared connector contract (`src/lib/connectors/contract.ts`). Meta App Review + LinkedIn Marketing Developer Platform approval underway before beta. |
| P0.4 | **Email campaigns** | Block editor (header, text, image, button, product card, coupon, testimonial, divider, footer), desktop/mobile preview, test send, segments, delivery via an established provider (SES/Postmark/SendGrid/Mailgun). CAN-SPAM enforced structurally: send is impossible without unsubscribe footer + postal address + verified sender domain; unsubscribed contacts are suppressed at send time. |
| P0.5 | **Calendar (month + week) with drag-reschedule** | Cards show thumbnail, campaign color, platform, time, status, assignee, warnings. Drag to reschedule; side-panel editing without leaving the calendar; unscheduled-ideas tray; list view for accessibility and bulk approve. |
| P0.6 | **Intelligent safeguards (preflight)** | Human-readable warnings before scheduling: video too long, wrong image ratio, disconnected/expired account, missing unsubscribe footer, ≥3 promotions same day, missing CTA, missing alt text, over caption limit. Content a platform can't take is *never silently discarded* — it's surfaced and held. |
| P0.7 | **States & approvals** | idea → draft → review → approved → scheduled → published / failed. Approvers (including client/guest reviewers) can approve or request changes; approval requirements configurable per brand. |
| P0.8 | **Background publishing with retry** | BullMQ workers publish at the scheduled minute; automatic retries with backoff; idempotency keys prevent double-posting; failures become visible states with a one-click retry and a reconnect path; every attempt lands in the audit log. |
| P0.9 | **Media library** | Central assets with alt text stored once and enforced by preflight; usage tracking; FFmpeg-backed renditions per destination (ratio crops, duration trims) in production. |
| P0.10 | **Tracking links + basic analytics** | Every campaign automatically gets tagged links (+ QR). Dashboard leads with business outcomes (quote requests, bookings, registrations, revenue, cost per lead) and a plain-language report sentence, with impressions/clicks second and a full table view. |
| P0.11 | **Industry templates** | Ready campaigns for the four launch industries (landscaping, house rentals, music studio, software): channels, cadence, media checklist, CTA, email sequence, measurable outcome. |

## P1 — fast follow (reliability release)

- Google Business Profile + WordPress/website banner + landing pages as first-class channels (adapters already specced).
- Unified inbox: comments, DMs, mentions, reviews, email replies with assignment and reply-from-connected-account.
- Token-health scheduler: refresh before expiry, expiration alerts, "posts held until reconnected" messaging.
- Automated welcome sequence + click-based follow-up emails.
- Conversion ingestion from website events (form, booking, trial, purchase) feeding campaign dashboards.
- Two-factor auth enforcement options, full audit-log UI, export & deletion tools.
- Measured North-star ops metric: **successful-publication rate ≥ 99%** (publishes succeeded / publishes attempted, excluding user-cancelled).

## P2 — expansion

- TikTok (Content Posting API) and YouTube (Data API) once app audits clear; Pinterest, Threads, Bluesky (AT Protocol), X.
- Shopify/WooCommerce/Webflow/Wix/Squarespace; webhooks + Zapier-style automation recipes.
- SMS with 10DLC registration and structural opt-out enforcement.
- Recommendations engine ("email converts best — send the last call to Past Clients").
- Paid-ad management, full CRM, and broad social listening remain **out of scope** — the strategy is three excellent connectors, email, and a brilliant calendar before breadth.

## Explicit non-goals for MVP

- No unofficial/browser-automation publishing — official APIs only.
- No auto-publish of AI output — drafts require human approval, always.
- No dozens of shallow connectors — depth first.

## Delivery plan

| Phase | Length | Exit criteria |
|-------|--------|---------------|
| 1 — Product definition | 2–3 wks | 10–15 owner interviews done; this prototype tested with them; platform-review applications filed; pricing hypothesis tested |
| 2 — Working MVP | 10–14 wks | P0 list complete in production code; private beta with one business per launch industry |
| 3 — Reliability | 4–6 wks | Retry/reconnect flows hardened; security review done; platform reviews approved; publication success ≥ 99%; onboarding + support tooling |
| 4 — Expansion | ongoing | P1/P2 by adoption signal |

## Success metrics

- Activation: first campaign scheduled across ≥2 channels within 24h of signup.
- Reliability: ≥99% successful publications; 100% of failures surfaced with an actionable fix.
- Outcome clarity: every active campaign shows a plain-language result sentence a non-marketer understands.
- Retention proxy: % of campaigns created from templates or duplicated from past campaigns.
