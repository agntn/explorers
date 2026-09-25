/**
 * Prints what each built entry runs on import: a bare `import "<entry>"` bundled with every module
 * treated as side-effectful, so the `sideEffects` field in package.json cannot hide anything.
 * External packages load either way, so their bare imports stay out of the count.
 * Run `pnpm build` first, or pass another build directory. Every entry except `dist/cli.mjs` should
 * print 0.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  ...readdirSync(join(dist, "providers"))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => `providers/${file}`),
];
const bareImport = /^import "[^./][^"]*";\n?/gmu;
const scratch = mkdtempSync(join(tmpdir(), "explorers-side-effects-"));

try {
  for (const entry of entries) {
    const consumer = join(scratch, `${entry.replaceAll("/", "-")}`);
    writeFileSync(consumer, `import ${JSON.stringify(join(dist, entry))};\n`);
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
            /^ofetch/u,
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
            ? sum + Buffer.byteLength(chunk.code.replaceAll(bareImport, ""))
            : sum,
        0,
      );
    console.log(`${String(bytes).padStart(8)} B  dist/${entry}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
