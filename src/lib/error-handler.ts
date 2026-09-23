import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "./errors.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({
        error: "ValidationError",
        message: "Request body failed validation.",
        details: err.flatten(),
      });
      return;
    }

    if (
      err instanceof NotFoundError ||
      err instanceof ConflictError ||
      err instanceof ValidationError
    ) {
      reply.code(err.status).send({
        error: err.name,
        message: err.message,
        ...(err instanceof ValidationError && err.details
          ? { details: err.details }
          : {}),
      });
      return;
    }

    // Fastify's own body-parsing errors (malformed JSON, etc.) carry a
    // statusCode we should respect rather than always returning 500.
    if (typeof (err as { statusCode?: number }).statusCode === "number") {
      const statusCode = (err as { statusCode: number }).statusCode;
      reply.code(statusCode).send({ error: err.name, message: err.message });
      return;
    }

    app.log.error(err);
    reply.code(500).send({ error: "InternalServerError", message: "Something went wrong." });
  });
}
