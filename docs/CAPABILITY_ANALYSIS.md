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
| Domain model + engines (`src/lib`) | ~14,600 lines | Rich, tested, honest |
| Screens (`src/app/**/page.tsx`) | ~6,200 lines | Complete |
| Server surface (`src/app/api`) | ~3,700 lines | Real, authenticated, tenant-scoped |
| Worker + queue | ~420 lines | Real; fires scheduled posts |
| Tests | ~4,800 lines | 719 checks, five suites |
| **Channels that can actually publish** | **3 of 18** | Bluesky, Mastodon, Facebook Pages |
| **Channels that can actually send** | **2 of 2** | Email through Resend, SMS through Twilio |
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

### 1. `/api/send` does not send anything — **fixed in Phases 7, 8 and 10**

It computed the audience, priced it correctly, wrote `EmailDelivery` or
`SmsDelivery` rows at `QUEUED`, wrote `SpendEntry` rows, and returned
`{ ok: true, queued: 1110 }`. **No provider was ever called.** No code anywhere
advanced a delivery past `QUEUED`. There was no Resend, SES, Postmark or Twilio
client in the repository.

The composer reported *"Queued for 1,110 people — free charged."* Nothing was
queued anywhere but our own table, and nothing would ever pick it up.

Now: Phase 7 moved the charge to after the provider accepts, so a ledger row
means a provider took the message; Phase 8 made email real through Resend, with
bounces, complaints and a suppression list; Phase 10 made SMS real through
Twilio, with STOP honoured and the segment count reconciled against the
carrier's.

### 2. Nothing in the product creates a contact — **fixed in Phase 9**

`contact.create` appeared exactly once in the codebase: in `prisma/seed.ts`.

There are now three ways in — a hosted or embedded signup form, a CSV import
with a preview, and website conversions — all through one `intake()` function
that refuses to mark anybody subscribed without a recorded basis.

### 3. Metrics are seeded, never ingested — **fixed in Phase 11**

The audit line was itself too kind: `metric.create` appeared nowhere *at all*,
seed included — the table was orphaned. Bluesky and Mastodon engagement is now
read through the same publishers that post, snapshotted per reading, with the
platforms' permanent silences (neither reports a view count to anyone) carried
as facts rather than blanks. Email and SMS report from our own send rows.
What remains open is the wide middle: Facebook, Instagram and the rest report
rich metrics and have no reader yet — the report marks them "not measured"
rather than pretending either way.

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

### Phase 8 — Email that actually arrives — **done**

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

**Acceptance — met, against a stand-in provider.** A send goes out through the
real Resend adapter over a real HTTP round trip, personalised, with
`List-Unsubscribe` and an idempotency key; a signed hard bounce suppresses the
address and the next send's reach drops by exactly one; a soft bounce does not;
an unsigned webhook is refused; and the ledger holds one row per confirmed
message.

**Not verified: delivery to a real mailbox.** That needs a Resend account and a
verified domain, which this environment does not have. The adapter speaks the
real protocol and the stand-in enforces the same contract — bearer auth,
idempotency keys, the `{ id }` response, Svix-signed webhooks — so what remains
untested is the account, not the code.

### Phase 9 — Grow the list — **done**

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

**Acceptance — met.** A form submission with no session creates a pending
contact carrying the exact sentence it agreed to; a real confirmation email
goes out through the Phase 8 adapter; clicking its link promotes the contact to
subscribed and the reachable audience grows by exactly one. A CSV import
previews before writing, refuses `SUBSCRIBED` without a stated basis, and a
website quote request now becomes a pending contact instead of being discarded.

### Phase 10 — Text messages that actually arrive — **done**

1. Twilio adapter behind the same `Sender` interface — the first time that
   interface has been asked to hold two genuinely different providers.
2. **STOP / HELP / START inbound handling**, mapped to consent state. This was
   legally required and the single highest-risk gap in the SMS path: the product
   collected the consent state and enforced it, and nothing could change it in
   response to a reply.
3. Delivery receipts → delivery status, with only the permanent error codes
   suppressing. Per-segment cost reconciled against Twilio's reported segment
   count — which is what proved `sms.ts` right and the dispatcher wrong.
4. **Quiet hours enforced at fire time**, per recipient, from an area-code time
   zone inference that holds unknown numbers to the most restrictive US window.

**Acceptance — met.** A text goes out through a real HTTP round trip to an
adapter that reports the carrier's own segment count; replying STOP flips
consent to unsubscribed, suppresses the number, and writes a `ConsentRecord`
quoting what was typed; the next send excludes that contact and the projection
drops by exactly that recipient's cost; our segment count matches the provider's
for a message containing an emoji, and a mismatch is recorded as a fault rather
than silently adopting the carrier's number.

The reconciliation earned its place immediately: it caught that SMS was being
priced with merge fields and an opt-out line filled in, and sent with neither.

### Phase 11 — Real numbers in the reporting — **done**

1. Metric ingestion into `Metric` — Bluesky and Mastodon readers behind an
   optional `fetchMetrics` on the Publisher contract, snapshotted per reading
   because the platforms keep no history. (The audit found `Metric` had zero
   writes anywhere — not even the seed. "Seeded, never ingested" was generous.)
2. The global `MEASURED`/`UNMEASURED` arrays replaced with an answer **per
   channel per metric**, in four states: measured / not connected /
   not ingested / **unavailable**. The old split said "needs a platform
   connection" about email — the channel Phases 7–10 made exactly measurable —
   and could not say that Bluesky and Mastodon publish no view count to
   anybody, which is a fact an owner needs before comparing channels on reach.
