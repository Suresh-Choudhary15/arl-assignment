import type { Pool, PoolClient } from "pg";
import type { Tray } from "../types.js";

export class TrayRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  async create(input: {
    code: string;
    zone: string;
    capacity_units: number;
  }): Promise<Tray> {
    const { rows } = await this.db.query<Tray>(
      `INSERT INTO trays (code, zone, capacity_units)
       VALUES ($1, $2, $3)
       RETURNING id, code, zone, capacity_units, created_at`,
      [input.code, input.zone, input.capacity_units]
    );
    return rows[0];
  }

  async findAll(): Promise<Tray[]> {
    const { rows } = await this.db.query<Tray>(
      `SELECT id, code, zone, capacity_units, created_at
       FROM trays
       ORDER BY created_at ASC`
    );
    return rows;
  }

  async findById(id: string): Promise<Tray | null> {
    const { rows } = await this.db.query<Tray>(
      `SELECT id, code, zone, capacity_units, created_at
       FROM trays WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async codeExists(code: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM trays WHERE code = $1`,
      [code]
    );
    return rows.length > 0;
  }
}
