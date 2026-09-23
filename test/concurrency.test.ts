import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { makeTestApp, makeTestPool, truncateAll, createTray } from "./helpers.js";

// Part 3a — concurrency safety.
//
// `app.inject()` (used in business-rules.test.ts) is convenient but calls
// straight into the same Node event loop one at a time from the test's
// point of view — it doesn't prove two requests can't interleave badly.
// To actually exercise the race, we boot the app on a real TCP port and
// fire genuinely concurrent HTTP requests at it with Promise.all, so the
// two request handlers really are in flight at the same time and racing
// on the database, not just queued up in JS.
describe("Part 3a: concurrent batch seeding", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    pool = makeTestPool();
    app = makeTestApp(pool);
    await truncateAll(pool);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected a bound TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("lets exactly one of two simultaneous seed requests for the same tray succeed", async () => {
    const tray = await createTray(app);

    const seed = (crop: string) =>
      fetch(`${baseUrl}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tray_id: tray.id, crop, seeded_on: "2026-01-01" }),
      });

    // Fire both at once. No await between them — that's the point.
    const [resA, resB] = await Promise.all([seed("Lettuce"), seed("Kale")]);
    const statuses = [resA.status, resB.status].sort();

    expect(statuses).toEqual([201, 409]);

    // Belt and braces: confirm the database agrees there's exactly one
    // active batch on this tray, not just that one HTTP call failed.
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM batches WHERE tray_id = $1 AND stage <> 'HARVESTED'`,
      [tray.id]
    );
    expect(rows[0].count).toBe(1);
  });

  it("holds up under a higher-concurrency burst (10 simultaneous requests, same tray)", async () => {
    const tray = await createTray(app);

    const seed = (n: number) =>
      fetch(`${baseUrl}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tray_id: tray.id, crop: `Crop-${n}`, seeded_on: "2026-01-01" }),
      });

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => seed(i)));
    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(9);
  });
});
