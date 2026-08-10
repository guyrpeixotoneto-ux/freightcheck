import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The acceptance suite imports a real 628 KB workbook and writes ~83k
    // facts; the default 5s timeout is not meaningful here.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Each file provisions its own scratch database, so files must not race.
    fileParallelism: false,
  },
});
