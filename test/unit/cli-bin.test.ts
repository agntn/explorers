/// <reference types="node" />
import { execFile } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const bin = resolve(root, "dist/cli.mjs");

/* Print every module URL the process loaded, once it exits. */
const recordLoads = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
const loaded = [];
registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
process.once("exit", () => process.stderr.write("@loaded " + JSON.stringify(loaded) + "\\n"));
`)}`;

/**
 * Run a built bin with `mcp` and return the module URLs it loaded. stdin closes at once, so the
 * server stops as soon as it has started. An inherited `EXPLORERS_DIST` is dropped.
 *
 * @param {string} path - The bin file.
 * @param {Readonly<Record<string, string>>} environment - Extra variables for the child.
 * @returns {Promise<string[]>} Every module URL the run loaded.
 */
async function runMcp(
  path: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const { EXPLORERS_DIST: _inherited, ...inherited } = process.env;
  const pending = execFileAsync(process.execPath, ["--import", recordLoads, path, "mcp"], {
    cwd: root,
    encoding: "utf8",
    env: { ...inherited, ...environment },
    timeout: 20_000,
  });
  pending.child.stdin?.end();
  const { stderr } = await pending;
  const report = /@loaded (\[.*\])/u.exec(stderr)?.[1];
  if (report === undefined) throw new Error(`the load hook reported nothing: ${stderr}`);
  return (JSON.parse(report) as unknown[]).map(String);
}

/* Copy the built package with the given entries next to `dist`, resolving dependencies from the checkout. */
function copyPackage(parent: string, entries: readonly string[]): string {
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(join(parent, "explorers-bin-"));
  for (const entry of ["dist", "package.json", ...entries]) {
    cpSync(resolve(root, entry), join(copy, entry), { recursive: true });
  }
  return copy;
}

describe("explorers mcp from the built bin", () => {
  beforeAll(() => {
    if (!existsSync(bin)) throw new Error("dist/cli.mjs is missing, run pnpm build first");
  });

  it("serves the live source inside a checkout and the bundle under EXPLORERS_DIST=1", async () => {
    const source = pathToFileURL(join(root, "src/")).href;
    const live = await runMcp(bin);
    const bundled = await runMcp(bin, { EXPLORERS_DIST: "1" });

    expect(live).toContain(`${source}mcp.ts`);
    expect(bundled.filter((url) => url.startsWith(source))).toEqual([]);
  });

  it("keeps the bundle under node_modules, where Node does not strip types", async () => {
    const copy = copyPackage(resolve(root, "node_modules/.cache"), ["src"]);
    try {
      const loaded = await runMcp(join(copy, "dist/cli.mjs"));
      const source = pathToFileURL(join(copy, "src/")).href;

      expect(loaded.filter((url) => url.startsWith(source))).toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it("keeps the bundle without src, as the npm package ships", async () => {
    const copy = copyPackage(tmpdir(), []);
    try {
      symlinkSync(resolve(root, "node_modules"), join(copy, "node_modules"));
      const loaded = await runMcp(join(copy, "dist/cli.mjs"));

      expect(loaded).toContain(pathToFileURL(join(copy, "dist/cli.mjs")).href);
      expect(loaded.filter((url) => url.endsWith(".ts"))).toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

describe("explorers as an installed executable", () => {
  it("starts through its shebang, the way npm and npx run a linked bin", async () => {
    const copy = copyPackage(tmpdir(), []);
    try {
      symlinkSync(resolve(root, "node_modules"), join(copy, "node_modules"));
      const path = join(copy, "dist/cli.mjs");
      chmodSync(path, 0o755);
      /* PATH holds node alone: without a shebang the file runs through sh, and `import` must not resolve. */
      const onlyNode = join(copy, "path");
      mkdirSync(onlyNode);
      symlinkSync(process.execPath, join(onlyNode, "node"));
      const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
        version: string;
      };

      const { stdout } = await execFileAsync(path, ["--version"], {
        encoding: "utf8",
        env: { PATH: onlyNode },
        timeout: 20_000,
      });

      expect(stdout.trim()).toBe(version);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
