import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../lib/errors.js";

// Part 3c (bonus — chosen in addition to 3a, see README "Part 3").
//
// GET /reports/yield?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=crop|zone
//
// Returns, per group: total harvested weight, number of batches
// harvested, and the average number of days from seeding to harvest.
// Done as a single SQL query (no per-group loop) — see README for a
// walkthrough of the query itself.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const yieldQuerySchema = z.object({
  from: dateString,
  to: dateString,
  group_by: z.enum(["crop", "zone"]),
});

// group_by picks a column, which can't be a bound parameter — but since
// it's validated against a fixed enum above (not raw user input dropped
// into the string), it's safe to interpolate.
const GROUP_COLUMN: Record<"crop" | "zone", string> = {
  crop: "b.crop",
  zone: "t.zone",
};

export async function reportRoutes(app: FastifyInstance) {
  app.get("/reports/yield", async (req, reply) => {
    const q = yieldQuerySchema.parse(req.query);

    if (q.from > q.to) {
      throw new ValidationError("`from` must not be after `to`.");
    }

    const groupCol = GROUP_COLUMN[q.group_by];

    const { rows } = await app.pg.query(
      `SELECT
         ${groupCol} AS group_key,
         SUM(h.weight_grams)::bigint AS total_weight_grams,
         COUNT(*)::int AS batches_harvested,
         AVG(h.harvested_on - b.seeded_on)::float AS avg_days_to_harvest
       FROM harvests h
       JOIN batches b ON b.id = h.batch_id
       JOIN trays t ON t.id = b.tray_id
       WHERE h.harvested_on BETWEEN $1 AND $2
       GROUP BY ${groupCol}
       ORDER BY total_weight_grams DESC`,
      [q.from, q.to]
    );

    reply.send({
      from: q.from,
      to: q.to,
      group_by: q.group_by,
      groups: rows,
    });
  });
}
