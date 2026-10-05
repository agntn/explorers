/**
 * Prints what each built entry runs on import: a bare `import "<entry>"` bundled with every module
 * treated as side-effectful, from a copy of the build outside the package, because rolldown still
 * obeys the `sideEffects` field in package.json over `moduleSideEffects`.
 * External packages load either way, so their bare imports stay out of the count, and so do the
 * region markers of emptied modules.
 * Run `pnpm build` first, or pass another build directory. Every entry except `dist/cli.mjs` should
 * print 0.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const dist = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../dist/", import.meta.url));
const entries = [
  "index.mjs",
  "cli.mjs",
  "mcp.mjs",
  ...readdirSync(join(dist, "providers"))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => `providers/${file}`),
];
const bareImport = /^import "[^./][^"]*";\n?/gmu;
/** Region markers rolldown leaves around a module that tree shaking emptied. */
const regionMarker = /^\/\/#(?:end)?region\b.*\n?/gmu;
const scratch = mkdtempSync(join(tmpdir(), "explorers-side-effects-"));
const copy = join(scratch, "dist");

try {
  cpSync(dist, copy, { recursive: true });
  for (const entry of entries) {
    const consumer = join(scratch, `${entry.replaceAll("/", "-")}`);
    writeFileSync(consumer, `import ${JSON.stringify(join(copy, entry))};\n`);
    const result = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: consumer, formats: ["es"], fileName: "consumer" },
        rolldownOptions: {
          external: [
            /^node:/u,
            /^@agntn\/chains/u,
            /^@modelcontextprotocol\//u,
            /^citty/u,
            /^consola/u,
            /^zod/u,
          ],
          treeshake: { moduleSideEffects: true },
        },
      },
    });
    const bytes = (Array.isArray(result) ? result : [result])
      .flatMap((output) => ("output" in output ? output.output : []))
      .reduce(
        (sum, chunk) =>
          chunk.type === "chunk"
            ? sum +
              Buffer.byteLength(chunk.code.replaceAll(bareImport, "").replaceAll(regionMarker, ""))
            : sum,
        0,
      );
    console.log(`${String(bytes).padStart(8)} B  dist/${entry}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
