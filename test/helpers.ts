import pg from "pg";
import { buildApp } from "../src/app.js";

const { Pool } = pg;

// Tests run against a real Postgres database (TEST_DATABASE_URL), not a
// mock. The business rules we're testing here — the partial unique
// index, the transactional stage/harvest logic — are largely *database*
// behavior, so a mocked pool would let the tests pass while the real
// thing was broken. See README "Running the tests" for how to point
// this at a local database.
const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/arl_test";

export function makeTestPool() {
  return new Pool({ connectionString });
}

export function makeTestApp(pool: pg.Pool) {
  return buildApp(pool);
}

export async function truncateAll(pool: pg.Pool) {
  await pool.query("TRUNCATE harvests, batches, trays CASCADE");
}

export async function createTray(
  app: ReturnType<typeof makeTestApp>,
  overrides: Partial<{ code: string; zone: string; capacity_units: number }> = {}
) {
  const res = await app.inject({
    method: "POST",
    url: "/trays",
    payload: {
      code: overrides.code ?? `T-TEST-${Math.random().toString(36).slice(2, 8)}`,
      zone: overrides.zone ?? "Zone A",
      capacity_units: overrides.capacity_units ?? 48,
    },
  });
  return res.json();
}

export async function seedBatch(
  app: ReturnType<typeof makeTestApp>,
  trayId: string,
  overrides: Partial<{ crop: string; seeded_on: string }> = {}
) {
  const res = await app.inject({
    method: "POST",
    url: "/batches",
    payload: {
      tray_id: trayId,
      crop: overrides.crop ?? "Lettuce",
      seeded_on: overrides.seeded_on ?? "2026-01-01",
    },
  });
  return res;
}
