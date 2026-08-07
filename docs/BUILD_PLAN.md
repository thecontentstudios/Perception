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

### Phase 1.5 — Failure surfaces ✅

The worker was already writing `PublicationAttempt`, setting `FAILED`, and
leaving an audit row. What 1.5 added is the half that matters to the person
using it: **the failure reaching Home with a fix that actually fixes.**

Testing it end to end found two real bugs on Home:

- **The fix button was hardcoded to "Reconnect LinkedIn"** on every failure,
  whatever the channel. A Mastodon failure sent the owner to reconnect
  something unrelated. It now names the channel that actually failed.
- **"Retry now" was a simulation.** The reducer faked a publish and marked the
  post published without anything leaving the building.

Retry is now `POST /api/retry`: it moves the post back to `scheduled`, releases
any stale claim, and puts it at the front of the queue. The worker does the
rest, so the retry gets the same preflight, the same idempotency, and the same
failure recording as the original attempt — a retry down a separate path would
be a second, less-tested publisher. **The slot key is reused deliberately:** if
the first attempt failed *after* the platform accepted the post, a fresh key
would publish it twice.

The offered fix also matches the failure. An expired token needs reconnecting
and a retry will just fail again, so that case leads with Reconnect and offers
"Retry anyway" second. Everything else leads with Retry.

`npm run test:worker` now revokes a live token mid-flight and asserts the whole
chain: the publish fails, the failure is classified terminal rather than
retryable, the post is marked failed, **the claim is released**, the attempt
records `auth_expired` with a readable message, the audit row exists, the
failure surfaces *through the read path* with its code so Home can pick the
right fix — and then, after restoring the token, that the retry publishes and
both attempts are recorded in order.

---

## Phase 1 complete

Close the laptop, reopen it an hour later, and the scheduled post went out.
That was the phase gate, and it holds. Phase 2 is next: making the reporting
true.

### Phase 2.1 — Tracked links ✅

`GET /r/<code>` records the click, sets a first-party attribution cookie, and
302s to the campaign's page with UTMs appended.

**One link per variation, not per campaign.** A campaign-wide link answers "did
the campaign work". Only a per-post link answers "*which post* worked", which
is the question the learning loop in Phase 3 is built on and the reason to
mint links at all.

**Redirect first, record second.** A real person is waiting on this route, so
a slow or failing database must never leave them looking at a blank tab. The
click write is wrapped and swallowed: a click we failed to record is a number
we lose, and a broken link is worse by a wide margin.

**Clicks and visitors are counted separately.** Reporting one as the other is
how a campaign comes out looking twice as effective as it was. A repeat click
from the same browser increments clicks and not visitors, and the suite asserts
exactly that.

Two smaller calls worth naming. Existing UTMs on the target win — if someone
deliberately wrote `?utm_source=newsletter` into their own link, overwriting it
is us second-guessing them. And an unknown code redirects home rather than
404ing, because it is far more likely a typo or an old link than an attack.

The cookie is first-party and holds an opaque id we generated. No
fingerprinting, no third-party pixel, nothing that follows anyone off the
domain — the only question being asked is whether the click that brought you
here came from one of our posts.

Ten checks cover it: minting is idempotent, the redirect is a 302 to the right
page, UTMs name the post, the attribution cookie is set, clicks land, repeat
visitors aren't double-counted, and an unknown code recovers.

### Phase 2.2 — Conversion ingestion ✅

`POST /api/events` accepts the six conversion kinds, attributes them, and
writes a `Conversion` row. The sentence this product exists to say — "this
campaign generated N quote requests" — is now counted rather than written.

**The cookie is not the primary attribution path, and that turned out to be
the whole design.** `/r/<code>` sets a first-party cookie on *our* domain. The
conversion happens on the *customer's* domain. A cookie set on ours is not
sent with a cross-site request from theirs unless it is `SameSite=None;
Secure` — exactly the third-party-cookie pattern browsers are removing and
Safari already blocks. Building on it would work in Chrome today and quietly
report zeros for a large share of real visitors.

So the redirect carries attribution **in the URL** (`pcp_click`, plus
`utm_content` naming the variation). The snippet reads it off the landing page,
keeps it in the customer's *own* first-party storage, and returns it with the
conversion. Nothing cross-site is needed and nothing breaks when third-party
cookies finally go. The cookie stays as a same-site fallback, free to keep.

**Attribution resolves best-evidence-first, and says which one won.** A click
id (one visitor, one post, one moment) beats `utm_content` (survives a cleared
cookie, but a shared link credits the original post) beats `utm_campaign`
(names the campaign, not the post — enough for "did this work", not enough for
Phase 3 to learn from). The `basis` is stored, so reporting can be honest about
its own confidence.

**Unattributed conversions are kept.** `campaignId` became nullable for this:
an untraceable quote request is still a real quote request, and dropping it
makes the totals quietly wrong — "8 leads" when the owner counted 12. The
endpoint reports attributed and unattributed separately, always.

**What authorizes the write.** The endpoint answers any origin, because a
customer's form can live on any subdomain and origin-locking breaks them while
stopping no one. The write is authorized by the click id instead: unguessable,
single-visitor, expiring. What an unauthenticated caller can do is add an
*unattributed* conversion — which inflates a total that is displayed
separately, so an inflated one is visible rather than believed.

A caller-supplied `eventId` makes a double-submitted form count once, enforced
by a unique index rather than a best-effort check.

Eleven checks walk the real path: click the link, read what the redirect handed
the landing page, convert with it from a different origin, and confirm the
campaign total moved.

### Phase 2.3 — The drop-in snippet ✅

`<script src=".../p.js" async></script>`. Served from a route rather than a
static file so the endpoint is baked in from `APP_URL` — a snippet with a
hardcoded host is a support ticket waiting for the first self-hosted install.

**Three deliberate limits**, because a tracking script that oversteps is worse
than no tracking script:

- **It does not auto-track every form.** Search boxes, logins, and newsletter
  widgets are forms too. Tracking is opt-in with `data-perception="..."`.
- **No personal data unless asked.** An email is sent only from a field marked
  `data-perception-email`.
- **Nothing stored on our domain.** Attribution lives in the visitor's own
  localStorage, first-party to the customer's site.

**`sendBeacon` posts `text/plain`, not `application/json`, and that matters.**
A JSON content type makes it a preflighted cross-origin request, and
`sendBeacon` queues *before* it knows whether the preflight passed — it returns
`true` either way. A failed preflight would silently drop the conversion with
no fallback. `text/plain` is a simple request; the server parses the body
regardless of the label.

