# Publishing — connecting accounts and sharing across socials

Cross-posting is easy to demo and hard to get right. The hard parts are not
"send the same text to five APIs" — they are:

1. **A place to post is not the same as an authorization.**
2. **Destinations belong to different businesses.**
3. **Each destination must succeed or fail on its own.**
4. **A retry must never become a second post.**

## 1. Accounts vs. destinations

| | What it is | Example |
|---|---|---|
| `ConnectedAccount` | One OAuth grant, from one person, for one platform | "Meta, authorized by Dana" |
| `PublishDestination` | A place a post can actually land | "GreenScape Landscaping Page", "@velvetroomstudio" |

One authorization usually yields several destinations. Publishing always
targets a **destination**, never an account — "post it to Facebook" is not a
publishing instruction when the workspace runs four businesses.

Permissions differ per destination, too. In the demo the Meta token is
perfectly healthy while the Loopwise Page still fails, because the authorizing
user only has Analyst access there. An account-level health check would call
that connection green and then fail at publish time.

## 2. The connect pipeline

Four steps, because each is where real setups break:

1. **Before you start** — prerequisites in plain language ("your Instagram must
   be a professional account linked to a Page you administer"), plus the honest
   caveat for that platform.
2. **Permissions** — every scope with a one-sentence reason, using the same
   scope names the platform's own consent screen shows. Optional scopes can be
   declined without breaking publishing.
3. **Authorize** — the handoff. Tokens come back encrypted at rest and are
   never displayed, including to the owner.
4. **Choose destinations** — this is the step most tools skip. Authorization
   *discovers* destinations (`listDestinations()` in the connector contract);
   you then pick which to enable and map each to a business. Without that
   mapping, the landscaper's post can land on the recording studio's Page.

Connectability is gated on **whether we have specified how to connect a
channel**, not on which release wave it's in. Bluesky needs no app review at
all and TikTok can be authorized today (uploads simply land as private drafts
until our content audit clears) — hiding those behind a roadmap label would
make the flow unreachable for no reason. Channels with no spec yet
(partner-gated Nextdoor, Snapchat, WhatsApp, SMS) stay marked *Planned*.

## 3. Fan-out: simultaneous or scheduled

`/post` writes once and sends to many destinations, either immediately or at a
scheduled time. Both paths run the same fan-out; scheduling just hands it to
the scheduler instead of the publisher.

Before anything is sent, each selected destination is checked twice:

- **Destination blockers** — authorization expired, destination switched off,
  not mapped to a business, or a destination-scoped permission problem.
- **Channel checks** — the adapter's own rules (caption length, ratio,
  duration, unsubscribe footer).

Blocked destinations are **skipped and named**, never silently dropped, and
the rest still go out. Publishing is outward-facing and hard to undo, so it
takes an explicit confirmation listing exactly where the post will land.

## 4. One job per destination

Every destination gets its own `PublishJob` walking its own stages:

```
queued → validating → uploading → publishing → verifying → done
                                      ↓
                                   failed → retry
```

They are genuinely independent. In the demo run, one destination hits a rate
limit while ten others publish — the failure stops that job's chain and
nothing else. Retrying recovers it without touching the ten that already went
out.

### Idempotency

Each job carries an `idempotencyKey` stable across retries, derived from
(content, destination, scheduled slot). A retry **reuses** it. This is what
makes a retry safe: if a worker died after the platform had already accepted
the post, the retry resolves to the same post rather than publishing a second
one. The suite asserts the job count does not grow on retry.

## Prototype vs. production

Real: the account/destination split, per-destination blocking with specific
reasons, the connect pipeline's shape and scope copy, the job model, stage
progression, independent failure, and idempotent retry.

Simulated: the OAuth redirect and the platform API calls. Production replaces
`runJob` with a BullMQ worker calling the connector contract's
`publish()`, and `discoverDestinations` with the real `listDestinations()` —
the surrounding model does not change.
