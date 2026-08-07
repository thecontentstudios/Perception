# Perception — Technical Architecture

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Web app | Next.js + TypeScript | This repo; App Router |
| API | Next.js server routes → NestJS as service surface grows | Same TypeScript domain model |
| Database | PostgreSQL via Prisma | `prisma/schema.prisma` is the canonical model |
| Jobs & scheduling | Redis + BullMQ | Publish queue, metrics sync, token health |
| Media | S3-compatible storage + CDN; FFmpeg workers | Per-destination renditions (crop/trim) |
| Auth | Clerk or Auth0 (or carefully built in-house later) | 2FA, org memberships |
| Email delivery | SES / Postmark / SendGrid / Mailgun | Never self-built SMTP infrastructure |
| Analytics | Event pipeline → PostgreSQL first | Warehouse later if volume demands |
| Infra | Managed cloud, separate staging + production | IaC from day one |

## Service map

```
User interface (Next.js)
      ↓
Campaign API
      ├── Content & media service        (items, variations, assets, renditions)
      ├── Calendar & approval service    (scheduling, states, approvals, preflight)
      ├── Email service                  (blocks → MJML/HTML, segments, suppression)
      ├── Connector service              (one contract, per-platform adapters)
      ├── Analytics service              (tracked links, conversions, reports)
      └── Job scheduler (Redis/BullMQ)
                    ↓
       Platform-specific publishing workers
```

The prototype implements the domain layer of this diagram in `src/lib/`
(types, connector contract + adapters, preflight engine, campaign generator)
with simulated I/O, so the shapes are proven before the services are stood up.

## Publishing pipeline (the part that must never lie)

1. **Enqueue.** Approving a scheduled variation enqueues a job keyed by an
   idempotency key = `variation.id + scheduled slot`. Rescheduling replaces the
   job; the key changes with the slot.
2. **Publish.** At fire time the worker loads the variation, re-runs preflight
   (connections can die between approval and fire), uploads media, publishes
   through the adapter, and records a `PublicationAttempt` either way.
3. **Retry.** Failures classified by `normalizeError()`: retryable
   (rate-limit, network, transient 5xx) back off exponentially with a capped
   attempt count; non-retryable (auth_expired, permission_missing,
   content_rejected) stop immediately and surface as a **visible failed state**
   with a one-click fix path (reconnect → retry).
4. **Idempotency.** Workers publish at-most-once per key: a crashed worker
   that already reached the platform reconciles via `getStatus()` before ever
   re-posting.
5. **Audit.** Every attempt, approval, connection change, and manual retry is
   an `AuditEvent`. The audit log is append-only.

## Token lifecycle

- Tokens encrypted at rest (envelope encryption; KMS-managed keys), never
  serialized to the client.
- A token-health job refreshes ahead of expiry; failures downgrade the
  connection to `EXPIRING` → `NEEDS_RECONNECT` and notify the owner *before*
  a publish fails, holding dependent scheduled posts with a visible reason.
- Minimal scopes requested per platform; scopes shown to the user in
  Connections.

## Analytics pipeline

- Every campaign mints tagged links (`utm_campaign`) and a QR code.
- A lightweight site snippet (and platform webhooks where available) posts
  conversion events — form submission, booking, trial, purchase — to the
  Analytics service, attributed to campaign + channel.
- Reports lead with outcomes (leads, bookings, revenue, cost per lead) and a
  generated plain-language sentence; impressions and clicks are supporting
  detail with a full table view.

## Environments & safety

- Staging and production fully separated (data, queues, platform apps).
- Org-level isolation enforced in the data layer (all root entities carry
  `organizationId`).
- Bulk publish/delete require confirmation; sensitive campaigns can require
  approval before scheduling.
- Export and deletion tooling ships with the MVP (small businesses churn and
  must be able to leave with their data).