Testing this against a page on our own domain would test nothing, so
`scripts/mock-site.js` serves a real customer page from a different origin with
one script tag and one marked form — the install instructions, executed.

**Two test bugs this shook out**, both caused by earlier phases making the
suite mutate real state:

- Section 6's drag persists now, so it has to put the card back. Without that,
  each run walked a card further from its seeded date until a later section
  could no longer find it — which is what actually happened.
- The worker test resets the mock instance first. Two runs inside the same
  minute share an idempotency key, so the second correctly gets the first
  run's post back — and the test read that as a publish that never happened.

The suite is now verified re-runnable: three consecutive `npm test` runs pass
with the seeded variation count unchanged.

### Phase 2.4 — Analytics reads real rows ✅

`computePerformance()` builds `CampaignPerformance` from `LinkClick` and
`Conversion`. The sentence this phase existed for — "this campaign generated N
quote requests" — is now a `COUNT`.

**The hard part was what cannot be computed.** Clicks, leads, conversions and
revenue come from rows we own. Impressions, engagements and ad spend do not:
they live behind platform metrics APIs and ad accounts this product does not
read yet.

The tempting move is to leave those at `0`. That is a lie with a number on it.
An owner reading "0 impressions" concludes their post was not seen, and
"Cost per lead: $0" reads as *these leads were free* — both much stronger
claims than "we don't know". So the unmeasured metrics became `number | null`,
and the compiler then enumerated every place that had been quietly treating
absence as zero: nine call sites across Analytics and the HUD, including two
sums where null had to propagate rather than collapse.

The screen now renders them as "not measured", says which metrics are measured
and which need a connection, and reports how many results it could trace to a
specific post out of the total.

**The acceptance test reconciles rather than inspects.** It reads the computed
totals, reads the underlying click and conversion rows independently, and fails
if they disagree — which is a stronger claim than "the numbers look plausible".
It also asserts every channel row reports unmeasured metrics as `null` and
never as a number, and that the words "not measured" actually reach the screen.

---

## Phase 2 complete

The phase gate was: *the sentence "this campaign generated N quote requests" is
computed, not written.* It is — and the numbers it can't compute say so
instead of guessing. Phase 3 next: the learning loop.

---

## Phase 3 — Learning loop ✅ (3.1–3.4)

`src/lib/learning.ts` joins every published post to the results it caused and
groups by the things an owner can change: format, channel, weekday, time of
day. `/learned` is the artifact. `bestTimeFor()` answers scheduling from a
brand's own history.

**The discipline is refusing to answer.** Two posts is not a pattern, and a
finding drawn from three clicks is noise wearing a percentage sign. Stating it
confidently teaches people to distrust everything else the product says. So
there are floors — 3 posts and 25 clicks per bucket, a 1.25× minimum
difference — and anything under them is withheld rather than hedged. A brand
with no history gets a general default *that says it is a default*.

**How this is tested, and why it's the strongest check available.** The seed
plants exactly two patterns and nothing else: short videos convert ~3× plain
posts, and each business has its own peak hour. The tests assert the loop
*rediscovers* them from the rows. A broken query can still return a
well-formed answer; it cannot invent a 3× lift that is actually in the data.

**What the tests caught:**

- **The demo had no history to learn from.** The fixtures' 16 published posts
  are a snapshot of one campaign mid-flight — not enough for any bucket to
  clear the floor. The loop correctly said nothing, which read as a bug and
  wasn't. The seed now includes twelve weeks of back catalogue, which is what
  a real account would have.
- **A stride bug flattened the history.** `HOURS[(n * 3) % 6]` only ever yields
  indices 0 and 3, so two of six hours were used and every brand's "best time"
  came out identical. Stride 5 is coprime with 6 and walks all six.
- **Best-time was over-sliced.** Bucketing one brand's history into 24 hourly
  buckets guaranteed every one was too small — only the brand with double the
  history got an answer at all. It now decides on three parts of the day and
  picks a representative hour inside the winner, which is both statistically
  sounder and the thing the module's own comments warned about.

**Suggestions quote findings verbatim.** `performanceSuggestions` is built
*from* `Finding` objects, and the sentence shown to the owner is the one the
query produced — not a re-description. A suggestion that says "3× better" and
is wrong spends the trust that makes every other suggestion worth reading, and
re-describing a number is exactly how it and the claim drift apart. The test
asserts the suggestion's `reasons[]` contains the finding's own sentence.

`/learned` is written for someone who does not work in marketing: it states its
sample before any conclusion, every claim carries the posts and clicks behind
it, and the suite fails on marketing jargon.

---

## Phase 4 — Remediation ✅ (4.1–4.4)

Preflight stops being only a critic. Where a fix is mechanical, the product
does it.

### 4.1 — Real upload

`POST /api/media` takes a multipart file, runs it through sharp, and writes it
to content-addressed storage. `src/lib/storage.ts` is an interface with a local
driver; production swaps in S3 and nothing upstream changes. Keys are
`sha256(bytes)`, so the same photo uploaded twice costs one object and a key
never leaks a filename into a URL.

**EXIF is stripped, and the reason is not tidiness.** A phone photo carries the
GPS coordinates of where it was taken. A landscaper posting a finished job
would publish their customer's home address, in a field nobody looks at, to
every platform at once.

**The subtlety that bites:** EXIF also carries *orientation*. Strip it naively
and every portrait photo comes out sideways, because the pixels were never
rotated — the tag was doing the work. `.rotate()` applies the tag before it is
discarded. The test proves this the only way that means anything: it builds a
400×200 fixture with orientation 6 and asserts the stored file is **200×400**.

### 4.2 — Renditions

One upload, every shape. `cropImage` uses sharp's `attention` strategy rather
than a centre crop — on a photo of a house with sky above it, that is the
difference between a usable square and a square of sky. Video reframing and
trimming go through ffmpeg, re-encoding rather than stream-copying because a
stream copy cuts at the nearest keyframe and can leave a black opening frame.

**A rendition never replaces the original.** Cropping throws away part of the
picture, and the original is often the only copy the owner has.

### 4.3 — "Fix it for me"

Three tests before a warning gets a button:

1. **Is it mechanical?** Trimming to 90 seconds is arithmetic. Writing alt text
   is a description of something we cannot see.
2. **Is it reversible?** Renditions are new objects. Anything that would
   overwrite the owner's work is not a fix.
3. **Can we say exactly what it will do, first?** "Trim to 90s, dropping the
   last 28 seconds" is a decision the owner can make. "Fix it" is not.

