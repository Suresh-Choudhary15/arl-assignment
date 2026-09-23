import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerErrorHandler } from "./lib/error-handler.js";
import { trayRoutes } from "./routes/trays.js";
import { batchRoutes } from "./routes/batches.js";
import { reportRoutes } from "./routes/reports.js";

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
  }
}

export function buildApp(pool: Pool): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.decorate("pg", pool);
  registerErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.register(trayRoutes);
  app.register(batchRoutes);
  app.register(reportRoutes);

  return app;
}
