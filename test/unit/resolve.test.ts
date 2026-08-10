import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownProviderError } from "../../src/core/errors.js";
import { resolveProvider } from "../../src/core/resolve.js";
import "../../src/providers/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveProvider", () => {
  it("honors an explicitly registered provider", () => {
    expect(resolveProvider("mempool")).toBe("mempool");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => resolveProvider("missing")).toThrow(UnknownProviderError);
  });

  it("prefers configured credentials before the free fallback", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "configured");

    expect(resolveProvider()).toBe("blockchair");
  });

  it("defaults to Blockscout when no credentials are configured", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");

    expect(resolveProvider()).toBe("blockscout");
  });
});
