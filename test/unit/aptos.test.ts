import { beforeAll, describe, expect, it } from "vitest";
import { UnsupportedChainError, UnsupportedOperationError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

describe("aptos provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeAll(async () => {
    provider = await create("aptos");
  });

  it("advertises no operations without a documented explorer API", () => {
    expect(provider.capabilities).toEqual({
      balances: false,
      txHistory: false,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    });
    expect(provider.getTxDetail).toBeUndefined();
    expect(provider.getBlockInfo).toBeUndefined();
  });

  it("throws a typed unsupported-operation error instead of using fullnode REST", async () => {
    await expect(provider.getBalance("0x1", "aptos")).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    await expect(provider.getTxHistory("0x1", "aptos")).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it("still distinguishes an unsupported chain", async () => {
    await expect(provider.getBalance("0x1", "ethereum")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
  });
});
