import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB tests share one Postgres instance; run files serially to keep
    // per-test user fixtures from interleaving unpredictably.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
