import type { Pool } from "pg";
import { BatchRepository, type ListBatchesFilter } from "../repositories/batch.repository.js";
import { TrayRepository } from "../repositories/tray.repository.js";
import { HarvestRepository } from "../repositories/harvest.repository.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { nextStage, type Batch, type Grade, type Harvest, type Stage } from "../types.js";

// node-postgres attaches `code` (the Postgres SQLSTATE) to errors it
// raises from a failed query. There's no first-class type for this in
// @types/pg, so we narrow with a small type guard instead of `any`.
function pgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

export class BatchService {
  private readonly batches: BatchRepository;
  private readonly trays: TrayRepository;

  constructor(private readonly db: Pool) {
    this.batches = new BatchRepository(db);
    this.trays = new TrayRepository(db);
  }

  // --- Seeding -------------------------------------------------------
  //
  // Part 3a (concurrency safety) lives here. We do NOT check "is this
  // tray free?" and then INSERT as two separate steps — that check
  // followed by a separate write is exactly the race window where two
  // concurrent requests can both pass the check before either has
  // written anything. Instead we just attempt the INSERT and let the
  // partial unique index `one_active_batch_per_tray` (see schema.sql)
  // be the single source of truth. Postgres guarantees that of two
  // concurrent INSERTs violating the same unique index, exactly one
  // commits and the other fails with SQLSTATE 23505. We catch that and
  // turn it into a 409. This holds even across multiple API instances
  // behind a load balancer, because the guarantee is enforced by the
  // database, not by anything in process memory.
  async seedBatch(input: {
    tray_id: string;
    crop: string;
    seeded_on: string;
    expected_harvest_on: string | null;
  }): Promise<Batch> {
    const tray = await this.trays.findById(input.tray_id);
    if (!tray) throw new NotFoundError(`Tray ${input.tray_id} not found.`);

    try {
      return await this.batches.create(input);
    } catch (err) {
      if (pgErrorCode(err) === BatchRepository.UNIQUE_VIOLATION) {
        throw new ConflictError(
          `Tray ${input.tray_id} already has an active batch.`
        );
      }
      throw err;
    }
  }

  // --- Stage transitions ----------------------------------------------
  //
  // "Forward, one step at a time" is a relationship between the row's
  // current value and the requested value, so it has to be checked
  // against the current data — a stateless CHECK constraint can't do
  // this (Postgres CHECKs can't reference the old row on UPDATE). We do
  // it here, inside a transaction with SELECT ... FOR UPDATE, so a
  // batch can't be double-advanced by two concurrent PATCH requests
  // racing on the same stale "current stage" read.
  async advanceStage(batchId: string): Promise<Batch> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const repo = new BatchRepository(client);
      const batch = await repo.findByIdForUpdate(batchId);
      if (!batch) throw new NotFoundError(`Batch ${batchId} not found.`);

      const target = nextStage(batch.stage);
      if (!target) {
        throw new ValidationError(
          `Batch ${batchId} is already HARVESTED; there is no next stage.`
        );
      }

      const updated = await repo.updateStage(batchId, target);
      await client.query("COMMIT");
      return updated;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Harvest ----------------------------------------------------------
  //
  // "A harvest can only be recorded for a batch in HARVEST_READY" and
  // "recording a harvest moves the batch to HARVESTED" are two effects
  // of one business event, so they happen in one transaction: read the
  // batch with a row lock, validate its stage, insert the harvest row,
  // flip the batch to HARVESTED. If the harvest insert fails (e.g. this
  // batch was somehow already harvested and hit the harvests.batch_id
  // UNIQUE constraint) the whole transaction rolls back — the batch is
  // never left half-updated.
  async recordHarvest(
    batchId: string,
    input: { harvested_on: string; weight_grams: number; grade: Grade }
  ): Promise<{ batch: Batch; harvest: Harvest }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const batchRepo = new BatchRepository(client);
      const harvestRepo = new HarvestRepository(client);

      const batch = await batchRepo.findByIdForUpdate(batchId);
      if (!batch) throw new NotFoundError(`Batch ${batchId} not found.`);

      if (batch.stage !== "HARVEST_READY") {
        throw new ConflictError(
          `Batch ${batchId} is in stage ${batch.stage}; harvests can only be recorded for HARVEST_READY batches.`
        );
      }

      const harvest = await harvestRepo.create({ batch_id: batchId, ...input });
      const updatedBatch = await batchRepo.updateStage(batchId, "HARVESTED");

      await client.query("COMMIT");
      return { batch: updatedBatch, harvest };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getBatch(id: string): Promise<Batch> {
    const batch = await this.batches.findById(id);
    if (!batch) throw new NotFoundError(`Batch ${id} not found.`);
    return batch;
  }

  async listBatches(filter: {
    stage?: Stage;
    crop?: string;
    zone?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: Batch[]; total: number; page: number; pageSize: number }> {
    const listFilter: ListBatchesFilter = {
      stage: filter.stage,
      crop: filter.crop,
      zone: filter.zone,
      limit: filter.pageSize,
      offset: (filter.page - 1) * filter.pageSize,
    };
    const { items, total } = await this.batches.list(listFilter);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }
}