3. Provider clicks and tracked-link clicks shown side by side with the gap
   named, once volume makes the ratio meaningful. Mail scanners inflate one;
   unminted links hide from the other; averaging is nobody's measurement.

**Acceptance — met.** A published post's engagement traces to a platform
response through the real adapter (7 favourites + 3 boosts + 2 replies = 12,
read off the wire); email impressions are the delivered count and marked
measured; a number the platform never publishes renders as "not reported" with
the reason on hover, distinct from "connect to see"; a deleted post is
recorded as gone once and never asked about again — but a 404 on a post never
read successfully is an error, not a tombstone.

### Phase 12 — Widen: publishers, then ads — **done** (Facebook; Instagram needs media)

1. Publishers in fit order, not alphabetical: Facebook and Instagram first,
   because those are what the ranking actually recommends for the industries
   we model.
2. **Ads: take the honest position.** Full API integration with eleven ad
   platforms is a year of work and most of it is approval queues. The
   defensible product is *plan here, buy there* — build the flight on `/spend`,
   hand off with a deep link and a pre-filled brief, and import the spend back
   for reporting. Say that plainly on the screen rather than implying we place
   the buy.

**Acceptance — met for the ads half.** A planned flight produces a brief an
owner can act on in the platform's own tool (budget, audience, attributed
destination, deep link, and the stated position that we do not place the buy);
imported spend lands tagged `certainty: 'estimated'`, kept apart from charged;
settling flips it to exact with the invoice difference as its own adjustment
row. Facebook Pages publishes through the real Graph API adapter against a
stand-in server, and its metrics reader returns `post_impressions` — the
first channel where reach is a number rather than an honest null. Instagram
waits on media handling in the publish path: a caption-only IG post does not
exist, and pretending otherwise would ship a publisher that refuses every
real post.

---

## The second audit — against the owner's own words (August 7)

The ask, restated: *an easy to understand platform where you can see, read and
upload social media, post across all social medias, run texting and email
campaigns, and a full ad service with easy to read pricing.*

Measured against the code, not the docs:

| Ask | State | The gap, verified |
|---|---|---|
| Post across all social media | **3 of 18 publish** | Bluesky, Mastodon, Facebook Pages — text only |
| **Upload** — posts that carry images | **Missing entirely** | No publisher touches media. The library uploads and stores; nothing it holds can reach a platform. Blocks Instagram outright |
| **See / read** — what went out, what happened, who replied | **Half built** | Published posts and real metrics exist; refresh is a button; the inbox hears only SMS — a Facebook comment or Mastodon reply never arrives |
| Texting and email campaigns | **Done and real** | Send, price, consent, STOP, bounces, quiet hours, reconciliation — Phases 7–10 |
| Full ad service, readable pricing | **Loop open at the far end** | Plan → brief → estimated spend → settled invoice all work. But a flight's *results* are not shown beside its cost, even though the UTMs to do it are already captured on every conversion |

The pattern in the gaps: **the outbound spine is real, and the product is
still mute in both directions that make social feel alive** — nothing it
posts carries a picture, and nothing anyone says back reaches the screen.

## The plan, continued

### Phase 13 — Pictures through the pipe — **done**

Media end to end: variation → publisher, as **bytes** — Mastodon and Bluesky
demand an upload, and a URL contract would have coupled the other two to our
hosting. Bluesky `uploadBlob` + `app.bsky.embed.images` (alt text required by
the schema itself), Mastodon `/api/v2/media` with `description`, Facebook the
`/photos` edge where the text becomes the caption. One hand-built multipart
encoder the mocks can parse back; a new stand-in PDS for Bluesky.

**Acceptance — met.** The same image arrived on all three platforms with its
alt text intact and byte-for-byte length verified; a variation whose approved
image has vanished from storage fails the job *before* anything is posted —
a text-only stand-in for a photo post is a different post nobody approved.

### Phase 14 — Instagram and Threads

Both unblock the moment media flows. Instagram container → publish (media
required — the refusal for caption-only posts is honest, stated in the
composer). Threads is text-friendly and Meta-shaped. Takes the registry to
5 of 18, and the two it adds are the two the fit ranking actually
recommends after Facebook.

### Phase 15 — The product can hear

Replies into the inbox from the platforms we already hold grants for:
Mastodon notifications and Bluesky mentions/replies via polling (both APIs
support it today, no new approval queues), Facebook comment webhooks where
review allows. Every reply lands as a `Conversation` beside the SMS ones.
Also: the metrics refresher moves from a button to the worker on a visible
schedule, with its last-run time on screen — a stale number must look stale.

### Phase 16 — Close the ad loop

The flight's results beside its money. Conversions already carry
`utmCampaign`; flights already stamp `utm_source`/`utm_campaign` on their
destination. Join them: each flight shows clicks, conversions and revenue it
caused, and cost per result computed only from settled spend — exact money
over measured outcomes, the range carried, never a blended average.

### Phase 17 — The rest of the registry, tiered honestly

- **Feasible now:** Pinterest, Reddit, Google Business Profile.
- **Paid or approval-gated:** X (paid API), LinkedIn, TikTok, YouTube,
  WhatsApp — build behind the same contract, ship as each account clears.
- **No organic API exists:** Nextdoor, Snapchat — the screen says so and
  routes their budget to the ad brief instead. An honest "cannot" outranks
  a fake "soon".

## What is deliberately not on this list