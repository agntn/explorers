import { defineConfig } from "oxlint";
import oxlint from "@agntn/ox/oxlint";

export default defineConfig({
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
  ignorePatterns: ["dist", "coverage"],
});
