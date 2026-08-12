# Running Perception

Everything here was run on a clean machine before it was written down. If a
command in this file does not work, that is a bug in the file.

---

## The short version

You need **Node 20+** and **PostgreSQL**. Then:

```bash
npm install
npm run setup      # writes .env, applies the schema, seeds a workspace
npm run dev        # http://localhost:3000
```

Sign in as **dana@summitlocal.co** / **demo-password-change-me**.

That gets you a working product with 1,285 contacts, five campaigns, 76
published posts, 2,895 recorded clicks and 280 conversions — so every
reporting screen shows real numbers computed from real rows, not fixtures.
Two more terminals turn on the parts that move:

```bash
npm run worker     # scheduled sends and publishes actually fire
npm run mocks      # stand-in email/SMS/social servers, so sending works end to end
```

If anything is off, `npm run doctor` will tell you exactly which thing and the
command that fixes it.

---

## What you need first

| | Version | Why |
|---|---|---|
| **Node** | 20 or newer (22 tested) | The app. `node --version` |
| **PostgreSQL** | 14 or newer (16 tested) | Everything is stored here. Required. |
| **Redis** | 6 or newer | Optional. Without it nothing *scheduled* runs. |

Neither database needs to be installed on the machine — Docker is fine:

```bash
docker run -d --name perception-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=perception postgres:16

docker run -d --name perception-redis -p 6379:6379 redis:7
```

Homebrew, apt, or a hosted Postgres all work the same way. The only thing that
matters is that `DATABASE_URL` in `.env` points at something that answers.

---

## Step by step

### 1. Install

```bash
git clone <this repo>
cd Perception
npm install
```

### 2. Set up

```bash
npm run setup
```

This writes a `.env` if you don't have one — generating the encryption keys
rather than asking you to paste them — applies the database schema, and seeds
the sample workspace. It **never overwrites an existing `.env`**; if you
already have one it only appends keys that are missing.

It stops at the first thing it can't do. If Postgres isn't listening it says
so and exits, rather than running a migration against nothing.

If you'd rather do it by hand:

```bash
cp .env.example .env                                  # then edit DATABASE_URL
openssl rand -base64 32                               # → TOKEN_ENCRYPTION_KEY
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

### 3. Run

```bash
npm run dev
```

Open <http://localhost:3000> and sign in with the credentials above. The
password is a well-known default — set `SEED_PASSWORD` before seeding if
anyone else can reach the machine.

---

## The three processes

The app is one of three things, and it's worth knowing which does what,
because "my scheduled post never went out" is almost always the second one
not running.

```bash
npm run dev        # 1. the web app          → localhost:3000
npm run worker     # 2. the scheduler        → no port, scans every 30s
npm run mocks      # 3. local stand-ins      → ports 4321-4329
```

**The web app** serves every screen and handles anything you do by pressing a
button. Sending an email right now works with only this running.

**The worker** is what makes time pass. It picks up scheduled sends, publishes
queued posts, refreshes platform metrics, and settles ad flights. Without it
the calendar fills up and nothing ever leaves — and nothing else in the system
can tell you that, because the app still serves and the card still says
`SCHEDULED`. It reports a heartbeat every scan, which is how `npm run doctor`
knows to say so.

**The stand-ins** are nine small servers that speak the real wire protocols of
the services the app talks to — Twilio's form-encoded POSTs and signed status
callbacks, Mastodon's two-step media upload, Bluesky's blob refs, Reddit's
habit of returning errors inside a `200`. The adapter code in `src/lib/` is
the same code that runs against production; only the hostname differs. That's
what makes them worth running instead of stubbing: a bug in how we sign a
Twilio callback shows up locally.

| Port | Stands in for |
|---|---|
| 4321 | Mastodon |
| 4322 | A customer's website (for the tracking snippet) |
| 4323 | Resend (email) |
| 4324 | Twilio (SMS) |
| 4325 | Meta Graph (Facebook, Instagram, Threads) |
| 4326 | Bluesky PDS |
| 4327 | Reddit |
| 4328 | Pinterest |
| 4329 | Google Business Profile |

Start a subset with `npm run mocks -- --only mastodon,twilio`. If one of them
dies, the rest are stopped too — a single stand-in falling over silently is
the failure mode that costs an afternoon, because the suite then fails on an
unrelated assertion twenty minutes later.

---

## When something is wrong

```bash
npm run doctor
```

It checks the toolchain, the config, the database, the schema, whether the
seed ran, Redis, all nine stand-ins, and the app itself — and every failure
ends in the command that fixes it, not a description of the symptom.

```
Perception — environment check

  ✓ Node 22.22.2
  ✓ Dependencies installed
  ✓ .env found
  ✓ TOKEN_ENCRYPTION_KEY looks right
  ✗ Nothing listening on localhost:5432
      → Start PostgreSQL, then: npx prisma migrate deploy
  ! Redis not reachable — scheduled work will not run
      → redis-server --port 6379 --daemonize yes
  ✓ App answering on http://localhost:3000

