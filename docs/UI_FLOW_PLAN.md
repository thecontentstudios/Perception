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

### Phase 19 — The density pass
Collapsible on the five screens above, with summaries that keep answering
while folded ("$210 planned · 2 flights · $47 estimated") — the pattern
`/analytics` already set.

### Phase 20 — One price language
A single PriceTag component carrying the three styles that already exist —
exact, ~estimated, low–high range — so every screen renders money the same
way. Fix the `/send` hour what-if to use `quietHoursForAudience` (already
built server-side): show "951 of 1,110 can receive it now", which is true,
instead of a local hour that is nobody's.
