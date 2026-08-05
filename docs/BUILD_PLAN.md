# Build plan — from prototype to working product

Derived from [`CAPABILITY_ANALYSIS.md`](CAPABILITY_ANALYSIS.md). Four phases,
sequenced so each is the prerequisite for the next. Every step has an
acceptance test that can fail, because "done" needs to mean something.

**Rule for every iteration:** land it behind the existing interfaces, keep the
demo workspace working, and add a check to `npm test`. No phase is complete
until its acceptance test passes from a cold start.

---

## Phase 1 — Runtime spine

*Makes it a product instead of a prototype. Nothing else matters first.*

| # | Step | Acceptance |
|---|------|-----------|
| 1.1 | Prisma client + migration from the existing schema; seed the demo workspace | `npx prisma migrate dev` succeeds; seed produces the same four businesses and five campaigns the fixtures do |
| 1.2 | Read path: server components query the database instead of `demo-data.ts` | Calendar, Campaigns, and Connections render from DB rows; deleting the fixture import doesn't break them |
| 1.3 | Write path: server actions replace reducer mutations (reschedule, approve, connect, map destination) | Drag a card, reload the page, **it stays moved** |
| 1.4 | Queue + worker: enqueue on approval, fire at the scheduled minute, re-run preflight at fire time, retry with backoff | A post scheduled two minutes out publishes on its own with the browser closed |
| 1.5 | Failure surfaces: worker writes `PublicationAttempt`, sets `failed`, audit row | Kill a token mid-flight; the failure appears on Home with a working fix |

**Phase gate:** close the laptop, reopen it an hour later, and the scheduled
post went out.

---

## Phase 2 — Measurement

*Makes the reporting true. Highest value per line in the backlog.*

| # | Step | Acceptance |
|---|------|-----------|
| 2.1 | Mint a tracked link per variation; `GET /r/[code]` records the click, sets a first-party attribution cookie, 302s with UTMs appended | Clicking a published post's link writes a click row and lands on the right page |
| 2.2 | `POST /api/events` ingests `form_submission` / `booking` / `purchase` / `call`, attributes via the cookie, writes `Conversion` | A simulated form post shows up attributed to the campaign that caused it |
| 2.3 | A drop-in snippet customers paste on their site | One `<script>` tag produces attributed conversions |
| 2.4 | Analytics reads real rows; fixtures become seed data, not the source | Every number on `/analytics` traces to a row; zero hardcoded metrics |

**Phase gate:** the sentence "this campaign generated N quote requests" is
computed, not written.

---

## Phase 3 — Learning loop

*Makes the product compound. This is the actual differentiator.*

| # | Step | Acceptance |
|---|------|-----------|
| 3.1 | Join published-post performance onto content item, format, channel, weekday, and hour | A query answers "which format converts best for this brand" |
| 3.2 | `performance` variant of `SuggestionSource`, citing real results in `reasons[]` | A suggestion says "your before/after posts convert 3× your offer posts" and the number is real |
| 3.3 | Best-time scheduling drawn from that brand's own history, not a global default | Suggested times differ per brand and cite why |
| 3.4 | "What we learned about your business this month" — its own artifact | Readable by a non-marketer, every claim traced to data |

**Phase gate:** month two's suggestions are visibly better than month one's,
and the product can say why.

---

## Phase 4 — Remediation

*Turns preflight from critic into fixer — the biggest usability win left.*

| # | Step | Acceptance |
|---|------|-----------|
| 4.1 | Real media upload to object storage, EXIF stripped | Upload a photo, it appears in the library and publishes |
| 4.2 | Per-destination renditions: crop 1:1 / 4:5 / 9:16, trim to platform limits | One upload serves Instagram, Reels, and Pinterest without manual cropping |
| 4.3 | **"Fix it for me"** on every remediable preflight warning | The 118s-video-on-Reels warning offers a trim and applies it |
| 4.4 | Alt-text suggestions on upload, owner-editable | Missing-alt warnings drop toward zero without nagging |

**Phase gate:** a wrong-ratio warning can be resolved without leaving the app.

---

## Not in this plan, deliberately

- More connectors. Eighteen modeled, two real; depth beats breadth.
- More UI refinement. Measured and sufficient; the next UI work is 4.3.
- Paid-ad management, CRM, social listening. Separate products.

## Order of work, one line

**Persist → schedule → measure → learn → remediate.**

---

## Progress

### Phase 1.1 — Prisma + migration + seed ✅

