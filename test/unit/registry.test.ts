import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChain } from "@agntn/chains";
import { describe, expect, it, vi } from "vitest";
import { getDefaultURL, providers } from "../../src/core/registry.js";
import { builtins } from "../../src/providers/index.js";

const providerDir = fileURLToPath(new URL("../../src/providers/", import.meta.url));
const buildConfig = readFileSync(
  fileURLToPath(new URL("../../build.config.ts", import.meta.url)),
  "utf8",
);

const modules = readdirSync(providerDir).filter(
  (file) => file.endsWith(".ts") && file !== "index.ts",
);

describe("built-in provider registry", () => {
  it("keeps every provider module in the list", () => {
    expect(builtins).toHaveLength(modules.length);
  });

  it("shares an in-flight provider load across concurrent creates", async () => {
    vi.resetModules();
    const { builtins: isolatedBuiltins } = await import("../../src/providers/index.js");
    const { create: isolatedCreate } = await import("../../src/core/registry.js");
    const entry = isolatedBuiltins.find((candidate) => candidate.key === "mempool");
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing mempool provider entry");

    const load = vi.spyOn(entry, "load");
    try {
      const [first, second] = await Promise.all([
        isolatedCreate("mempool"),
        isolatedCreate("mempool"),
      ]);

      expect(first.name).toBe("mempool");
      expect(second.name).toBe("mempool");
      expect(first).not.toBe(second);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      load.mockRestore();
    }
  });

  it("registers the listed providers under their own keys, in order", () => {
    expect(providers()).toEqual(builtins.map((entry) => entry.key));
  });

  it("advertises the endpoint each entry declares", () => {
    for (const entry of builtins) {
      expect(getDefaultURL(entry.key)).toBe(entry.defaultURL);
    }
  });

  it("names chains the chain registry knows", () => {
    for (const entry of builtins) {
      expect(entry.chains.length).toBeGreaterThan(0);
      for (const chain of entry.chains) {
        expect(getChain(chain).key).toBe(chain);
      }
    }
  });

  it("loads a class whose key matches its entry", async () => {
    for (const entry of builtins) {
      const providerClass = await entry.load();
      expect(providerClass.key).toBe(entry.key);
    }
  });

  it("builds every provider module as its own bundle entry", () => {
    for (const file of modules) {
      expect(buildConfig).toContain(`./src/providers/${file}`);
    }
  });
});
