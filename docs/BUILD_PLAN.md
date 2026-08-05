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
