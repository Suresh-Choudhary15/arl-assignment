# ARL Tray/Batch Tracking API

A REST API for tracking aeroponic tray/batch/harvest lifecycle, built for the
AgResearch Labs take-home assignment.

Stack: **Fastify + TypeScript + PostgreSQL + Zod + Vitest**.

---

## Setup (from a clean clone)

### Prerequisites

- Node.js 20+
- A PostgreSQL 14+ instance (local, Docker, or a hosted one like Railway/Supabase)

### Steps

```bash
npm install
cp .env.example .env
# edit .env and point DATABASE_URL at your Postgres instance
npm run db:migrate      # applies src/db/schema.sql
npm run db:seed         # optional: inserts 3 sample trays so you have something to POST batches against
npm run dev              # starts the API on http://localhost:3000 (or $PORT)
```

Verify it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Running the tests

The tests hit a **real** Postgres database, not a mock — several of the
business rules being tested (the partial unique index, the transactional
stage/harvest logic) are database behavior, and a mock would let a broken
constraint pass silently.

```bash
# create a second, disposable database for tests
createdb arl_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/arl_test npm run db:migrate

# then, with TEST_DATABASE_URL pointing at that database:
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/arl_test npm test
```

If `TEST_DATABASE_URL` is unset, the tests fall back to
`postgres://postgres:postgres@localhost:5432/arl_test` (see `test/helpers.ts`).

### Quick manual walkthrough

```bash
# create a tray
curl -X POST localhost:3000/trays -H "Content-Type: application/json" \
  -d '{"code":"T-A-014","zone":"Zone A","capacity_units":48}'

# seed a batch into it (use the tray id from the response above)
curl -X POST localhost:3000/batches -H "Content-Type: application/json" \
  -d '{"tray_id":"<tray-id>","crop":"Lettuce","seeded_on":"2026-09-01"}'

# advance it one stage at a time
curl -X PATCH localhost:3000/batches/<batch-id>/stage

# once it reaches HARVEST_READY, record a harvest
curl -X POST localhost:3000/batches/<batch-id>/harvest -H "Content-Type: application/json" \
  -d '{"harvested_on":"2026-09-20","weight_grams":1200,"grade":"A"}'
```

---

## API summary

| Method | Path                          | Notes                                            |
|--------|-------------------------------|---------------------------------------------------|
| POST   | `/trays`                      | 201, or 400 on bad body / duplicate code           |
| GET    | `/trays`                      | 200, array                                         |
| GET    | `/trays/:id`                  | 200, or 404                                        |
| POST   | `/batches`                    | 201, or 400 / 404 (tray missing) / 409 (tray busy) |
| GET    | `/batches`                    | 200; query: `stage`, `crop`, `zone`, `page`, `pageSize` |
| GET    | `/batches/:id`                | 200, or 404                                        |
| PATCH  | `/batches/:id/stage`          | 200 (advances one stage), or 400 / 404             |
| POST   | `/batches/:id/harvest`        | 201, or 400 / 404 / 409 (wrong stage)              |
| GET    | `/reports/yield`              | Part 3c (bonus) — see below                        |

`.env` is loaded automatically via `dotenv/config` (imported at the top of
`src/db/pool.ts`, which every entrypoint — the server, the migration
runner, and the seed script — goes through). You don't need to `export`
the variables yourself.

---

## Where each business rule is enforced

The spec's real question: *handler, service, database, or more than one
place?* Here's the breakdown and why:

**1. "A tray can hold at most one active batch."**
Enforced **at the database**, via a partial unique index:
`CREATE UNIQUE INDEX one_active_batch_per_tray ON batches (tray_id) WHERE stage <> 'HARVESTED'`.
I didn't duplicate this as an application-level "check then insert" — a
check-then-write is exactly the race window that breaks under concurrency
(see Part 3a below). The service layer (`batch.service.ts`) attempts the
insert directly and translates a unique-violation error (Postgres SQLSTATE
`23505`) into a 409. One rule, one place, and it's the place that can
actually make an atomic guarantee.

