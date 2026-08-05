# What Perception still needs — a capability analysis

Written after surveying the actual codebase, not from memory of it.

## The diagnosis in one line

**Perception has an excellent domain model and almost no runtime.**

| Layer | Size | State |
|---|---|---|
| Domain model, UI, engines (`src/lib`, `src/components`, `src/app`) | ~12,500 lines | Rich and correct |
| Server surface (`src/app/api`) | 619 lines | OAuth + two publishers |
| Database access | **0 files** | `prisma/schema.prisma` is written and unused |
| Scheduler / worker | **does not exist** | Only comments describing one |
| Tracked links / conversion ingestion | **does not exist** | `utmCode` appears 11 times and produces nothing |

Everything a user sees is right. Almost nothing survives a refresh or happens
on its own.

## The three promises, each half-built

The product makes three promises. Every one is convincing in the UI and
incomplete underneath. This is the clearest way to prioritise.

### 1. "One campaign, everywhere your customers are"

Built: the composer, the campaign/content-item/variation split, destination
fan-out, per-destination preflight, two real publishers.

**Missing: scheduled posts never fire.** Quick Post's "Schedule" writes a
variation with `status: 'scheduled'` and the calendar draws it. Nothing
publishes it at 9:30am, because there is no process that wakes up. A campaign
operating system that cannot fire a scheduled post is not yet the product.

### 2. "Never silently fails"

Built: the preflight engine, per-destination blockers with specific reasons,
independent jobs, idempotent retry, the audit log.

**Missing two things.** There is no runtime to fail *in* — the whole failure
model is exercised by a simulated pipeline. And preflight can only complain:
it says "Instagram requires a different image ratio" and then offers the owner
no way to fix it inside the product. A critic that cannot remediate pushes the
work back onto the person we promised to help.

### 3. "Results in your language"

Built: outcome-first analytics, per-channel breakdown, the plain-language
report sentence, the HUD.

**Missing: every number is invented.** No tracked link is ever minted, no
click is recorded, no conversion is ever ingested. "The Fall Cleanup campaign
generated 21 quote requests" is the single most persuasive sentence in the
product and it is currently fiction. This is the largest credibility gap.

---

## What to build, in order

### 1. The runtime spine — persistence + scheduler

One project, not two, and the prerequisite for everything else.

- Wire Prisma to the existing schema; replace the `useReducer` store with
  server actions.
- Redis + BullMQ; enqueue on approval, keyed by the idempotency key that
  already exists on `PublishJob`.
- A worker that **re-runs preflight at fire time** (connections die between
  approval and firing) and calls the existing `Publisher` interface.

Cheaper than it sounds: the publishers, the preflight engine, the job model,
the stage machine, and the idempotency scheme are all already written and
tested. The worker is glue over finished parts.

**Done when:** a post scheduled for 9:30 tomorrow publishes at 9:30 tomorrow
with the laptop closed, and a failure is visible with a fix.

### 2. Tracked links + conversion ingestion

The highest value per line of code in the whole backlog, and the one that
converts the analytics story from fiction to measurement.

- `GET /r/[code]` — record the click, set a first-party attribution cookie,
  302 to the destination with UTMs appended.
- `POST /api/events` — accept `form_submission`, `booking`, `purchase`, `call`
  from the customer's site, attribute via that cookie, write a `Conversion`.

Both models already exist in the schema. This is perhaps 300 lines and it is
what makes the differentiating sentence true.

**Done when:** a real click on a real post produces a row, and a form
submission on the customer's site shows up as a quote request attributed to
the campaign that caused it.

### 3. Media pipeline with **remediation**

Turn preflight from critic into fixer. Upload → object storage → FFmpeg/sharp
renditions per destination: crop 1:1 / 4:5 / 9:16, trim to 90s, strip EXIF.

Preflight already knows every ratio and duration rule per channel. It should
offer **"Fix it for me"** next to each warning instead of only naming the
problem. That single change is the biggest usability win available, because
cropping for four platforms by hand is exactly the chore people buy this to
avoid.

### 4. Real generation

Swap the deterministic assembler in `generate.ts` for a model call conditioned
on the voice profile discovery already extracts (register, emoji habit,
sentence length, signature phrases). The scaffolding — extraction, per-channel
adaptation, provenance, draft-only guarantees — is finished. This is the
payload going into a built pipe.

Also make discovery read a real site: robots.txt check, JSON-LD → OpenGraph →
DOM, sitemap crawl. The `Fact<T>`/`SourceRef` model is already designed for it.

---

## The capability that isn't on any current list

Everything above is *completion*. This one is *strategy*.

**The product has no feedback loop. It never learns.**

Discovery reads the business once. Analytics reports what happened. Nothing
connects the two. The suggestion engine proposes posts from *site facts* —
services, offers, reviews — and never from *what has actually worked for this
business*.

That is the difference between a scheduler and a system worth keeping.
Scheduling is commodity; Buffer and Later do it. "Gets measurably better at
your specific business every month" is not commodity, and Perception is three
small steps from it:

1. Join published-post performance back onto its content item, format,
   channel, day, and time — the metrics model exists.
2. Feed that into `suggestPosts()` as an additional evidence source, so
   suggestions cite performance the way they currently cite the website:
   *"your before/after posts convert 3× your offer posts — here's another
   one."*
3. Surface the learning as its own artifact: **"what we learned about your
   business this month."** Owners will read that even when they ignore charts.

The infrastructure is half-built already: per-channel metrics, suggestion
provenance with `reasons[]`, and the `SuggestionSource` enum that a
`performance` variant slots straight into. It only needs real metrics to join
against — which is capability 2.

**This is also why capability 2 outranks its apparent size.** Tracked links
aren't just about honest reporting; they're the substrate the learning loop
runs on. Without measurement there is nothing to learn from.

---

## What *not* to build

- **More connectors.** Eighteen channels are modeled; two publish for real.
  Depth beats breadth, the docs already commit to that, and every new
  connector is ongoing maintenance against someone else's API.
- **More UI polish.** Measured: every page is at or under one screen when
  collapsed, no route overflows at three widths, motion and focus are handled.
  The next UI work should be *remediation affordances* (capability 3), not
  refinement.
- **Paid-ad management.** Explicitly out of scope and correctly so — the HUD
  tells owners where paid money works without becoming Ads Manager.
- **Full CRM or social listening.** Same reasoning; both are separate
  products wearing a feature's clothing.

## What blocks a real customer, in order

1. Nothing persists → cannot be used for real work at all.
2. Nothing fires on a schedule → the core job is not done.
3. No second user can sign in → roles and approvals are modeled but unusable,
   which blocks agencies specifically, a likely first buyer.
4. Numbers aren't real → the differentiator can't be demonstrated honestly.
5. Media can't be uploaded or fixed → the multi-channel chore remains manual.

## Recommendation

Complete one promise end to end before widening any of them. Concretely:
**runtime spine → tracked links → learning loop.** That sequence makes the
scheduler real, makes the reporting true, and then makes the product
compound — in an order where each step is the prerequisite for the next.