1 thing to fix before the app will run.
```

It exits non-zero when something is genuinely broken, so it works as a CI gate
or a container healthcheck. The distinction it draws is deliberate: **✗** means
the app will not run, **!** means it will run with something switched off.

### The usual three

**A scheduled post never went out.** The worker is not running. `npm run
worker` — and `npm run doctor` will say so before you have to guess.

**Blank screens, no errors.** The database is empty. `npm run db:seed`.

**`@prisma/client did not initialize`.** The generated client is stale after a
schema change. `npx prisma generate`.

**Port 3000 in use.** `PORT=3001 npm run dev`, and set `APP_URL` to match —
tracked links and OAuth redirects are built from it.

---

## Tests

```bash
npm test
```

Five suites, ~890 checks: unit, media, security, worker, and a UI suite that
drives a real browser. Most of them need the full environment up — Postgres,
Redis, all nine stand-ins, and the app on 3000 — because they test things that
only exist when the system is running.

**Stop the worker first.** `npm run worker` dispatches the same queue the
suites do, and whichever process claims a row first keeps it. Both are
behaving correctly — claiming is a compare-and-swap precisely so several
workers *can* run — but it makes "the dispatcher sent all 1,111" unassertable,
and the symptom is a baffling `sent 1108 of 1111` that reads like a product
bug. The suites detect a live scheduler by its heartbeat and refuse to start,
saying exactly that.

Individually: `npm run test:unit`, `test:media`, `test:security`,
`test:worker`, `test:ui`. Type checking is separate: `npm run typecheck`.

---

## Going from local to real

Every channel follows the same pattern, and it's one line per channel.

The `.env` written by `npm run setup` points each service at a local
stand-in via a `*_BASE_URL` variable. **Delete that line and put in real
credentials, and the app talks to the real service.** No code changes, no flag
to flip:

```diff
  RESEND_API_KEY="re_your_real_key"
  RESEND_FROM="hello@yourdomain.com"
- RESEND_BASE_URL="http://localhost:4323"
```

The same shape applies to `TWILIO_BASE_URL`, `META_BASE_URL`,
`REDDIT_BASE_URL`, `PINTEREST_BASE_URL`, `GBP_BASE_URL`, and
`BLUESKY_PDS_URL`.

Two things to know before you point anything at production:

**Bluesky is the one that needs no paperwork.** A handle and an app password,
and it works — no app registration, no review queue. It's the fastest way to
see a real post go out from real code. Connections → Bluesky.

**Everything else has a queue.** Meta needs App Review for
`pages_manage_posts` and `instagram_content_publish`. SMS to US numbers needs
10DLC registration. X needs a paid API tier. `docs/CONNECTORS.md` has the
constraint on each one; the app models these as `NEEDS SETUP` rather than
pretending they're one click away.

For real deployment — TLS, the `Secure` cookie flag, `TRUSTED_PROXY_COUNT`,
media storage, and what the config checker refuses to start without — see
`docs/PRODUCTION.md`.

---

## Where things are

```
src/app/(app)/       every screen (the admin shell)
src/app/api/         the HTTP surface
src/lib/             the actual product logic
  publishers/          one file per platform, all to one contract
  senders/             email and SMS, per-organisation credentials
  measurability.ts     why a number is missing — four states, not one
  analytics.ts         reporting, with per-metric availability
prisma/schema.prisma the data model
scripts/             tests, stand-in servers, setup, doctor
docs/                specs, architecture, capability analysis, roadmap
```

`docs/CAPABILITY_ANALYSIS.md` is the honest inventory: what is built, what is
modelled, and what is not there yet.