`missing-alt`, `not-connected`, `needs-reconnect` and `promo-density` fail one
of those and keep their written instruction instead. A button that does
something surprising is worse than a warning that does nothing.

The end-to-end test is the acceptance criterion, literally: an 8-second video
on a real Reels post, trimmed to 3 through the same route the button calls,
with the duration **read back out of the file**. It then checks the original
row, the original bytes, and the alt text all survived, and that an audit row
says so.

### 4.4 — Alt text

Suggested, never assumed. Nothing in this file can see the picture; what it can
do is turn a filename into a starting sentence the owner edits in two seconds
instead of facing a blank box. It returns a **draft with a confidence** and a
note admitting it never looked at the image, and `IMG_4821.jpg` produces *no
suggestion at all* rather than an invented one — a wrong description is worse
than none, because a screen-reader user has no way to tell it is wrong.

### What the tests caught

**An uploaded file could vanish.** The media library groups strictly by
business, and an upload made while "All businesses" was selected had no brand —
so the row existed, the count grew, and the owner could never find or use it.
There is now an "Not assigned to a business yet" group.

**Test data accumulated again.** Each browser run left one uploaded asset
behind; the same cleanup that clears test conversions now clears unused test
uploads, and only when nothing references them — the same check a real delete
needs.

---

## Phase 5 — The advertising suite: email, text, and what they cost

*Requested as: "an easy to use interface that can do email campaigns, text
campaigns, connect different services and be upfront about costs and ability to
project what you will be spending."*

The interesting part of that sentence is **"be upfront about costs"**, because
it is the part every product in this category gets wrong, and it is not wrong by
accident. Cost is shown on a final review step, in one blended number, because
that is the arrangement that maximises the chance the send happens.

So the whole phase is organised around one inversion.

### 5.1 — Three kinds of cost, never one number (`src/lib/pricing.ts`)

The costs in an advertising suite are three different kinds of thing, and
showing them as one number lies about at least two of them.

| | Certainty | Why |
|---|---|---|
| **Per-message** | Exact | Arithmetic on a list size. Computable to the cent before you press the button. |
| **Fixed** | Exact, and forgotten | $44 to register for SMS, $10/month for a campaign, $1.15/month for a number. On a 400-contact list that is **four times** the message cost. |
| **Auction** | Estimated | Nobody, including the platform, knows what a click costs tomorrow. A single number here is a guess wearing a decimal point. |

Every price carries its `certainty`, ad rates are ranges with `minDailyCents`,
and `range()` deliberately never collapses to a midpoint. A projection that
mixes an exact $4.20 with a guessed $300 and shows "$304.20" is the specific
dishonesty this phase exists to avoid.

### 5.2 — The invisible character that triples a bill (`src/lib/sms.ts`)

SMS is billed per **segment**, not per message, and how many segments a message
becomes depends on which characters are in it. A message of only GSM-7
characters fits 160 per segment. **One character outside that alphabet drops the
whole message to 70.**

The character that does it is usually invisible. Type an apostrophe in Word,
Google Docs, Notes, or on any phone keyboard and you get `’` (U+2019), not `'`.
They render identically in every UI including this one. One is GSM-7 and the
other is not.

A 130-character promotional text plus the 23-character opt-out is **one** segment
in GSM-7 and **three** in UCS-2. On a 1,000-person list that is $11.00 instead
of $33.00, and nothing on screen looks different.

So the module counts segments the way a carrier does, and three details that a
naive `length / 160` gets wrong all cost money:

- **Concatenation overhead** — a multi-part message carries a header in every
  part, so capacity is 153, not 160. 161 characters is two segments of 153.
- **Surrogate pairs** — `😀` is two UTF-16 code units and the carrier bills
  both. Iterating with `for…of` yields code *points* and undercounts by half.
- **Escape pairs at a boundary** — `{`, `€`, `[` cost two septets and cannot be
  split. 153 `€` signs is three segments; `ceil(306/153)` says two.

It then names the culprit by code point, offers the plain equivalent, and
**never touches an emoji** — an emoji is a choice, not a typo, and silently
removing one would be editing someone's message rather than fixing an encoding.

### 5.3 — For ads, the cost is exact and the *outcome* is the estimate

This is the inversion most tools get backwards. A $20/day budget for 14 days
costs $280. Full stop — the auction does not affect it. What the auction affects
is what you get, and that is reported as a range because the honest answer is a
range. `projectAds` puts `certainty: 'exact'` on the spend and a low/high on the
impressions, and the typography sets an estimate lighter than a fact so the two
are distinguishable without reading a legend.

### 5.4 — Who you can actually reach (`src/lib/audience.ts`)

Every tool shows a contact count. Almost none show the *reachable* count, and
the two are rarely close. The seeded workspace is 1,285 contacts: **1,131
emailable, 308 textable.** The gap is phone numbers nobody collected and SMS
consent nobody asked for.

`PENDING` counts as **no**. A pending SMS consent means someone gave you a phone
number and never confirmed they want texts; sending anyway is a TCPA violation
at $500–$1,500 per message. The permissive reading would be a feature that
generates legal liability proportional to list size.

### 5.5 — The interface (`/send`, `/spend`)

**The price is on screen the entire time, and it changes as you type.** No
wizard: one page, three sections, and a cost rail that never leaves. The emoji
that triples the bill gets caught while the sentence is still being written; the
audience that costs $60 gets narrowed while narrowing it is still a small
decision. The send button carries the number — "Send to 308 for $61.93" — so the
whole decision is under the cursor.

`/spend` answers the three questions an owner actually asks, in order: what have
I spent (fact), where is the month going (arithmetic on the fact), what would
this new thing cost (a plan, priced before committing).

### 5.6 — The ledger (`SpendEntry`, `Budget`, `SmsDelivery`)

Spend is recorded, not derived. Counting deliveries and multiplying by a rate
agrees with the ledger until the day a rate changes, at which point last month
silently reprices and the owner's records stop matching what they were shown at
the time.

`hardStop` is the point of `Budget`. A budget that only warns is a budget that
gets exceeded, because the warning arrives while somebody is busy pressing send.
An owner who set a hard cap asked to be stopped, and being stopped is the
feature — acknowledging does not get around it.

### What the tests caught

**The free allowance never depleted.** Ledger rows were skipped when the cost
was zero, which seemed obviously right and was not: allowance consumption is
tracked by summing `units` on those rows. Every send in the month looked like
the first one, so the twentieth campaign was quoted at $0.00 and billed. Zero-cost
*message* rows are now written; zero-cost *fixed* rows still are not, because
they carry no such meaning.

