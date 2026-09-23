// Optional: a handful of trays so you have something to POST batches
// against without typing curl commands from scratch. Safe to run more than
// once (ON CONFLICT DO NOTHING on the unique `code` column).
import { pool } from "./pool.js";

async function main() {
  const trays = [
    { code: "T-A-001", zone: "Zone A", capacity_units: 48 },
    { code: "T-A-002", zone: "Zone A", capacity_units: 48 },
    { code: "T-B-014", zone: "Zone B", capacity_units: 96 },
  ];

  for (const t of trays) {
    await pool.query(
      `INSERT INTO trays (code, zone, capacity_units)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [t.code, t.zone, t.capacity_units]
    );
  }

  console.log(`Seeded ${trays.length} trays (skipping any that already exist).`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
