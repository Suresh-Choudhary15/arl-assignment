import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    fileParallelism: false, // tests share one Postgres DB; avoid cross-test truncation races
  },
});