**A workspace-wide budget could be created twice.** The obvious compound unique
over `(org, brandId, channel, month)` silently does not work — Postgres treats
NULLs as distinct, so two caps with both columns null both insert, and the second
is the cap nobody enforces. Prisma will not even accept nullable columns in an
upsert's `where`. Folding the nullability into one non-null `scope` string
(`"all:EMAIL"`) makes the constraint real.

**A channel cap could be handed to the wrong channel.** `orderBy: { channel: 'desc' }`
to prefer a specific cap over the blanket one picks by alphabet, which would give
an email send SMS's cap. Both are now read and the specific one chosen by name.

**"Only free is left of your cap."** `money(0)` renders as "free", which is right
for a price and nonsense for a remaining amount. Split into `money()` for prices
and `amount()` for quantities.

**The character counter said `99/67`.** The denominator is the per-segment
capacity, not a budget, so the line read as an overflow. It now says how many
characters remain before the next segment and what that segment costs across the
audience.

**The demo had eight contacts.** Every argument this phase makes about spending
is invisible at that size, and the hand-written segment counts (412, 168, 1,240)
contradicted the data behind them. The list is now generated to a realistic size
and distribution from a fixed seed, and segment counts are derived from
membership rather than declared — a number the UI states confidently and the data
contradicts is the exact failure this product exists to avoid.

---

## Phase 6 — The pathway: one screen that answers "what should I do?"

*Requested as: "an easy pathway to advertisement with text advertisements and
email campaigns and everything possible with easy to understand pricing and
connections and capabilities."*

Phase 5 made every number correct. It did not make any of them **easy**, and
those are different problems. An owner could learn what an SMS segment costs on
one screen and, on another, that 308 of their contacts may legally be texted —
and nowhere could they learn that texting those 308 costs $3.39 and cannot start
for six days. The facts were all present and the answer was not.

### 6.1 — Routes (`src/lib/routes.ts`)

A **route** is one way to reach a customer, made comparable: cost to run, cost
to set up, hours until the first message can go out, what it reaches, and what
stands in the way. Comparable is the hard part.

### 6.2 — The mistake this file made first

The first version sorted every route into one list by cost per person. It put
**X ads second, above texting your own customers**, by comparing 105,000
*impressions* against 308 *delivered texts* as if those were the same unit.

They are not the same unit, and a single sorted list silently asserted that
they were. This is the identical error to the one Phase 5 was built to
prevent — a tidy number that averages away a distinction the customer needs —
committed by the file that was supposed to be applying the lesson.

So routes are grouped by what the money actually buys, and **sorting happens
within a group, never across one**:

| Group | You buy | Certainty |
|---|---|---|
| **Owned** | A message delivered to someone on your list | Exact |
| **Reach** | Impressions at auction | Estimated |
| **Intent** | Visits at auction | Estimated |

Views convert to people only by dividing by frequency — `IMPRESSIONS_PER_PERSON`
is 2–4, stated by name rather than buried in a calculation — and the result is
always smaller than the view count. For a search ad, `peopleLow`/`peopleHigh`
are **null**: the impressions behind a click are free and uncounted, so nobody
knows how many people saw it, and a dash is the correct answer.

### 6.3 — The second mistake: ranking on the measurable number

With units fixed, the paid list ranked by price — which put **Snapchat at the
top for a landscaping business**, because Snapchat sells the cheapest views.
Cheap views of the wrong people are not cheap; they are wasted.

Fit now comes before price, taken from the surface landscape built in Phase 2
and **shown on the card** so the reordering is something an owner can see and
disagree with rather than a silent thumb on the scale. A landscaper gets
Facebook, Instagram and Nextdoor; a software company gets X and Reddit.

Across a mixed workspace fit is the **mean**, not the maximum. Taking the
maximum — the obvious first implementation — marked every channel "Essential",
because almost any channel is essential to somebody, and a column where every
cell says the same thing carries no information at all.

### 6.4 — Capabilities (`src/lib/capabilities.ts`)

"Everything possible", made concrete. A capability matrix full of green ticks
is the least informative shape it could take: the ticks are the things everyone
assumed anyway. So the ticks are deliberately quiet and the **no** cells carry
the colour, because those are the ones that turn into a campaign somebody has
to rebuild:

- a link in an Instagram caption is not clickable
- video does not play in Gmail or Outlook
- a picture in a text is an MMS at roughly ten times the price
- organic reach on a Facebook Page is low single-digit percent of followers

Each channel also carries the thing that most surprises a first-time user,
which no vendor's own feature list will ever contain.

### 6.5 — The screen (`/advertise`)

Deliberately **not a funnel**. There is no "get started" that hides the price
until step four. The page opens with a recommendation and says why it is the
recommendation; every route shows cost, wait and blockers at once; and each
blocker is a step with a price, a realistic wait, and somewhere to go — not a
sentence that dead-ends.

Paid groups are shortlisted to four with the tail folded behind a count.
Dropping the rest silently would be its own kind of dishonesty.

*Easy does not mean fewer facts. It means the facts arranged so the decision is
obvious.*

### What the tests caught

**Every channel said "Essential fit."** See 6.3 — `Math.max` across four
industries. The test that catches it asserts a mixed workspace still produces
more than one distinct fit value.

**Postgres died between turns and the badge was right.** A screenshot showed
"Demo data" while the reach figures looked database-shaped. The badge was
telling the truth: the database was down and the fixtures happened to agree,
because the seed is generated from the same fixture file. Worth recording
because the instinct was to distrust the indicator rather than check it.

---

## Phase 7 — A charge means a provider took the message

The capability audit found one thing that was not a missing feature but a
**correctness bug in the subsystem built specifically to be honest about
money**: `/api/send` priced an audience, wrote delivery rows, wrote
`SpendEntry` rows, and returned `{ ok: true, queued: 1110 }` — having called no
provider, in a codebase containing no provider. Everything on `/spend` was
therefore money that had not moved.

It failed in the direction that looks fine. A ledger that under-reports is
corrected by the first invoice; one that over-reports against an invoice that
will never arrive has nothing to contradict it.

### 7.1 — `QUEUED` now means what the word means

`QUEUED` was a terminal state the product described as a completed send.
The lifecycle is now `QUEUED → SENT → DELIVERED | BOUNCED | FAILED`, and cost
lives on the delivery row from the moment it is queued — which is what makes
committed money computable without storing a total that could drift.

### 7.2 — One rule, one function

