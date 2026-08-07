# UI flow audit — where the screens stop understanding each other

*August 7. Measured against the code, not impressions: grep of Collapsible
usage, page weights, nav structure, and the campaign joins each flow sets.*

## The one-line diagnosis

**The schema knows what a campaign is; the screens do not.** Every table has
the join — `MessageBatch.variationId`, `AdFlight.campaignId`,
`SpendEntry.campaignId` — and the flows almost never set or show them, so the
product's central object exists everywhere except on screen.

## Finding 1 — The campaign thread breaks at every seam

- **`/campaigns/[id]` shows only posts.** The campaign detail renders content
  items and variations. No message sends, no flights, no spend, no results —
  a campaign page that does not know what the campaign did.
- **Composer sends belong to nobody.** `/api/send` mints
  `variationId: adhoc:<timestamp>` with no campaign, so every email and text
  sent from `/send` is invisible to per-campaign analytics and per-campaign
  cost — the two screens an owner would check to see if the campaign worked.
- **Flights never join.** `AdFlight.campaignId` exists and `/api/flights`
  accepts it; the planner UI never sets it.
- **The nav offers four unconnected ways to act** (Quick Post, Create, Send
  a message, plan a flight on Spend) and no context travels between them.

## Finding 2 — Collapsible coverage stopped at five screens

Used on `/post`, `/hud`, `/media`, `/connections`, `/analytics`. The four
heaviest screens render everything open, all the time:

| Screen | Lines | Sections that should fold |
|---|---|---|
| `/spend` | 657 | month summary · planner · flights · rate card |
| `/discover` | 608 | intel · suggestions · gaps |
| `/send` | 579 | audience · message · preview · cost rail |
| `/create` | 513 | five steps, all expanded |
| `/advertise` | 336 | four route groups |

## Finding 3 — Pricing is honest per screen and incoherent across them

Three surfaces price things three ways — the composer to the cent, the
pathway in ranges, the planner in ranges with flights beside it — each
internally right, none answering the owner's actual question: **"what did
this campaign cost, and what did one result cost me?"** Flights now carry an
exact CPA; email, SMS and the campaign as a whole do not. And the `/send`
hour picker's quiet-hours what-if is computed at UTC offset 0 — a "local
time" that is nobody's.

## The plan

### Phase 18 — The campaign is the spine — **done**
`MessageBatch` carries its campaign; the composer asks "which campaign is
this for?" while it is cheap (ad-hoc stays legal, a foreign id is refused);
the dispatcher stamps every charge with the batch's campaign; analytics
attributes deliveries through the batch when the variation join cannot; the
flight planner takes a campaign. `/api/campaigns/[id]/rollup` reads
everything one campaign did in one call, and the detail page grew three
folding sections — money and results (with per-channel cost-per-result from
exact money over measured outcomes only), messages sent, ad flights. The
page about intentions became a page about outcomes too.

### Phase 19 — The density pass — **/spend done; rest deferred**
`/spend` — the heaviest screen — folds in four sections with live summaries
("$4.20 charged · 1,110 messages committed", "2 plans sketched · $210 if
committed"), the rate card shipping pre-folded because 400 lines of
reference material is reading matter, not status. `/send` and `/advertise`
keep their own numbered-step and route-group headers; converting those to
Collapsible means merging two header systems, deferred to its own pass
rather than half-done. `/discover` is a staged flow, not a report — folding
it would hide steps, so it stays as is by decision, not omission.

### Phase 20 — One price language — **done**
`PriceTag` renders the product's three kinds of money one way everywhere —
exact at full weight, ~estimated muted with its settling tooltip, ranges
never collapsed to midpoints — and the flights table and campaign rollup
adopted it in place of their hand-rolled drift. The `/send` hour what-if no
longer judges one clock at UTC offset 0 (a "local time" that was nobody's):
it runs `quietHoursForAudience` over the actual recipients at the chosen
hour and says the honest split — who can receive it then, who is held until
their own morning — with the blocked notice reserved for the case where
that first number is zero.

## Known flake — **closed**

The night-send check depended on the wall clock twice over: it hunted for a
US zone currently asleep (skipping silently when none was, and skipping
*always* once the composer correctly started refusing all-asleep lists),
and its zone table disagreed with the product's near boundaries. Fixed by
making both layers take the clock as input — the composer already accepted
`sendAt`; the dispatcher gained an injectable `now` — so the test picks the
hour instead of waiting for it. It now runs at every hour of day and checks
more than it ever did: the composer refuses a send timed for the middle of
everyone's night, the dispatcher holds a queued message at 2am Pacific and
leaves it queued, nothing reaches the carrier, and the same message goes
out when the window opens — deferral is a delay, not a loss.