**2. "Stage transitions only move forward, one step at a time."**
Enforced **in the service layer** (`advanceStage` in `batch.service.ts`),
inside a transaction with `SELECT ... FOR UPDATE` on the batch row. This
rule needs to compare "current stage" to "requested stage," which a
stateless `CHECK` constraint can't express (Postgres `CHECK` constraints
can't see the pre-update row). As a backstop, the `stage` column still has
a `CHECK` constraint restricting it to the five known values, so a bug
elsewhere can't write garbage into the column — defense in depth, not
duplicated logic.

**3. "A harvest can only be recorded for a batch in HARVEST_READY."**
Enforced **in the service layer** (`recordHarvest`), same pattern: lock
the batch row, check its stage, then act. It has to be here because it's
a precondition on existing state, not something a column constraint can
see.

**4. "Recording a harvest moves the batch to HARVESTED and frees the tray."**
Also in `recordHarvest`, in the *same transaction* as rule 3 — insert the
harvest row and flip the batch's stage together, so a failure partway
through rolls back instead of leaving a harvest recorded against a batch
that's still HARVEST_READY. "Frees the tray" needs no explicit code at
all: because the unique index in rule 1 only applies `WHERE stage <>
'HARVESTED'`, a batch leaving HARVEST_READY for HARVESTED automatically
stops occupying the index, and the tray becomes seedable again the moment
the transaction commits.

General principle I followed: **push a rule to the database when it must
be atomic against concurrent writes (rule 1); keep it in the service layer
when it depends on comparing old vs. new state and there's no concurrent-
write race to worry about beyond the row lock already needed for
correctness (rules 2–4).** I did not duplicate rule 2's "one step forward"
logic as a second check in the database (e.g., a trigger) — it would be
belt-and-braces for a rule that's already race-free once you're holding
the row lock, and it would mean maintaining the same state machine in two
languages.

---

## Assumptions

The spec has some deliberate gaps. Here's what I hit and what I decided:

- **`expected_harvest_on` is optional and unvalidated against `seeded_on`.**
  The spec doesn't say whether it must be after `seeded_on`, or whether
  it's required at seed time. I made it optional and did not cross-validate
  it against `seeded_on`, since nothing in the spec's business rules
  depends on it — it reads as informational/planning data, not something
  the state machine enforces.
- **`PATCH /batches/:id/stage` takes no body.** The spec just says "advances
  a batch by one stage" — since there's only ever one valid next stage,
  I didn't see a reason to require the caller to name it. I considered
  accepting an optional `{"to": "GROWING"}` for explicitness/idempotency-
  of-intent, but decided the simpler no-body version matches "advances by
  one stage" more literally and there's less room for a client to send a
  target that doesn't match the *actual* current stage due to a stale read.
- **Capacity units are stored but not enforced against anything.** The
  spec's business rules never reference `capacity_units` (no rule like "a
  batch can't exceed tray capacity"), so I stored it as given in the
  suggested schema and left it unenforced rather than invent a rule the
  spec didn't ask for.
- **`GET /batches` pagination** uses `page` (1-indexed) and `pageSize`
  (default 20, max 100) query params, returning `{items, total, page,
  pageSize}`. The spec says "pagination" without specifying the shape;
  I picked page/pageSize over cursor-based pagination since the filtering
  requirements (stage/crop/zone) are simple equality filters better suited
  to offset pagination than keyset pagination.
- **Tray `code` uniqueness isn't a stated business rule**, but "T-A-014"
  read as a human-facing identifier that should plausibly be unique, and
  a duplicate would otherwise make trays impossible to distinguish by
  code. Added a `UNIQUE` constraint and a 400 on collision.
- **Dates are plain `DATE` (no time-of-day)** for `seeded_on`,
  `expected_harvest_on`, and `harvested_on`, matching the suggested schema's
  `_on` naming and the fact that these are daily agricultural events, not
  timestamped instants.
- **No auth**, per the spec's "what we will not judge" list.

---

## What I did not finish, and what I'd do with more time

