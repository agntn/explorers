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
                "RegExp",
                "Uint8Array",
                "URL",
              ],
            },
            { from: "package", name: "FetchError", package: "ofetch" },
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
  test: {
    /* Unit tests stub fetch through test/unit/setup.ts. Live roundtrips opt in with EXPLORERS_LIVE=1. */
    include: live ? ["test/live/**/*.test.ts"] : ["test/unit/**/*.test.ts"],
    setupFiles: live ? [] : ["test/unit/setup.ts"],
    ...(live ? { testTimeout: 30_000 } : {}),
  },
  /**
   * One bundle, all inputs, so the providers share the core chunks instead of each embedding its
   * own copy. Every provider is its own input, so `create()` imports one `dist/providers/<key>.mjs`
   * that the `./providers/*` export also serves. Chunks keep stable names under `_chunks`, as
   * obuild wrote them.
   */
  pack: {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      "providers/etherscan": "src/providers/etherscan.ts",
      "providers/blockscout": "src/providers/blockscout.ts",
      "providers/blockchair": "src/providers/blockchair.ts",
      "providers/mempool": "src/providers/mempool.ts",
      "providers/blockstream": "src/providers/blockstream.ts",
      "providers/solscan": "src/providers/solscan.ts",
      "providers/helius": "src/providers/helius.ts",
      "providers/ton": "src/providers/ton.ts",
      "providers/tronscan": "src/providers/tronscan.ts",
      "providers/aptos": "src/providers/aptos.ts",
      "providers/blockberry": "src/providers/blockberry.ts",
      "providers/koios": "src/providers/koios.ts",
      "providers/arweave": "src/providers/arweave.ts",
      "providers/dcrdata": "src/providers/dcrdata.ts",
      "providers/horizon": "src/providers/horizon.ts",
      "providers/whatsonchain": "src/providers/whatsonchain.ts",
    },
    dts: true,
    format: "esm",
    platform: "node",
    sourcemap: true,
    hash: false,
    outputOptions: {
      chunkFileNames: "_chunks/[name].mjs",
      /* JSDoc ships once, in the declarations; the runtime files keep only legal and annotation comments. */
      comments: { jsdoc: false },
    },
  },
});
