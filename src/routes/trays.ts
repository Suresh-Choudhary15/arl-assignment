import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TrayService } from "../services/tray.service.js";

const createTraySchema = z.object({
  code: z.string().trim().min(1, "code is required"),
  zone: z.string().trim().min(1, "zone is required"),
  capacity_units: z.number().int().positive("capacity_units must be a positive integer"),
});

export async function trayRoutes(app: FastifyInstance) {
  const service = new TrayService(app.pg);

  app.post("/trays", async (req, reply) => {
    const input = createTraySchema.parse(req.body);
    const tray = await service.createTray(input);
    reply.code(201).send(tray);
  });

  app.get("/trays", async (_req, reply) => {
    const trays = await service.listTrays();
    reply.send(trays);
  });

  app.get<{ Params: { id: string } }>("/trays/:id", async (req, reply) => {
    const tray = await service.getTray(req.params.id);
    reply.send(tray);
  });
}
