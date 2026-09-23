import type { Pool, PoolClient } from "pg";
import type { Harvest, Grade } from "../types.js";

export class HarvestRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  async create(input: {
    batch_id: string;
    harvested_on: string;
    weight_grams: number;
    grade: Grade;
  }): Promise<Harvest> {
    const { rows } = await this.db.query<Harvest>(
      `INSERT INTO harvests (batch_id, harvested_on, weight_grams, grade)
       VALUES ($1, $2, $3, $4)
       RETURNING id, batch_id, harvested_on, weight_grams, grade, created_at`,
      [input.batch_id, input.harvested_on, input.weight_grams, input.grade]
    );
    return rows[0];
  }

  async findByBatchId(batchId: string): Promise<Harvest | null> {
    const { rows } = await this.db.query<Harvest>(
      `SELECT id, batch_id, harvested_on, weight_grams, grade, created_at
       FROM harvests WHERE batch_id = $1`,
      [batchId]
    );
    return rows[0] ?? null;
  }
}
