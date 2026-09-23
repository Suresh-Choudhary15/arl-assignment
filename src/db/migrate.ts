// Minimal migration runner: this project has a single, idempotent
// schema.sql (everything is CREATE ... IF NOT EXISTS), so "migrating" is
// just "apply the file". That's a deliberate simplification for a
// take-home assignment — a real project would use numbered migrations.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);
  console.log("Schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
