# What Perception can actually do — a capability analysis

*Rewritten 2026-08-06, after Phases 1–6. Supersedes the survey of 2026-08-05,
which described a product with no database, no worker and no attribution —
all three of which now exist. Grounded in the codebase, not in memory of it.*

## The diagnosis in one line

**Perception now decides far better than it acts.**

The last analysis found a rich domain model with no runtime. That has been
fixed: there is a database, a worker that fires scheduled posts, real
attribution, a learning loop, authentication, and a cost model that is careful
to the cent. What has not kept pace is the part that touches the outside world.

| Layer | Size | State |
|---|---|---|
| Domain model + engines (`src/lib`) | ~11,800 lines | Rich, tested, honest |
| Screens (`src/app/**/page.tsx`) | ~6,200 lines | Complete |
| Server surface (`src/app/api`) | ~2,500 lines | Real, authenticated, tenant-scoped |
| Worker + queue | ~420 lines | Real; fires scheduled posts |
| Tests | ~3,200 lines | 487 checks, five suites |
| **Channels that can actually publish** | **2 of 18** | Bluesky, Mastodon |
| **Channels that can actually send** | **0 of 2** | Email and SMS write rows and stop |
| **Ad platforms that can actually buy** | **0 of 11** | Priced, planned, never purchased |

## Verified: what is genuinely real

Each of these was checked against the code, not assumed.

- **Persistence.** Prisma + Postgres, migrations, a seeded workspace of 1,285
  contacts. Reads and writes both go through it.
- **The write path.** Optimistic reducer, persistence sidecar, ordered writes,
  tenant scoping on every mutation.
- **The worker.** Claims scheduled variations by compare-and-swap, publishes,
  records attempts, and reclaims after a staleness timeout.
- **Attribution.** `trackedLink.create`, `linkClick.create` and
  `conversion.create` all run at runtime, driven by `/r/<code>` and
  `/api/events`. A click on a real link on a real page produces a real row.
- **The learning loop.** Computes over those real rows, with sample floors and
  a refusal to claim a pattern it cannot support.
- **Auth and tenancy.** Sessions, scrypt, capability gates, 404-not-403, CSP
  with a per-request nonce, rate limits sized against real traffic.
- **The cost model.** Segment counting, free-allowance depletion, fixed costs,
  three cost shapes never averaged, budgets with a hard stop that refuses.

## Verified: what is hollow

### 1. `/api/send` does not send anything

It computes the audience, prices it correctly, writes `EmailDelivery` or
`SmsDelivery` rows at `QUEUED`, writes `SpendEntry` rows, and returns
`{ ok: true, queued: 1110 }`. **No provider is ever called.** No code anywhere
advances a delivery past `QUEUED`. There is no Resend, SES, Postmark or Twilio
client in the repository.

The composer reports *"Queued for 1,110 people — free charged."* Nothing was
queued anywhere but our own table, and nothing will ever pick it up.

### 2. Nothing in the product creates a contact

`contact.create` appears exactly once in the codebase: in `prisma/seed.ts`.

There is no CSV import (the button on `/contacts` has no handler), no signup
form, no opt-in capture, no path from a conversion to a contact record, and no
double opt-in for SMS consent.

### 3. Metrics are seeded, never ingested

`metric.create` appears nowhere outside the seed. `/analytics` is computing
honestly over numbers that were invented at seed time. Attribution data is
real; platform-reported impressions and engagement are not.

### 4. The inbox is a fixture

`conversation.create` appears only in the seed. No comment, DM, review or reply
ever arrives.

### 5. Sixteen channels cannot publish, eleven cannot be bought

The worker is honest about it — it writes `no publisher for <channel>` and
fails the attempt rather than pretending — but `/advertise` presents routes
whose "Ready now" refers to the account being connected, not to our ability to
act on it.

---

## The three findings that should set priorities

### Finding 1 — The spend ledger reports money that was never spent

This is the most serious thing in the audit, and it is not a missing feature.
It is a **correctness bug in the subsystem built specifically to be honest
about money.**

`/spend` exists because blended, vague, after-the-fact cost reporting is the
thing this product refuses to do. Right now it reports spend for messages that
do not exist. Every number on that screen — month-to-date, the run rate, the
forecast, the budget consumed — is derived from sends that never happened.

Worse, it fails in the direction that looks fine. A ledger that *under*-reports
gets noticed when the invoice arrives. This one over-reports against an invoice
that will never come, so nothing contradicts it.

The fix is small and should not wait for a provider integration: **write the
ledger when a provider confirms, not when a row is inserted.**

### Finding 2 — The product's headline advice is for a list it cannot help you build

`/advertise` opens with *"Start here: email your list"* and `routes.ts` says of
the owned audience: *"finite — it only grows if something else feeds it."*

Nothing in the product feeds it.

This is a strategic gap, not an oversight. The whole ranking argument — that
your own list beats bought reach by four orders of magnitude — is correct, and
it makes list growth the highest-leverage feature in the product. A business
that follows the advice exhausts its list and has no next move. Every paid
route exists to convert strangers into people who know you, and there is no
mechanism to capture the conversion.

The pieces are already there: `/p.js` ships a tracking snippet to customer
websites, `/api/events` ingests conversions, and conversions frequently carry
an email address. The distance from "we recorded a quote request" to "we
recorded a quote request and added them to the list, pending confirmation" is
short.

### Finding 3 — Reach is modelled far ahead of execution

Eighteen channels are modelled, priced, capability-mapped and preflight-checked.
Two can publish. Zero ad platforms can be bought through the product.