- **Idempotent harvest recording (Part 3b)** — not implemented. I chose
  3a (concurrency safety) as the one required Part 3 item because it's
  the harder correctness problem and the one the seeding endpoint's
  design (the partial unique index) was already built to demonstrate
  well. With more time I'd add an `Idempotency-Key` header on
  `POST /batches/:id/harvest`, backed by a small `idempotency_keys`
  table (`key` PK, `response_body`, `response_status`, `created_at`),
  expiring keys after 24 hours (long enough to cover a field worker's
  retry-after-a-bad-connection window, short enough not to accumulate
  indefinitely). A retry with a seen key would return the stored response
  without touching `harvests` again.
- **Optimistic-lock / ETag support on `PATCH /batches/:id/stage`** — right
  now two concurrent PATCHes on the *same* batch are still handled
  correctly (the `SELECT ... FOR UPDATE` serializes them, so the second
  one simply sees the already-advanced stage and advances from there), but
  there's no way for a client to say "only advance if it's still
  GERMINATION." Wasn't required by the spec, but would be a natural
  addition if the field app needs to detect "someone else already moved
  this."
- **Structured request logging / correlation IDs** — Fastify's default
  logger is on, but I didn't add request-id propagation, which I'd want
  before running this for real across multiple instances.
- **`zone` as a first-class filter on trays** as well as batches (currently
  `zone` filtering only exists on `GET /batches`, joining through `trays`).

---

## Part 3: which one, and why

I chose **3a — concurrency safety**.

### How it works

`POST /batches` does not check "is this tray free?" and then insert as two
separate steps. It just attempts the insert. The partial unique index
`one_active_batch_per_tray` (in `schema.sql`) is the single source of
truth for "at most one active batch per tray," and Postgres guarantees
that when two concurrent transactions both try to insert a row that would
violate the same unique index, **exactly one commits** and the other
raises a unique-violation error (SQLSTATE `23505`) — regardless of how
close together in time the two `INSERT`s were issued. The service layer
(`batch.service.ts`) catches that specific error code and turns it into a
`409 Conflict`; anything else re-throws to the generic error handler.

### Why this holds under real concurrency, not just in a single-threaded test

`app.inject()` (Fastify's built-in test helper, used everywhere else in
the test suite) calls straight into route handlers without going over a
real socket — convenient, but it doesn't actually prove two requests can
be in flight at once. `test/concurrency.test.ts` instead boots the app on
a real TCP port and fires two (and separately, ten) genuinely concurrent
`fetch()` calls with `Promise.all` and no `await` between them, then
asserts exactly one `201` and the rest `409` — and separately queries the
database directly to confirm there's exactly one active batch row, not
just that one HTTP response happened to come back non-201.

### What happens behind a load balancer with multiple API instances

Nothing changes, and that's the point of putting the guarantee in the
database rather than in application memory. If this were an in-process
lock (a `Map<trayId, boolean>` or similar), it would only protect against
two concurrent requests hitting the *same* Node process — two requests
landing on different instances behind a load balancer would sail straight
past an in-memory lock and both write. Because the guarantee here is a
unique index inside Postgres, every instance is talking to the same
database, so the same atomicity holds no matter how many API processes
are running or which one each request lands on. The only thing that
changes at scale is that 409 rates would go up under high contention on a
single popular tray, which is the correct, honest behavior — the second
request genuinely can't have what it asked for.

---

## AI usage

I used **Claude** (via the CLI-driven container in this workflow) throughout:
scaffolding the Fastify/TypeScript project structure, writing the
Postgres schema and the service-layer transaction logic, drafting the
Vitest test suite (including the concurrency test), and writing this
README. I reviewed and ran all of it — the full test suite (13 tests, run
against a real local Postgres instance) passes, and I manually exercised
every endpoint with `curl` including the 409 paths, the freed-tray
re-seed, and the yield report — but the first draft of nearly every file
came from Claude rather than being typed by hand first. Where I made a
deliberate design call over an alternative Claude suggested (e.g., pushing
rule 1 to a database constraint rather than an application-level lock,
or picking page/pageSize over cursor pagination), that reasoning is
written into this README rather than left implicit, since that's the
part I'd need to defend on the call.
