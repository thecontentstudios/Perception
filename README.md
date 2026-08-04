# Perception

**A campaign operating system for small businesses.**
One campaign, everywhere your customers are — plan social posts, email, and
website promotions from one simple calendar.

This repository contains the **clickable product design** and **prioritized
MVP specification** for Perception: a fully navigable Next.js prototype built
on the real domain model, plus the production data model and architecture
docs. It is the working blueprint the production application will be built
from.

## Run it

```bash
npm install
npm run dev        # → http://localhost:3000
```

No database or API keys needed — the prototype runs on an in-memory demo
workspace. The demo clock is pinned to **Thursday, October 8, 2026** so the
flagship example (the *Fall Cleanup Promotion*, Sep 15 – Oct 31, 21 quote
requests so far) is live mid-flight: published results behind it, scheduled
work ahead, one failed publish to fix, and approvals waiting. Interactions
(drag-rescheduling, approving, reconnecting, generating a campaign) update
state live and reset on reload.

### A tour worth taking

1. **Home** — today's priorities: a failed LinkedIn publish, a reconnection,
   two approvals.
2. **Connections** — reconnect LinkedIn, then retry the failed post from Home
   and watch it publish.
3. **Calendar** — month/week/platform-lane/list views; drag cards between
   days; open the side panel; note the safeguard warnings (video too long,
   wrong ratio, missing unsubscribe footer, three promotions on Oct 15).
4. **Create** — the five-step composer: define the outcome, add source
   material, generate drafts (never auto-published), review real per-platform
   previews, then approve & schedule.
5. **Analytics** — outcomes first: "The Fall Cleanup campaign has generated
   21 quote requests. Instagram produced the most interest, while email had
   the highest conversion rate."

## What's real vs. simulated

**Real:** the domain model (`src/lib/types.ts`), the connector contract and
per-platform capability sheets (`src/lib/connectors/`), the preflight
safeguard engine (`src/lib/preflight.ts`), the campaign generator's flow, all
UI and interaction design, and the production schema
(`prisma/schema.prisma`).

**Simulated:** network I/O — OAuth, publishing, metrics, and AI generation
resolve locally with deterministic data. The production build replaces those
edges behind the same interfaces.

## Repository map

```
src/lib/            domain: types, dates, channels, demo data, store
src/lib/connectors/ the connector contract + 9 platform adapters
src/lib/preflight.ts intelligent safeguards (human-readable warnings)
src/lib/generate.ts  composer draft generation
src/components/     shell, calendar card, side-panel editor, previews, UI kit
src/app/            the ten product areas (Home … Settings)
prisma/schema.prisma production data model (PostgreSQL)
docs/MVP_SPEC.md    prioritized P0/P1/P2 specification
docs/ARCHITECTURE.md services, publishing pipeline, token lifecycle
docs/CONNECTORS.md  platform capability matrix + review constraints
```

## Product principles

- The **campaign** is the central object — not the individual post.
- Write the message once; adapt per channel without losing either.
- AI drafts; humans approve. Nothing publishes without explicit permission.
- Never silently discard content a platform can't take — warn and hold.
- Official APIs only; platform review work starts before the UI is finished.
- Analytics speak the owner's language: leads, bookings, revenue — not
  impressions.
