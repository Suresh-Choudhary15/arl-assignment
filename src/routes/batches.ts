import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BatchService } from "../services/batch.service.js";
import { GRADES, STAGES } from "../types.js";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

const seedBatchSchema = z.object({
  tray_id: z.string().uuid("tray_id must be a UUID"),
  crop: z.string().trim().min(1, "crop is required"),
  seeded_on: dateString,
  expected_harvest_on: dateString.nullable().optional(),
});

const harvestSchema = z.object({
  harvested_on: dateString,
  weight_grams: z.number().int().positive("weight_grams must be a positive integer"),
  grade: z.enum(GRADES),
});

const listQuerySchema = z.object({
  stage: z.enum(STAGES).optional(),
  crop: z.string().trim().min(1).optional(),
  zone: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
});

export async function batchRoutes(app: FastifyInstance) {
  const service = new BatchService(app.pg);

  app.post("/batches", async (req, reply) => {
    const input = seedBatchSchema.parse(req.body);
    const batch = await service.seedBatch({
      tray_id: input.tray_id,
      crop: input.crop,
      seeded_on: input.seeded_on,
      expected_harvest_on: input.expected_harvest_on ?? null,
    });
    reply.code(201).send(batch);
  });

  app.get("/batches", async (req, reply) => {
    const q = listQuerySchema.parse(req.query);
    const result = await service.listBatches(q);
    reply.send(result);
  });

  app.get<{ Params: { id: string } }>("/batches/:id", async (req, reply) => {
    const batch = await service.getBatch(req.params.id);
    reply.send(batch);
  });

  app.patch<{ Params: { id: string } }>("/batches/:id/stage", async (req, reply) => {
    const batch = await service.advanceStage(req.params.id);
    reply.send(batch);
  });

  app.post<{ Params: { id: string } }>("/batches/:id/harvest", async (req, reply) => {
    const input = harvestSchema.parse(req.body);
    const result = await service.recordHarvest(req.params.id, input);
    reply.code(201).send(result);
  });
}
