/** Live Koios public instance roundtrip. Run with `pnpm test:live`. */
import { describe, expect, it } from "vitest";
import { create } from "../../src/core/registry.ts";

const ADDRESS =
  "addr1q9xvgr4ehvu5k5tmaly7ugpnvekpqvnxj8xy50pa7kyetlnhel389pa4rnq6fmkzwsaynmw0mnldhlmchn2sfd589fgsz9dd0y";

describe("koios provider, live", () => {
  /** The public tier is rate limited and rebuilds the UTxO set per call, so it answers slowly. */
  it("reads an address off the public instance without a key", async () => {
    const provider = await create("koios");
    const balance = await provider.getBalance(ADDRESS, "cardano");

    expect(balance.chain).toBe("cardano");
    expect(balance.symbol).toBe("ADA");
    expect(balance.balance).toMatch(/^\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  }, 30_000);
});