This is defensible — the model is what makes the advice good, and building it
first was right — but the gap now shows in the pathway screen, where a route
can say "Ready now" and mean only that an account is connected.

---

## The plan

Ordered by the principle this codebase already runs on: **never ship the thing
that lies, then make the recommended path actually work, then widen.**

### Phase 7 — Stop the ledger claiming money that did not move — **done**

1. Split the delivery lifecycle properly: `QUEUED → SENT → DELIVERED | BOUNCED |
   FAILED`, and make `QUEUED` mean *waiting for a provider* rather than *done*.
2. Move the `SpendEntry` write from "request accepted" to "provider confirmed",
   keyed by the provider's own message id.
3. Separate **committed** from **charged** on `/spend`, and show queued-but-unsent
   as its own figure rather than folding it into either.
4. Make `/send` say what actually happened: *"Queued — nothing has been sent
   yet, because no sending service is connected."*

**Acceptance — met.** With no provider configured a send writes zero
`SpendEntry` rows, `/spend` shows `0¢` charged against its committed figure,
and both the composer and the worker say why. Against a stub provider,
dispatch writes exactly one ledger row per confirmed message, a replayed
confirmation returns `already-recorded` and does not double-charge, and a
provider that reports success without a message id is failed rather than
billed.

### Phase 8 — Email that actually arrives *(the route we recommend first)*

The product tells every user to start with email. That has to work before
anything else is widened.

1. A `Sender` interface with one real implementation (Resend first — smallest
   surface; SES second, because it is 12× cheaper and the price screen already
   argues for it).
2. Worker-side batching with per-message idempotency, so a retry cannot double-send.
3. A **suppression list** as its own table, checked at send time — bounces and
   complaints must never be re-mailed, and this is what protects the domain
   reputation the preflight already warns about.
4. Inbound webhooks: bounce and complaint → suppression; delivery, open and
   click → delivery status. Signature-verified.
5. Ledger written on provider confirmation (Phase 7's contract).

**Acceptance:** an email sent from the composer arrives in a real mailbox; a
hard bounce suppresses that address and the next send's reach drops by one; the
ledger total equals the provider's own count for the period.

### Phase 9 — Grow the list *(the missing half of our own advice)*

1. **CSV import** with explicit consent capture per row, a dry-run preview
   showing how many are actually reachable, and a hard refusal to mark anyone
   `SUBSCRIBED` without a stated basis.
2. **Signup forms** — hosted and embeddable, reusing the `/p.js` snippet already
   on customer sites.
3. **Conversions become contacts.** A quote request carrying an email creates a
   `PENDING` contact linked to the campaign that caused it — which also closes
   the attribution loop back into the audience.
4. **Double opt-in** for SMS, because `PENDING` correctly counts as *no* and the
   only way out of `PENDING` is a confirmation we do not currently send.

**Acceptance:** a form submission on the mock site creates a pending contact; a
confirmation click promotes it to subscribed; the reach figure on `/advertise`
increases by one and the projected cost of the next send rises accordingly.

### Phase 10 — Text messages that actually arrive

1. Twilio adapter behind the same `Sender` interface.
2. **STOP / HELP / START inbound handling**, mapped to consent state. This is
   legally required and is the single highest-risk gap in the SMS path: we
   collect the consent state and enforce it, but nothing can currently change
   it in response to a reply.
3. Delivery receipts → delivery status; per-segment cost reconciled against
   Twilio's reported segment count, which is the check that proves `sms.ts` right.
4. **Quiet hours enforced at fire time**, per recipient, by the worker — the
   composer's check is for the hour the owner picked, and a scheduled send lands
   at a different one.

**Acceptance:** a text arrives; replying STOP flips consent to unsubscribed
within one polling interval; the next send excludes that contact and the
projection drops by exactly one recipient's cost; our segment count matches the
provider's for a message containing an emoji.

### Phase 11 — Real numbers in the reporting

1. Metric ingestion per channel where the API allows it, into `Metric`.
2. `/analytics` stops reading seeded rows and labels anything it cannot measure —
   the `MEASURED` / `UNMEASURED` split already exists and is currently decorative.
3. Reconcile platform-reported clicks against our own tracked-link clicks and
   **show the discrepancy** rather than picking one.

**Acceptance:** with a live account connected, an impression count on
`/analytics` traces to a platform response; with none, the screen says the
number is unavailable instead of showing a seeded one.

### Phase 12 — Widen: publishers, then ads

1. Publishers in fit order, not alphabetical: Facebook and Instagram first,
   because those are what the ranking actually recommends for the industries
   we model.
2. **Ads: take the honest position.** Full API integration with eleven ad
   platforms is a year of work and most of it is approval queues. The
   defensible product is *plan here, buy there* — build the flight on `/spend`,
   hand off with a deep link and a pre-filled brief, and import the spend back
   for reporting. Say that plainly on the screen rather than implying we place
   the buy.

**Acceptance:** a planned flight produces a brief an owner can act on in the
platform's own tool, and the spend comes back into the ledger tagged
`certainty: 'estimated'` until the invoice settles.

---

## What is deliberately not on this list

- **A second ad-network integration before email works.** Widening before the
  recommended path functions would be building the demo outward.
- **Sixteen more publishers.** The worker already fails honestly on an
  unimplemented channel, which is the correct behaviour to have while waiting.
- **Improving the cost model.** It is the most finished thing in the codebase.
  Its problem is not accuracy; it is that nothing downstream of it moves money.
