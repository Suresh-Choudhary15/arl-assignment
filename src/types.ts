// Domain types. These mirror the Postgres schema in src/db/schema.sql.

export const STAGES = [
  "SEEDED",
  "GERMINATION",
  "GROWING",
  "HARVEST_READY",
  "HARVESTED",
] as const;

export type Stage = (typeof STAGES)[number];

export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export interface Tray {
  id: string;
  code: string;
  zone: string;
  capacity_units: number;
  created_at: string;
}

export interface Batch {
  id: string;
  tray_id: string;
  crop: string;
  seeded_on: string; // ISO date (YYYY-MM-DD)
  stage: Stage;
  expected_harvest_on: string | null;
  created_at: string;
}

export interface Harvest {
  id: string;
  batch_id: string;
  harvested_on: string;
  weight_grams: number;
  grade: Grade;
  created_at: string;
}

// Returns the stage that immediately follows `stage`, or null if `stage`
// is already terminal (HARVESTED).
export function nextStage(stage: Stage): Stage | null {
  const idx = STAGES.indexOf(stage);
  if (idx === -1 || idx === STAGES.length - 1) return null;
  return STAGES[idx + 1];
}
