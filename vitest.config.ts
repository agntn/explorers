import { defineConfig } from "vitest/config";

const live = process.env.EXPLORERS_LIVE === "1";

export default defineConfig({
  test: {
    include: live ? ["test/live/**/*.test.ts"] : ["test/unit/**/*.test.ts"],
    setupFiles: live ? [] : ["test/unit/setup.ts"],
    ...(live ? { testTimeout: 30_000 } : {}),
  },
});
