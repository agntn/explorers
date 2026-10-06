import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";

/** One input per provider file, read off the disk, so a new provider needs no line here. */
const providerInputs = readdirSync(new URL("src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => `./src/providers/${file}`);

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the providers share the core chunks instead of each carrying its own copy. */
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/mcp.ts", ...providerInputs],
      /** Declaration maps would point at a src/ the tarball doesn't carry. */
      dts: { sourcemap: false },
    },
  ],
});
