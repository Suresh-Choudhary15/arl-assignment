import type { Pool } from "pg";
import { TrayRepository } from "../repositories/tray.repository.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { Tray } from "../types.js";

export class TrayService {
  private readonly trays: TrayRepository;

  constructor(db: Pool) {
    this.trays = new TrayRepository(db);
  }

  async createTray(input: {
    code: string;
    zone: string;
    capacity_units: number;
  }): Promise<Tray> {
    if (await this.trays.codeExists(input.code)) {
      // Caught pre-emptively (rather than relying only on the DB unique
      // constraint) so we can give a precise, friendly message. The DB
      // constraint is still there as a backstop against a race between
      // this check and the insert — see README for why that's fine here
      // (trays are created by admins/ops, not a high-contention path like
      // batch seeding, so a rare duplicate-code 500 racing this check is
      // an acceptable trade-off; batch seeding gets the full treatment).
      throw new ValidationError(`Tray code "${input.code}" is already in use.`);
    }
    return this.trays.create(input);
  }

  async listTrays(): Promise<Tray[]> {
    return this.trays.findAll();
  }

  async getTray(id: string): Promise<Tray> {
    const tray = await this.trays.findById(id);
    if (!tray) throw new NotFoundError(`Tray ${id} not found.`);
    return tray;
  }
}
