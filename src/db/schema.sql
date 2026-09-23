-- AgResearch Labs — Tray/Batch/Harvest schema
--
-- Design notes (see README "Where rules are enforced" for the full story):
--
-- 1. "A tray can hold at most one active batch" is enforced here, at the
--    database level, with a PARTIAL UNIQUE INDEX on batches(tray_id) that
--    only applies to rows where stage <> 'HARVESTED'. A harvested batch no
--    longer counts as "active", so as soon as a batch reaches HARVESTED the
--    tray is implicitly free again — no cleanup step needed.
--
--    This is also what makes Part 3 (concurrency safety) work: two
--    simultaneous INSERTs for the same tray will race at the database, not
--    in application code, and Postgres guarantees only one of them commits.
--    See src/services/batch.service.ts for how the resulting unique
--    violation (Postgres error code 23505) is turned into a 409.
--
-- 2. Stage values are constrained with a CHECK so a bad stage string can
--    never reach the table even if a bug in application code let one
--    through. The actual "forward, one step at a time" transition rule
--    still lives in the service layer (src/services/batch.service.ts)
--    because it needs to compare "current stage" to "requested stage",
--    which a stateless CHECK constraint can't express.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS trays (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE,
  zone           TEXT NOT NULL,
  capacity_units INTEGER NOT NULL CHECK (capacity_units > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tray_id              UUID NOT NULL REFERENCES trays(id),
  crop                 TEXT NOT NULL,
  seeded_on            DATE NOT NULL,
  stage                TEXT NOT NULL DEFAULT 'SEEDED'
                         CHECK (stage IN ('SEEDED','GERMINATION','GROWING','HARVEST_READY','HARVESTED')),
  expected_harvest_on  DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The business rule: at most one *active* (non-HARVESTED) batch per tray.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_batch_per_tray
  ON batches (tray_id)
  WHERE stage <> 'HARVESTED';

CREATE INDEX IF NOT EXISTS batches_stage_idx ON batches (stage);
CREATE INDEX IF NOT EXISTS batches_crop_idx ON batches (crop);
CREATE INDEX IF NOT EXISTS batches_tray_idx ON batches (tray_id);

CREATE TABLE IF NOT EXISTS harvests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE, not just indexed: a batch can only ever be harvested once,
  -- because recording a harvest moves it to the terminal HARVESTED stage.
  batch_id      UUID NOT NULL UNIQUE REFERENCES batches(id),
  harvested_on  DATE NOT NULL,
  weight_grams  INTEGER NOT NULL CHECK (weight_grams > 0),
  grade         TEXT NOT NULL CHECK (grade IN ('A','B','C')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
