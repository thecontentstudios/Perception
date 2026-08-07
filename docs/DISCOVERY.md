# Discovery — reading a business before asking it anything

A small-business owner should not have to describe their own business to us.
They already did it — on their website, in their Instagram bio, and in the
photos sitting unused in their camera roll. Discovery reads all three, tells
them what's missing, and drafts posts grounded in what it found.

This is the front half of the funnel the composer assumed away: **the
composer asks "what are you promoting?" — discovery answers it.**

## The three passes

| Pass | Reads | Produces |
|------|-------|----------|
| **Site** | Homepage, services, contact, sitemap | Services with prices and seasons, NAP, hours, live offers, testimonials, brand voice, palette, conversion URL, platform |
| **Profiles** | Footer links, `rel=me`, handle search, connector read scopes | Per-channel handle, followers, cadence, days since last post, best-performing format, recurring themes, bio/link issues |
| **Media** | The asset library | Unused assets, missing alt text, ratios on hand, channels with no usable asset, subject tags |

Those feed **gap detection** (what's missing, ranked by what it costs) and the
**suggestion engine** (what to post about it).

## Every fact carries its source

Extraction is a guess until proven otherwise, so each fact is a
`Fact<T>` — value, `SourceRef`, and confidence:

```ts
address: f('41 Springfield Ave, Maplewood, NJ 07040', 'jsonld', 'schema.org PostalAddress')
voice:   f({ register: 'warm', … }, 'inferred', 'tone analysis across 11 pages', 0.72)
```

The UI prints the source under every value, and anything below 0.7 confidence
gets a **confirm** chip. A business owner correcting a wrong fact needs to
know which page we read it off — otherwise they can't tell whether to fix our
software or their website.

Trust order when parsing: **JSON-LD → OpenGraph → meta → DOM → inferred.**
Anything derived rather than stated is labelled `inferred` and never presented
as though the site said it.

## Suggestions must justify themselves

Every `Suggestion` carries `reasons[]`, and each reason points at evidence:

> **Spotlight a service: Fall & spring cleanups**
> - Listed on /services with no matching post.
> - It's a fall service and we're in fall — the timing is now.
> - Your site already states the price (from $275), so the post can too.

A suggestion the owner can't trace back to a fact about their own business is
filler, and filler is what makes people stop trusting generated content. The
seven generators:

| Source | Trigger |
|--------|---------|
| `live_offer` | An offer on the site appears in no scheduled post |
| `unused_media` | An asset uploaded and never posted; matched to the format its ratio suits |
| `dormant_profile` | A profile with an audience and no post in 30+ days |
| `testimonial` | A published review that has never been posted socially |
| `service_page` / `seasonal` | A service with no matching post — promoted if it's in season now |
| `missing_profile` | A channel the business has no account on |
| `faq` | Hours/service-area facts absent from the Business Profile |

Copy is written **in the brand's own voice** — the analyzer extracts register,
emoji habit, average sentence length, and signature phrases, and the generator
conditions on them. It also respects each channel's shape: Instagram and
TikTok get "link in bio" (or "details in the comments" when the bio has no
link — a real gap discovery detects), X and Bluesky get a bare URL, everything
else gets a labelled link.

## Nothing publishes

Accepted suggestions become a **campaign of drafts** on the calendar, staggered
across days, each still subject to the full preflight safeguards. The
`missing alt text` suggestion, for instance, ships with a reason that says so
and will be held by preflight until it's fixed. The rule from the rest of the
product holds: AI drafts, humans approve.

## Prototype vs. production

`analyze()` resolves deterministically from a fixture table — no network. What
is real: the types, the staged pipeline, per-fact provenance, gap detection,
the media audit (computed live from the actual asset library), and the whole
suggestion engine.

Production swaps the fixture for the extractors named on each field, behind
the same interface:

- fetch with a real user agent and a `robots.txt` check
- parse JSON-LD → OpenGraph → DOM, follow `sitemap.xml` for service pages
- resolve profiles from footer/`rel=me` links, then verified handle search
- pull profile stats through each connector's already-authenticated read scopes
- generate copy with a model call conditioned on the extracted voice profile

The contract does not change; only what sits behind it.

## Try it

`/discover` → analyze `greenscapenj.com` (or any of the four demo domains).
An unknown domain fails honestly rather than inventing a business.
