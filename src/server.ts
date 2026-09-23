import { pool } from "./db/pool.js";
import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = buildApp(pool);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`ARL API listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

async function shutdown() {
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
