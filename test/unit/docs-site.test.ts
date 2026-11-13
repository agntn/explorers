import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { listProviders } from "../../src/index.ts";

const docs = new URL("../../docs/", import.meta.url);

const read = (path: string): string => readFileSync(new URL(path, docs), "utf8");

/* The quoted strings inside the first `[...]` after a marker in `text`. */
function quotedAfter(text: string, marker: string): string[] {
  const start = text.indexOf("[", text.indexOf(marker) + marker.length);
  const list = text.slice(start, text.indexOf("]", start));
  return [...list.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
}

/* Every file under a docs directory whose name ends in one of the extensions, relative to `docs/`. */
function filesIn(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(new URL(directory, docs), { recursive: true, encoding: "utf8" })
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => `${directory}${file}`)
    .sort();
}

/* The string literals of the array a docs file writes right after a marker. */
function literalsAfter(path: string, marker: string): string[] {
  const source = read(path);
  const start = source.indexOf(marker);
  const list = start === -1 ? "" : source.slice(start, source.indexOf("]", start));
  return [...list.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
}

/* The `{ ... }` block a docs file opens right after a marker, up to its matching brace. */
function blockAfter(path: string, marker: string): string {
  const source = read(path);
  const open = source.indexOf("{", source.indexOf(marker));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    depth += source[index] === "{" ? 1 : source[index] === "}" ? -1 : 0;
    if (depth === 0) return source.slice(open, index + 1);
  }
  return "";
}

const staticPages = readdirSync(new URL("app/pages/explorer/", docs))
  .filter((file) => file.endsWith(".vue"))
  .map((file) => (file === "index.vue" ? "/explorer" : `/explorer/${file.slice(0, -4)}`))
  .sort();

const pages = filesIn("content/", [".md"]);

describe("the explorer's Vue pages", () => {
  it("hands every static one to the sitemap, which reads only content/", () => {
    expect(staticPages).toContain("/explorer/gas");
    expect(literalsAfter("server/api/__sitemap__/pages.ts", "const PAGES =").sort()).toEqual(
      staticPages,
    );
  });

  it("drops the markdown twin useSeo links, since none of them has one", () => {
    const vue = filesIn("app/pages/explorer/", [".vue"]);
    expect(vue.length).toBeGreaterThan(staticPages.length);
    expect(vue.filter((file) => !read(file).includes("useNoMarkdownTwin()"))).toEqual([]);
  });
});

describe("the site's components", () => {
  const sources = filesIn("app/", [".ts", ".vue"]);

  it("render token and contract names as text, never through v-html", () => {
    expect(sources.filter((file) => read(file).includes("v-html"))).toEqual([]);
  });

  it("draw nothing from Math.random, so the server and the browser render one page", () => {
    expect(sources.filter((file) => read(file).includes("Math.random"))).toEqual([]);
  });

  it("name every provider's keys the way resolveProvider reads them", () => {
    const presentation = blockAfter("app/utils/providers.ts", "const PRESENTATION");
    const envMap = blockAfter("../src/core/resolve.ts", "const ENV_MAP");
    const optional = quotedAfter(
      read("../src/core/resolve.ts"),
      "OPTIONAL_CREDENTIAL_PROVIDERS: readonly string[]",
    );
    const names = listProviders().map(({ name }) => name);
    const site = names.map((name) => {
      const entry = blockAfter("app/utils/providers.ts", `\n  ${name}: {`);
      expect(presentation).toContain(entry);
      return [name, quotedAfter(entry, "envVars:"), entry.includes("optionalKey: true")];
    });
    const library = names.map((name) => [
      name,
      quotedAfter(envMap, `\n  ${name}:`),
      optional.includes(name),
    ]);
    expect(site).toEqual(library);
  });
});

describe("the worker", () => {
  const servers = filesIn("server/", [".ts"]);

  it("takes h3 helpers from nuxt/server, whose events they read, not the auto-imports", () => {
    const helper = /\b(?:defineEventHandler|getQuery|createError|isNuxtError)\(/u;
    const imports = /from "nuxt\/server"/u;
    const loose = servers.filter((file) => helper.test(read(file)) && !imports.test(read(file)));
    expect(loose).toEqual([]);
  });

  it("limits by the same number wrangler.jsonc gives the binding", () => {
    const binding = /"limit":\s*(\d+)/u.exec(read("wrangler.jsonc"))?.[1];
    const code = /export const RATE_LIMIT = (\d+);/u.exec(read("server/utils/query.ts"))?.[1];
    expect(binding).toBeDefined();
    expect(code).toBe(binding);
  });
});

describe("the content pages", () => {
  it("keep ': ' out of a description, which YAML reads as a mapping and drops the page", () => {
    const broken = pages.filter((file) =>
      /^description:\s*[^\s"'].*:\s/mu.test(/^---\n([\s\S]*?)\n---/u.exec(read(file))?.[1] ?? ""),
    );
    expect(broken).toEqual([]);
  });
});