**A message cost is recorded when a provider confirms the message, keyed by
the provider's own reference, and at no other time.** `recordCharge` in
`src/lib/billing.ts` is the only place a message charge enters the ledger, and
a unique index on `(organizationId, providerRef)` makes recording it twice
impossible rather than merely unlikely — a webhook that fires twice, a worker
that crashes between the send and the write, a replayed batch, all charge once.

It uses `createMany({ skipDuplicates: true })` rather than a create in a
try/catch. Both are idempotent; only one of them stops logging a database
error every time the system behaves correctly. Alarms that fire on success are
alarms people learn to ignore.

### 7.3 — The seam, before the provider

`src/lib/senders/` defines the contract and registers **nothing**. An empty
registry is a fact the rest of the system reads and acts on: the send path
checks it, refuses to claim a message was sent, refuses to charge, and says so
in the composer, on `/spend`, and in the worker log. A missing registry would
have left the same code with nothing to check.

`dispatch()` owns the moment a charge becomes real, and was written now so that
Phase 8 is a drop-in behind an interface that is already under test — against a
stub, which is how "exactly one ledger row per confirmed message" can be
verified without a provider.

### 7.4 — Charged, committed, projected

Three tiles, never one. The first is a fact, the second is a promise, the third
is arithmetic on both — and the original bug was that the first two were the
same number. `/spend` also stopped taking month-to-date from a number input,
which had made it a planner wearing a report's clothes.

Budget caps now count committed money as well as charged. Counting only
confirmed spend would let a thousand queued messages sit against a cap they
will certainly blow while the budget reported itself healthy.

### What the tests caught

**Per-message rounding wiped out an entire campaign's cost.** Moving cost onto
individual delivery rows created a problem the one-row-per-send design never
had: a single message usually costs *less than a cent*. Email at 80¢ per
thousand is 0.08¢ each, which rounds to zero — so an 89¢ campaign to 1,110
people committed nothing, charged nothing, and reported itself free. That is
the original bug wearing a different hat. Rounding up turns 89¢ into $11.10;
rounding to nearest loses 9% on SMS.

`allocateCents` distributes the remainder one cent at a time so the parts sum
to the whole exactly, and the test asserts the property a customer would check:
*1,110 messages carry exactly the quoted 89¢ between them.*

**The worker reported its own page size as a fact about the queue.** "200
messages waiting" for a backlog of 2,220, because 200 is the batch limit.

**Two test assertions were wrong, not the code.** A free send produces 1,110
ledger rows totalling zero — the rows are what deplete the allowance, so
asserting `chargedCents > 0` was asserting the wrong thing. And the
committed-versus-cap check had wiped its own committed money before looking
for it.

**`money(0)` says "free" again.** Right for a price, wrong on a tile labelled
"Charged this month". `amount()` already existed for exactly this and had not
been applied here.

---

## Phase 8 — Email that actually arrives

Phase 7 built the seam and registered nothing behind it. This fills it, for the
one channel the product recommends first — because `/advertise` opening with
"Start here: email your list" while email could not send made the whole pathway
a demonstration.

### 8.1 — The adapter (`src/lib/senders/resend.ts`)

Resend first, and not because it is cheapest — it is not; SES is 12× cheaper and
`/spend` says so. It has the smallest surface in the rate card: one POST, bearer
auth, a JSON body. The first thing in this codebase that touches the outside
world should spend its complexity on the parts that are genuinely hard, not on
request signing.

Two decisions carry most of the weight:

**The idempotency key is our delivery id.** A crash after the provider accepted
a message but before we recorded its reference would otherwise send it twice —
the recipient gets two copies and we are charged for both. With the key, the
retry returns the original id and Phase 7's unique index turns the second charge
into `already-recorded`.

**Errors are classified by who has to change something.** A 429 or a 5xx is
retryable because the identical request might work later. A 422 is not, because
the request itself is wrong, and retrying it every thirty seconds forever is how
a queue turns into a bill for nothing.

### 8.2 — Suppression (`src/lib/suppression.ts`)

The preflight has warned about sending reputation since Phase 1. This is the
first thing that protects it.

The cost of re-mailing a hard bounce is not the one message. Mailbox providers
score a sender on how often they mail addresses that bounce or complain, and
that score decides whether *everything else* reaches an inbox — so a small error
degrades every future campaign, weeks after the cause.

**Hard bounces suppress; soft ones do not.** A full mailbox or a bad afternoon
at a mail server is not a dead address, and suppressing on it would quietly
shrink a healthy list every time somebody's server hiccuped. Complaints are
always terminal.

Suppression is checked twice: when the audience is built, so the quote is
honest, and again in the dispatcher, so a bounce that arrives between queueing
and sending still stops the message. The second check is the one that matters.

### 8.3 — Webhooks, verified

`/api/webhooks/resend` is the only way the product learns an address is dead.
It is also the endpoint that mutates the suppression list, which makes an
unsigned caller able to suppress a customer's entire audience — a denial of
service on their marketing that, from inside the product, would look exactly
like a very bad list. Every request is Svix-verified against the raw bytes,
inside a five-minute replay window, before anything is read from it.

Delivery news can only move a row forward. Out-of-order events are normal, and
an "opened" arriving after a "clicked" must not undo the stronger signal.

### 8.4 — Unsubscribing that works

Every message carries a `List-Unsubscribe` header and a visible footer link.
Generating those without building the endpoint would have been worse than
omitting them: a header pointing at a 404 tells Gmail the sender is careless,
and a dead footer link converts someone who wanted to leave into someone who
presses "report spam" — which costs far more.

`/u/<deliveryId>` handles both the human click (GET, confirmation page) and RFC
8058 one-click (POST, no page). The delivery id is the credential, deliberately:
requiring a login to stop receiving mail is the pattern that makes people give
up and complain, and the blast radius of a guessed id is one address
unsubscribing itself.

### 8.5 — The stand-in (`scripts/mock-resend.js`)

Speaks the real protocol — bearer auth, idempotency keys, the `{ id }` response
shape, the error shapes the adapter classifies — and fires Svix-signed webhooks
back. The code under test is the real adapter taking a real HTTP round trip.

### What the tests caught

**A dangling `{{link}}` shipped "Book here: " to a customer's inbox.** The
composer offers the token as a chip, so it is easy to insert and easy to forget
to point anywhere. The send now refuses, and the composer reveals a destination
field the moment the token appears.

**A typo'd merge token reached the recipient.** `fillMergeFields` leaves unknown
tokens in place, which is right in the composer — the writer should see that
`{{naem}}` is not a field — and wrong at send time, where the audience is the
one reading. The render strips them; the composer still shows them. The two
behaviours look inconsistent and are not: the difference is who is reading.