Postgres 16 running locally; three migrations applied; the full demo workspace
seeded (4 brands, 5 campaigns, 23 content items, 38 variations, 16
destinations, 16 published posts, 1 failed attempt).

**Two schema drifts surfaced the moment the database was first used**, both
invisible until then:

- The `Channel` enum was missing nine values — every channel added after the
  schema was written (X, Threads, Bluesky, Mastodon, Pinterest, Reddit,
  Nextdoor, Snapchat, WhatsApp).
- `ConnectionStatus` had `DISCONNECTED` where the domain says `not_connected`.

Both are now fixed, and `npm run test:unit` carries a **drift guard** that
parses `schema.prisma` against the domain unions in `types.ts` and fails on
any mismatch across Channel, ConnectionStatus, VariationStatus, and
CampaignStatus. Cheap to assert, expensive to discover at runtime.

`PublishDestination` was also missing entirely — it was designed after the
schema — and is now a first-class model with variations pointing at it.

**Local database setup**

```bash
# Postgres on port 5433, socket in /tmp
npm run db:migrate     # apply migrations
npm run db:seed        # load the demo workspace
```

### Phase 1.2 — Read path ✅

Every screen now renders database rows. Three new pieces:

- **`src/lib/db.ts`** — Prisma client cached on `globalThis` so hot reload
  doesn't open a new connection pool per edit, plus `dbAvailable()`.
- **`src/lib/queries.ts`** — `loadWorkspace()`, a translation layer rather than
  a rewrite. The domain types in `types.ts` were already right; the job was to
  satisfy them from Postgres. Ten flat queries in a `Promise.all` beat one deep
  `include` tree that would return a cartesian product the UI has to unpick.
- **`src/app/api/workspace/route.ts`** — reports `source: 'database' |
  'fixtures'` and **degrades to fixtures on any failure**, so the clone-and-run
  promise in the README still holds without Postgres.

The store hydrates in one dispatch after first paint, so the app is never
blank and the fixtures act as an instant skeleton. A pill in the topbar says
which one you're looking at, because a prototype that quietly stops persisting
is worse than one that never claimed to.

**Where the friction actually was:** dates and enums, both invisible until
runtime. Prisma returns `Date`; the UI compares `'YYYY-MM-DD'` strings so the
calendar renders identically in every timezone. And `.toLowerCase()` on a
database enum is one typo away from a value no `switch` handles, which
TypeScript cannot catch through the cast. Both are now asserted.

**Verified against the acceptance test.** Changing a row directly in
Postgres — `UPDATE "Campaign" SET name = …` — and reloading showed the new
name on Campaigns; the same for a destination on Connections. That is the
check that can't be faked by a stale fixture.

`npm run test:unit` gained a **read-path round trip**: the fixtures seeded the
database, so loading it back must reproduce them, field by field. It skips
with a note when `DATABASE_URL` is unset rather than failing a fresh clone.
`npm run test:ui` gained a check that the source badge matches what
`/api/workspace` actually reports — a topbar that says "Database" over fixture
data would be worse than no badge at all.

One honest caveat: the fixtures are still imported, deliberately, as the
first-paint fallback. They are no longer the *source* — they are the
seed data and the offline default.

### Phase 1.3 — Write path ✅

**The reducer stays.** That was the design decision worth getting right.
Replacing every mutation with an awaited server action would have made the app
feel worse — dragging a card is instant *because* nothing blocks on the
network. So the reducer remains the optimistic local model and a sidecar
mirrors the same actions into Postgres:

- **`src/lib/mutations.ts`** — thirteen durable actions → Prisma writes. The
  durable set is named in one place rather than scattered through `if`
  statements, because "does this belong in the database" is a judgement worth
  reviewing. `setBrand` is a view filter; the publish-job actions belong to the
  worker in 1.4.
- **`src/app/api/mutate/route.ts`** — one endpoint. Thirteen routes would be
  thirteen files doing the same three things.
- **`src/lib/persist.ts`** — the client queue.

**Mirroring has to be exact.** Where the reducer derives something, the server
derives it identically or the two silently diverge:

- Reschedule moves the day and *keeps the time of day*, so the server re-reads
  the row to learn what that time was. A post that jumps to noon on drop is a
  bug you find a week later.
- Approving is two rows: the variation's status and the pending `Approval`.
  Miss the second and the approvals queue keeps showing finished work.
- Toggling a destination is an intent to flip, not a target value — so it is a
  read-then-write, and applying it twice is an involution.

**Two things that are easy to get wrong and were:**

