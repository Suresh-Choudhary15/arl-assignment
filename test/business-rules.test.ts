import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { makeTestApp, makeTestPool, truncateAll, createTray, seedBatch } from "./helpers.js";

describe("business rules", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeEach(async () => {
    pool = makeTestPool();
    app = makeTestApp(pool);
    await truncateAll(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // Rule 1: a tray can hold at most one active batch.
  it("rejects seeding a second batch into a tray that already has an active batch", async () => {
    const tray = await createTray(app);

    const first = await seedBatch(app, tray.id);
    expect(first.statusCode).toBe(201);

    const second = await seedBatch(app, tray.id, { crop: "Kale" });
    expect(second.statusCode).toBe(409);
  });

  it("allows seeding a new batch once the tray's previous batch is HARVESTED", async () => {
    const tray = await createTray(app);
    const first = await seedBatch(app, tray.id);
    const batch = first.json();

    // Walk it all the way to HARVESTED.
    await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` }); // GERMINATION
    await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` }); // GROWING
    await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` }); // HARVEST_READY
    const harvestRes = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload: { harvested_on: "2026-01-20", weight_grams: 500, grade: "A" },
    });
    expect(harvestRes.statusCode).toBe(201);

    const second = await seedBatch(app, tray.id, { crop: "Kale" });
    expect(second.statusCode).toBe(201);
  });

  // Rule 2: stage transitions only move forward, one step at a time.
  it("advances a batch exactly one stage per PATCH call, in order", async () => {
    const tray = await createTray(app);
    const batch = (await seedBatch(app, tray.id)).json();
    expect(batch.stage).toBe("SEEDED");

    const r1 = await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    expect(r1.json().stage).toBe("GERMINATION");

    const r2 = await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    expect(r2.json().stage).toBe("GROWING");
  });

  it("rejects advancing a batch past HARVESTED", async () => {
    const tray = await createTray(app);
    const batch = (await seedBatch(app, tray.id)).json();

    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    }
    await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload: { harvested_on: "2026-01-20", weight_grams: 500, grade: "A" },
    });

    const res = await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when advancing the stage of a batch that doesn't exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/batches/00000000-0000-0000-0000-000000000000/stage",
    });
    expect(res.statusCode).toBe(404);
  });

  // Rule 3: a harvest can only be recorded for a batch in HARVEST_READY.
  it("rejects recording a harvest for a batch that is not HARVEST_READY", async () => {
    const tray = await createTray(app);
    const batch = (await seedBatch(app, tray.id)).json(); // still SEEDED

    const res = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload: { harvested_on: "2026-01-20", weight_grams: 500, grade: "A" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects a second harvest for the same batch", async () => {
    const tray = await createTray(app);
    const batch = (await seedBatch(app, tray.id)).json();
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    }
    const payload = { harvested_on: "2026-01-20", weight_grams: 500, grade: "A" as const };
    const first = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload,
    });
    // The batch is HARVESTED after the first call, so the *stage* check
    // in the service (not just the DB unique constraint) is what catches
    // this — a clean 409 either way.
    expect(second.statusCode).toBe(409);
  });

  // Rule 4: recording a harvest moves the batch to HARVESTED and frees the tray.
  it("moves the batch to HARVESTED and frees the tray when a harvest is recorded", async () => {
    const tray = await createTray(app);
    const batch = (await seedBatch(app, tray.id)).json();
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "PATCH", url: `/batches/${batch.id}/stage` });
    }

    const harvestRes = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload: { harvested_on: "2026-01-20", weight_grams: 750, grade: "B" },
    });
    expect(harvestRes.statusCode).toBe(201);
    expect(harvestRes.json().batch.stage).toBe("HARVESTED");

    // Tray is free again: seeding a fresh batch into it should succeed.
    const reseed = await seedBatch(app, tray.id, { crop: "Spinach" });
    expect(reseed.statusCode).toBe(201);
  });

  // Validation basics called out explicitly in the spec.
  it("rejects a batch body with a missing crop with 400", async () => {
    const tray = await createTray(app);
    const res = await app.inject({
      method: "POST",
      url: "/batches",
      payload: { tray_id: tray.id, seeded_on: "2026-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a tray that doesn't exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trays/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 (not a conflict) when seeding into a well-formed tray_id that doesn't exist", async () => {
    const res = await seedBatch(app, "00000000-0000-0000-0000-000000000000");
    expect(res.statusCode).toBe(404);
  });
});