**`.env` claimed a sender existed.** Setting `RESEND_API_KEY` for local testing
made the running deployment report itself able to send, which broke a Phase 7
assertion by making it true. The deployment now genuinely has no sender and says
so; the suite supplies its own in-process. `__installSender(ch, null)` was also
falling back to configuration instead of forcing *none* — so a test written to
describe the unconfigured world silently started describing the configured one.

**A test skipped itself into passing, twice.** Once when the mock was not
running (now a failure, not a skip, when `MOCK_RESEND_URL` is set), and once
when a lookup scoped to `status: 'SENT'` found nothing because every message in
that section had already been bounced.

---

## Phase 9 — Grow the list

The capability audit's second finding: **the product's headline advice is for a
list it cannot help you build.** `/advertise` opens with "start here: email your
list", `routes.ts` says the owned audience "only grows if something else feeds
it", and nothing fed it — `contact.create` appeared once in the whole codebase,
in the seed. The ranking argument is correct, which is exactly what made list
growth the highest-leverage missing feature rather than a nice-to-have.

### 9.1 — One door, one rule (`src/lib/intake.ts`)

Three ways in — a form, a spreadsheet, a website conversion — and one function
they all go through, because three similar code paths is three places for the
rule to be wrong. The rule:

**Nothing becomes `SUBSCRIBED` without a recorded basis.**

Consent is an **event log**, not a flag. The flag on `Contact` is the current
answer; `ConsentRecord` rows are how it got that way, including the exact
sentence the person was shown — copied, not referenced, so editing a form later
cannot rewrite what somebody read.

Deduplication is by normalised address within an organization. The same person
arrives repeatedly, and each arrival should strengthen what we know rather than
create a second row that halves it. Consent only ever moves one way on its own:
an unsubscribe always wins, and a re-uploaded CSV cannot quietly demote someone
who confirmed.

### 9.2 — Reading the file a business actually has (`src/lib/csv.ts`)

"CSV" is a family of nearly-compatible formats, and every difference breaks a
naive `split(',')` *silently*: a BOM makes the first header match nothing,
`"Smith, John"` becomes two cells, CRLF leaves `\r` on every last value, a
trailing newline becomes a row of empty contacts. None of those error — they
produce a plausible import with wrong data, which the owner discovers when a
customer receives mail addressed to `"Smith`.

### 9.3 — The import refuses

Two steps, always: a dry run that reports exactly what would happen, then a
separate commit. An import is close to impossible to undo, so the shape of the
interaction matches the shape of the risk.

And it will not mark anyone subscribed unless the caller says how they agreed,
in words. An owner who bought a list can still type something and mail it — the
difference is that the sentence is stored beside every address it created, so
when a mailbox provider asks, there is an answer that is not "it was in a CSV".

A phone number in a spreadsheet is **never** SMS consent, whatever is attested
about email. Texting on that basis is $500–$1,500 a message.

### 9.4 — Double opt-in, on by default (`src/lib/confirm.ts`)

`PENDING` was a state nothing could leave: a form could collect a hundred
addresses and the reachable count would never move, because the only thing that
promotes a pending contact is a confirmation the product never sent. It sends
one now, through the same `Sender` the campaigns use — so with no provider
configured it says so rather than leaving the owner believing sign-ups are on
their way.

A single-opt-in list is bigger and delivers worse: it fills with typos and with
addresses whose owners never asked, both of which bounce, and bounces are what
mailbox providers score a sender on. The list that looks smaller reaches more
people, and that argument loses to a bigger dashboard number unless the product
takes a position.

### 9.5 — Conversions become contacts

`/api/events` used to match an existing contact by email and stop, with a
comment explaining that a form submission is not consent to be added to a
marketing list. True — and not a reason to throw the address away. Every paid
campaign was spending money to produce a stranger who stayed a stranger.

They are created as `PENDING`, which counts as *no*. Nobody is mailed on that
basis. What it buys is a person the owner can send one confirmation to, and a
closed loop from the ad that caused the click to the customer it produced.

### What the tests caught

**The hosted signup form rendered inside the admin shell.** `/f/<slug>` is
shown to somebody else's customers, and it inherited the root layout — so it
carried the navigation rail and a dropdown naming every business in the
workspace. Fixed by moving the application into an `(app)` route group with its
own layout, leaving the root layout as a bare document. No URL changed. The
test now asserts that no brand name and no nav markup appears on a public page.

**A superseded confirmation link.** The test signed up twice — deliberately, to
check the form is not an account-existence oracle — then read the token out of
the *first* email, which minting the second had invalidated. The behaviour was
right and the test was wrong; it now reads the latest email and separately
asserts the earlier link is dead.

**The worker suite was passing by skipping**, again: mock Mastodon had died
between runs, so it reported success having run nothing. Counted per suite
rather than trusting the aggregate.

---

## Phase 10 — Text messages that actually arrive

The other half of the capability audit's ledger finding. Phase 7 stopped the
product charging for messages nobody sent; Phase 8 made email real. SMS was
left priced to the cent, projected, quiet-hours checked, segment counted — and
never sent. `/api/send` handed an SMS batch to a registry that had no SMS
sender in it, and the honest refusal that produced was the best outcome
available, because the alternative was worse: the product records SMS consent
and enforces it at send time, and **nothing could change it.**

That is the part that made this the highest-risk gap rather than merely a
missing adapter. A customer who replied STOP stayed marked subscribed for ever.
The carrier stops delivering after STOP whether or not our database noticed, so
the failure is quiet in the worst way — messages keep being sent, keep being
billed, keep not arriving, and the reachable count on screen says everything is
fine.

### 10.1 — The adapter (`src/lib/senders/twilio.ts`)

The second implementation of the `Sender` contract, which is the first time the
interface has been asked to hold two genuinely different providers. It held.
Form-encoded rather than JSON, Basic auth rather than a bearer token, numeric
error codes rather than strings — all of it fits behind `send(message)` without
the interface learning what Twilio is.

Two things are carried through that the interface did not have before:

**`billedUnits`.** Twilio replies with `num_segments` — the number the carrier
will actually charge for. `sms.ts` has computed that number since Phase 5 with
nothing in the world to contradict it. The adapter reports the provider's count
*beside* our own rather than in place of it, because the point is to compare
them.

