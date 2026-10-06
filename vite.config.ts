import { fileURLToPath } from "node:url";
import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

const live = process.env.EXPLORERS_LIVE === "1";

export default defineConfig({
  fmt: {
    ...oxfmt,
    ignorePatterns: ["dist", "coverage", "docs", "CHANGELOG.md"],
  },
  lint: {
    ...oxlint,
    rules: {
      ...oxlint.rules,
      "typescript/prefer-readonly-parameter-types": [
        "error",
        {
          allow: [
            { from: "file", name: "ToolResult" },
            {
              from: "lib",
              name: [
                "AbortSignal",
                "Request",
                "RequestInfo",
                "RequestInit",
                "Response",
                "RegExp",
                "Uint8Array",
                "URL",
              ],
            },
            {
              from: "package",
              name: ["ExtensionAPI", "ToolDefinition"],
              package: "@earendil-works/pi-coding-agent",
            },
            {
              from: "package",
              name: ["ExtensionAPI", "ToolDefinition"],
              package: "@oh-my-pi/pi-coding-agent",
            },
          ],
          ignoreInferredTypes: true,
        },
      ],
    },
    overrides: [
      {
        /** Test mocks inspect broad Fetch tuples and provider methods without invoking those methods. */
        files: ["test/**/*.ts"],
        rules: {
          "typescript/no-base-to-string": "off",
          "typescript/unbound-method": "off",
        },
      },
    ],
    ignorePatterns: ["dist", "coverage", "docs"],
  },
  /** `docs/tsconfig.json` only points at `nuxt prepare` output, which CI never builds. */
  tsconfig: "tsconfig.json",
  test: {
    /* Unit tests stub fetch through test/unit/setup.ts. Live roundtrips opt in with EXPLORERS_LIVE=1. */
    include: live ? ["test/live/**/*.test.ts"] : ["test/unit/**/*.test.ts"],
    setupFiles: live ? [] : ["test/unit/setup.ts"],
    ...(live ? { testTimeout: 30_000 } : {}),
    /** A docs module resolves as the worker bundles it: `#shared`, and the library from `src/`. */
    alias: {
      "#shared": fileURLToPath(new URL("docs/shared", import.meta.url)),
      "@agntn/explorers": fileURLToPath(new URL("src/index.ts", import.meta.url)),
    },
  },
});