*Order.* Dragging a card twice in a second issues two writes for the same row.
Fired in parallel they can land in either order and the loser wins — the card
snaps back to where it was two drags ago. Writes go through a single promise
chain instead.

*Identity.* A duplicated variation and a freshly discovered destination invent
ids. Minting them separately on client and server gives you an optimistic card
with no row behind it, so they are minted once in the dispatch wrapper and
handed to both.

**Safety.** `/api/mutate` is a public endpoint. Patchable fields are a
whitelist — the composer may set `body`, not `status` or `publishedAt` — and
an action outside the durable set returns 400 rather than being helpfully
interpreted. Both are asserted in the suite.

**Failures are visible.** A write that fails silently is the worst outcome
available here: the screen shows the change, the user believes it, and it is
gone on reload. Failed writes raise a banner under the topbar, and the badge
reads "Saving…" while writes are in flight.

**Verified against the acceptance test, literally.** The suite drags a real
card with real HTML5 drag events — `mouse.down/move/up` does not trigger
`dragstart` in Chromium, so an earlier version of this check was passing
without exercising the handlers at all — reloads the page, and asserts the card
is still on the new day with its time of day intact.

One assertion had to change with this step: the read-path test compared
collection counts against the fixtures, which was right for a read-only
database and wrong the moment the app could write. It now asserts that every
seeded row is still present, which is both stronger and true of a database
that grows.

### Phase 1.4 — Queue and worker ✅

`npm run worker` is now the process that makes the calendar mean something.
Without it "scheduled" is a label on a card. With it, a post goes out at the
time the owner picked whether or not anyone has the app open.

**Postgres owns the schedule; Redis only executes it.** A poller scans for due
rows every 30 seconds and enqueues them, rather than enqueueing a delayed job
at approval time. That division is the important decision:

- If the queue owned the schedule, flushing Redis would silently drop every
  future post while the calendar still showed them — the product lying to you.
- Rescheduling in the UI would mean finding and rewriting a Redis job, or
  forgetting to and having the post fire at the old time. Polling means the
  calendar is simply the truth: move a card, the next scan sees the new time.

The cost is granularity — a post fires within 30 seconds of its minute. That
is the right trade for scheduled marketing and the wrong one for anything
time-critical.

**Claiming is a compare-and-swap**, `updateMany` with the expected state in the
`WHERE`. Whichever worker gets count 1 owns the job; the other sees 0 and
stops. A read-then-write would double-post under concurrency, which is the one
bug the whole file exists to avoid. The claim lives in its own `claimedAt`
column rather than a `PUBLISHING` status: the owner's vocabulary is
draft/approved/scheduled/published, and a claim a crashed worker never released
has to be reclaimable after a timeout — which a status enum can't express.

**Preflight runs again at fire time.** An approval is a statement about the
post at the moment it was approved. Between then and firing, a connection can
expire, media can be deleted, a campaign can end. Publishing on a stale
approval is how a product posts something the owner wouldn't approve today.

**Retry policy distinguishes what a retry can fix.** A rate limit clears on its
own; a revoked token never does. Retryable failures go back to `SCHEDULED` with
exponential backoff over four attempts; terminal ones stop and surface, because
burning three more attempts only delays the owner finding out.

**Idempotency is per (variation, scheduled slot).** Retries of a slot reuse the
key, so a crashed worker can't turn one post into two — and the BullMQ job id
*is* that key, so a scan racing a queued job adds nothing. Moving a post to a
new time deliberately mints a new key: that is a new intent to publish.

**What the acceptance test surfaced.** Running it end to end immediately caught
a real inconsistency: connecting saved an OAuth grant but never updated the
`ConnectedAccount` row, so the workspace said "not connected" while the
publisher held a live token. Preflight blocked the publish — correctly — and
that was the only reason anyone found out. `src/lib/oauth/reconcile.ts` now
runs on every connect and disconnect path, so the two halves of "connected"
can't disagree.

`npm run test:worker` schedules a post seconds out, spawns the worker as a
separate process, and waits for it to publish against a mock instance that
speaks real Mastodon over real HTTP — bearer auth, `Idempotency-Key`, the
status shape the publisher parses. It asserts the post went out, exactly one
status reached the instance, the attempt and audit rows exist, and replaying
the job posts nothing new. It skips cleanly when the mock isn't running.

**Local setup**

```bash
redis-server --port 6380 --daemonize yes   # or set REDIS_URL
npm run worker                             # in its own terminal
```
