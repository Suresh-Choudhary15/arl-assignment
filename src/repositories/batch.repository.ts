import type { Pool, PoolClient } from "pg";
import type { Batch, Stage } from "../types.js";

export interface ListBatchesFilter {
  stage?: Stage;
  crop?: string;
  zone?: string; // joins through trays
  limit: number;
  offset: number;
}

export class BatchRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  // Postgres uniqueness error code, re-exported here so callers (the
  // service layer) don't need to know the raw string themselves.
  static readonly UNIQUE_VIOLATION = "23505";

  async create(input: {
    tray_id: string;
    crop: string;
    seeded_on: string;
    expected_harvest_on: string | null;
  }): Promise<Batch> {
    const { rows } = await this.db.query<Batch>(
      `INSERT INTO batches (tray_id, crop, seeded_on, expected_harvest_on)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at`,
      [input.tray_id, input.crop, input.seeded_on, input.expected_harvest_on]
    );
    return rows[0];
  }

  async findById(id: string): Promise<Batch | null> {
    const { rows } = await this.db.query<Batch>(
      `SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at
       FROM batches WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  // Row-locking read, used inside a transaction before a stage transition
  // or harvest so two concurrent requests against the *same* batch can't
  // both read the same "current stage" and both think they're allowed to
  // proceed. Must be called with a PoolClient that is inside BEGIN/COMMIT.
  async findByIdForUpdate(id: string): Promise<Batch | null> {
    const { rows } = await this.db.query<Batch>(
      `SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at
       FROM batches WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    return rows[0] ?? null;
  }

  async updateStage(id: string, stage: Stage): Promise<Batch> {
    const { rows } = await this.db.query<Batch>(
      `UPDATE batches SET stage = $2 WHERE id = $1
       RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at`,
      [id, stage]
    );
    return rows[0];
  }

  async list(filter: ListBatchesFilter): Promise<{ items: Batch[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.stage) {
      params.push(filter.stage);
      conditions.push(`b.stage = $${params.length}`);
    }
    if (filter.crop) {
      params.push(filter.crop);
      conditions.push(`b.crop = $${params.length}`);
    }
    if (filter.zone) {
      params.push(filter.zone);
      conditions.push(`t.zone = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM batches b JOIN trays t ON t.id = b.tray_id
       ${where}`,
      params
    );

    const listParams = [...params, filter.limit, filter.offset];
    const { rows } = await this.db.query<Batch>(
      `SELECT b.id, b.tray_id, b.crop, b.seeded_on, b.stage, b.expected_harvest_on, b.created_at
       FROM batches b JOIN trays t ON t.id = b.tray_id
       ${where}
       ORDER BY b.created_at ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return { items: rows, total: Number(countResult.rows[0].count) };
  }
}