**Idempotency.** `i-twilio-idempotency-token: deliveryId`, the same discipline
as Resend's key. A crash between the provider accepting a message and us
recording its reference must not put a second copy on somebody's phone, where a
duplicate is more intrusive than it is in a mailbox.

### 10.2 — Replies change consent (`/api/webhooks/twilio/inbound`)

STOP, START and HELP are not features. US carriers mandate them and a sender
who ignores them loses their registration.

- **STOP** → `UNSUBSCRIBED`, suppressed, and a `ConsentRecord` quoting what the
  person actually typed.
- **START** → `PENDING`, *not* `SUBSCRIBED`. Somebody texting START is asking
  for messages again and honouring it is right, but the original consent was
  withdrawn and one word does not restore the evidence for it.
- **HELP** → an answer naming the business, because carriers require one and
  Twilio's default is generic.
- **Everything else** → the inbox. A "yes please, Tuesday works" is the reason
  the campaign was sent, and a product that swallows replies because they were
  not keywords has thrown away the result.

Matching is loose on punctuation and case and strict on everything else. `STOP`
and `stop.` are one intent; `stop by the shop tomorrow` is not, and treating it
as one unsubscribes a customer who was trying to book.

Replies are matched by number across **every** organization the number appears
in. One person can be a customer of two businesses in the same workspace, and a
STOP means stop — resolving it to a single tenant leaves the other one texting
them.

The signature check matters more here than on any other endpoint in the
product, because this endpoint changes consent. A forged STOP unsubscribes a
customer; a forged START re-subscribes somebody who opted out, which is the
direction that produces a complaint. Twilio signs HMAC-SHA1 over the request URL
followed by every parameter as `key + value` in lexicographic order by key.

### 10.3 — Delivery receipts, and the fact that a text has no bounce

Email tells you a mailbox is dead. A text comes back `failed` or `undelivered`
with a numeric code, and only some of those codes mean the number is finished.
30003 is a handset that is switched off. 30005 is a number that does not exist.
Treating them alike either suppresses people whose phone was in a drawer or
keeps paying to text disconnected lines for ever.

So only the permanent codes suppress, and 21610 — the carrier reporting an
opt-out through a route we never saw — additionally flips consent, because that
one is a consent fact and not just a delivery one.

### 10.4 — Quiet hours at fire time, per recipient (`src/lib/timezone.ts`)

`sms.ts` has modelled the TCPA's 8am–9pm window since Phase 5 and has been fed a
hardcoded `-7` the whole time — every quiet-hours check in the product was
answering the question for somebody in California. And the composer checks the
hour the *owner* picked, while a scheduled send lands at a different one.

Both are fixed by checking per recipient, in the dispatcher, at the moment the
message would go out. The zone is a guess: an area code says where a number was
*issued*, and portability means a third of Americans carry a code from
somewhere they no longer live. So the guess carries a confidence, and an
unknown number is held to Hawaii — the last place in the country where it is
still early. That delays some messages by a few hours and cannot produce a
violation. The reverse default, Eastern, sends at 6am Pacific.

The asymmetry is deliberate throughout the file. Wrong in the permissive
direction costs $500–$1,500 per message; wrong in the restrictive direction
costs a wait.

### 10.5 — A stand-in Twilio (`scripts/mock-twilio.js`)

Real Twilio needs an account, a registered 10DLC campaign, a rented number, and
sends every test message to a real handset. The stand-in speaks the same wire
protocol — Basic auth, form-encoded bodies, the `{ sid, num_segments }` shape
the adapter parses, the error codes it classifies — so what is under test is the
real adapter taking a real HTTP round trip.

It counts segments **itself**, from the GSM-7 rules, deliberately not importing
`sms.ts`. A stand-in that imported the implementation it exists to check would
agree with it by construction and prove nothing.

### What the tests caught

**SMS was priced with merge fields and an opt-out line, and sent without
either.** The dispatcher passed `row.batch.body` to the sender raw — so a
recipient would have received a message containing a literal `{{name}}` and no
way to stop, while the ledger charged for the rendered length. It surfaced
because the segment-count reconciliation disagreed with the carrier: we said 3,
Twilio billed 2. Fixed by rendering through `renderSms` and pricing the exact
string that goes out. The check that found it existed only because the adapter
reports the provider's count alongside our own instead of adopting it.

**A test that passed because another test had already succeeded.** Phase 10
leaves the SMS `ConnectedAccount` connected, which made Phase 7's "an
unregistered SMS channel is refused" pass without exercising anything. The
suite now captures the original status and restores it.

**A ledger assertion that counted other suites' work.** "1310 ledger rows for
1110 sends" — correct, and not a bug: a worker left running by another suite
dispatches what is queued and writes charges of its own. An assertion that
counts those is an assertion about the order the suites ran in. Scoped to the
stub's own provider references.

**The seed's SMS account existed in a non-connected state**, so the setup's
`findFirst` for a connected one found nothing and created a duplicate. Changed
to update-or-create.

---

## Phase 11 — The reporting knows what it knows

The plan said "`/analytics` stops reading seeded rows." The audit before
building found something better and worse at once: it never read seeded rows —
`Metric` had zero writes anywhere, including the seed — and the computed
numbers it does show were wrapped in a blanket claim that was wrong in both
directions.

Since Phase 2 the report has carried two global arrays: `MEASURED = [clicks,
leads, conversions, revenue]`, `UNMEASURED = [impressions, engagements,
spend]`. Applied to every channel alike, that **under-claimed** — it said "Needs
a platform metrics connection" about email, where Phases 7, 8 and 10 left us
holding the exact delivered count, the exact open count, and the cost to the
cent — and it **flattened**: one "not measured" label covering four situations
an owner would act on differently.

### 11.1 — Four blanks (`src/lib/measurability.ts`)

- **`measured`** — we hold rows for it.
- **`not_connected`** — the platform reports it; nothing is connected.
  *Actionable by the owner.*
- **`not_ingested`** — the platform reports it; we have not built the reader.
  *Actionable by us, and saying so keeps the pressure where it belongs.*
- **`unavailable`** — the platform does not publish this number to anybody.
  *Actionable by nobody, ever.*

The last one is the reason the file exists. Bluesky's `getPosts` returns
likes, reposts and replies and **no view count of any kind** — reach is absent
from the AT Protocol. Mastodon's status object is the same, as a stated design
position of the software. An owner comparing channels on impressions has to
know that blank is permanent, because the alternative readings are both worse:
they wait for a number that is never coming, or they read the blank as zero
and conclude nobody saw the post.

The screen renders the four differently — "nothing sent" / "connect to see" /
"not measured" / *"not reported"* — with the sentence on hover. `unavailable`
is checked before `not_connected`, so the product never suggests connecting an
account that cannot supply the number: that is an afternoon of an owner's time
spent proving our label wrong.

### 11.2 — Store what you can only observe once (`src/lib/metrics.ts`)

Two readers with opposite retention rules, and the rule is the design:

**Platform numbers are snapshotted.** Bluesky says a post has 14 likes *now*;
ask tomorrow and it says 19, and nothing anywhere remembers Tuesday. Each
reading becomes a `Metric` row — nullable counts, a `source` column so two
readers can disagree attributably, `postMissing` so a deleted post stops being
asked about.

**Our numbers are computed at read time, never cached.** Email delivered,
opened, cost — exactly derivable from `EmailDelivery` and `SpendEntry` for any
window. A snapshot of those would only add a way for the report to disagree
with the rows.

`Metric`'s counts were `Int @default(0)`; they are now nullable, because a
Bluesky reading will carry a null impression count for ever and a 0 there
tells an owner nobody saw their post.

### 11.3 — Two click counts, both shown

The provider's click count and our tracked-link count will not match. Mail
scanners on business addresses open every link before delivering, so the
provider runs high; our links are closer to humans but blind to any link we
did not mint. Averaging produces nobody's measurement; picking the bigger one
flatters the report. `/analytics` shows both with the gap named, once the
volume is enough for the ratio to mean something.

### What the tests caught

**"0 delivered, 117 clicks."** The first version counted deliveries with a
plain `.length` — so a campaign that earned email clicks through a channel it
never sent on reported `impressions: 0` beside a five-figure click count: two
statements that cannot both be true. Zero rows is not a measurement of
nothing; it renders as "nothing sent" now.

**A 404 wrote a permanent tombstone.** The metrics reader treated any 404 as
"post deleted" and stopped asking for ever. The first live run proved why that
is wrong: the stand-in server was an older build without the endpoint, every
post was marked gone on the first pass, and the failure surfaced as zero
readings rather than as an error. A 404 is conclusive only for a post we have
read successfully before; otherwise it is an error, and no tombstone is
written — so a fixed endpoint starts working again on its own.

**The dev overlay was part of the test.** Next's compile indicator sits in the
corner of the screen — exactly over the nav's collapse button — and intercepts
clicks while a route compiles, so a browser test failed on a button it could
see and could not press, depending on nothing but how recently the server had
restarted. Same shape twice more: a fixed 2.5-second wait for the upload toast
that passed alone and failed when the media suite had just warmed the server,
and a `$eval` with a two-selector union that grabbed whichever matched first.
All three replaced with waits on the observable outcome.

**The UI suite accreted one test PNG per run** into the seeded workspace, with
the missing-alt-text warning creeping up to match. There is no delete surface
in the product yet — a real gap, deliberately not built mid-phase — so the
suite cleans up its own row directly.

### 11.6 — The clock caught the composer (follow-up)

The first full-suite run after US evening fell over with *"20:00 local — too
late"*: the acceptance suite sends real texts through the real path, and after
8pm Pacific the composer refused them — including one addressed to Hawaii,
where it was 5pm.

Phase 10 made quiet hours per-recipient in the dispatcher and left the
composer's gate on one clock, the org's configured offset, refusing the whole
batch on it. The two disagreed exactly when the sun went down. Now the
composer judges the audience the way the dispatcher will act on it:
`quietHoursForAudience` counts who can legally receive a text at this moment
and who will be held until their own morning, and refuses only when that first
number is zero. The response carries both counts, so the composer can say
"951 of 1,110 can receive it now" instead of lying in either direction.

The suite itself already knew — it picks a contact in a zone where it is
currently daytime — which is why the failure pointed at the product and not
the test. Unit checks pin the design with fixed timestamps: 9pm in San
Francisco does not silence 6pm in Honolulu, a list that is entirely asleep is
refused with its next opening, and an unguessable number stays held to the
most restrictive window.

---

## Phase 12 (first half) — Ads: planned here, bought there

The plan's own words: **take the honest position.** Full API integration with
eleven ad platforms is a year of work, most of it approval queues, and a
"Launch" button wired to none of it would be the Phase 7 ledger lie at a
hundred times the price. What a small business needs is the part the platforms
are bad at: deciding how much to spend on what, being told what that buys *as
a range*, getting a brief they can execute in the platform's own tool, and
having the money land in the same ledger as every other channel.

### 12.1 — The flight (`src/lib/flights.ts`, `AdFlight`)

A flight has **money states, not delivery states**: `planned` → `handed_off`
→ `settled`. What the platform did with the ad is its own reporting; what we
keep is the books.

Planning validates against the platform's posted daily floor — below it, an
auction platform never leaves the learning phase and the budget teaches an
algorithm instead of reaching anyone — and prices the outcome as a range from
the same `AD_RATES` the /spend planner uses. The spend is exact (the owner
sets it); the outcome is the estimate. Never the reverse.

### 12.2 — The brief

The handoff produces a plain-text brief: objective, audience, budget stated
the way the ads manager will ask for it ("$15.00/day for 14 days — set DAILY,
not lifetime, with an end date"), the outcome range labelled a range, and the
destination URL **already carrying its UTM parameters** — minted at planning
time, because a click that arrives unattributed is a conversion the flight
caused and can never be credited with. The deep link goes to the platform's
real ads manager, and the position is stated in words on the screen and in
the API: *we plan the flight and keep the books; you place the buy.*

### 12.3 — Estimated money drains to exact

Spend the platform reports mid-flight is written `certainty: 'estimated'`,
idempotently per (flight, period) — re-importing a week updates the figure
rather than double-counting it. `spendSplit`'s "charged" aggregate now
excludes estimates, because a number read off a dashboard is a belief about
money, not money.

Settling is one transaction: every estimated row flips to exact, and the
difference between the running estimate and the invoice becomes **its own
adjustment row** — so the ledger sums to the invoice without any history
being rewritten or deleted, and the estimate bucket genuinely drains. Spend
entry after settlement is refused: the invoice is the record now.

**Acceptance — met.** A planned $210 Facebook flight produces a brief with
the budget, the attributed destination, and the ads-manager link; imported
spend appears on /spend as an estimate, apart from charged; settling a 5150¢
invoice against a 4700¢ estimate writes a +450¢ adjustment, every row goes
exact, and the rows sum to the invoice.

*(Second half of Phase 12 — publishers in fit order, Facebook and Instagram
behind the `Publisher` contract against a stand-in Graph API — is the next
iteration.)*

