import { describe, it, expect } from "vitest";
import { classifyInput, resolveAddresses } from "../../src/core/input.js";
import { normalizeChain } from "../../src/core/types.js";

describe("classifyInput", () => {
  it("classifies 0x + 64 hex as txhash", () => {
    const tx = "0x" + "a".repeat(64);
    expect(classifyInput(tx)).toBe("txhash");
  });

  it("classifies 0x + 40 hex as address", () => {
    const addr = "0x" + "a".repeat(40);
    expect(classifyInput(addr)).toBe("address");
  });

  it("classifies ENS names as ens", () => {
    expect(classifyInput("vitalik.eth")).toBe("ens");
    expect(classifyInput("nick.eth")).toBe("ens");
  });

  it("defaults unknown to address", () => {
    expect(classifyInput("not-an-ens-or-address")).toBe("address");
  });

  it("trims whitespace before classification", () => {
    const addr = "0x" + "a".repeat(40);
    expect(classifyInput("  " + addr + "  ")).toBe("address");
  });

  it("rejects too-short hex as address (not txhash)", () => {
    const short = "0xabc";
    expect(classifyInput(short)).toBe("address");
  });

  it("rejects 0x + 65 chars as address (one over txhash length)", () => {
    const tooLong = "0x" + "a".repeat(65);
    expect(classifyInput(tooLong)).toBe("address");
  });
  it("uses unambiguous chain-specific transaction hash shapes", () => {
    expect(classifyInput("a".repeat(64), "bitcoin")).toBe("txhash");
    expect(classifyInput("a".repeat(64), "ecash")).toBe("txhash");
    expect(classifyInput("a".repeat(64), "pepecoin")).toBe("txhash");
    expect(classifyInput("2".repeat(64), "solana")).toBe("txhash");
    expect(classifyInput("2".repeat(44), "sui")).toBe("txhash");
    expect(classifyInput("a".repeat(64), "cardano")).toBe("txhash");
  });

  it("keeps a Cardano bech32 address out of detail mode", () => {
    expect(
      classifyInput(
        "addr1q93k6rgprz5fxwkpvl2vgjq4pwejth400f8aldz2m3lj7khrnd05p259l0qjrf396am6wahv5895ey35y62fexta3q5q3cc3k8",
        "cardano",
      ),
    ).toBe("address");
  });

  it("keeps a prefixed CashAddr as an address", () => {
    expect(classifyInput("ecash:prfhcnyqnl5cgrnmlfmms675w93ld7mvvqd0y8lz07", "ecash")).toBe(
      "address",
    );
  });

  it("keeps a 32-byte Sui hex address in history mode", () => {
    expect(classifyInput(`0x${"a".repeat(64)}`, "sui")).toBe("address");
  });
});

describe("normalizeChain", () => {
  it("normalizes canonical names and aliases", () => {
    expect(normalizeChain("base")).toBe("base");
    expect(normalizeChain("btc")).toBe("bitcoin");
    expect(normalizeChain("coinbase")).toBe("base");
    expect(normalizeChain("apt")).toBe("aptos");
  });

  it("defaults missing values to Ethereum", () => {
    expect(normalizeChain()).toBe("ethereum");
  });

  it("resolves display names as well as aliases", () => {
    expect(normalizeChain("Arbitrum One")).toBe("arbitrum");
  });

  it("rejects unknown names instead of silently choosing Ethereum", () => {
    expect(() => normalizeChain("bitcion")).toThrow("Unknown chain: bitcion");
  });

  it("rejects a blank chain rather than reading it as a missing value", () => {
    expect(() => normalizeChain("")).toThrow("Unknown chain:");
    expect(() => normalizeChain("   ")).toThrow("Unknown chain:");
  });
});

describe("resolveAddresses", () => {
  it("wraps a single address in a one-element list", async () => {
    const addr = "0x" + "a".repeat(40);
    await expect(resolveAddresses(addr)).resolves.toEqual([addr]);
  });

  it("resolves a list of addresses preserving order", async () => {
    const first = "0x" + "1".repeat(40);
    const second = "0x" + "2".repeat(40);
    await expect(resolveAddresses([first, second])).resolves.toEqual([first, second]);
  });

  it("resolves a serialized address list from tool input", async () => {
    const first = "0x" + "1".repeat(40);
    const second = "0x" + "2".repeat(40);
    await expect(resolveAddresses(JSON.stringify([first, second]))).resolves.toEqual([
      first,
      second,
    ]);
  });

  it("keeps the tool batch limit for serialized lists", async () => {
    const addresses = Array.from({ length: 20 }, (_, index) => `address${index}`);
    await expect(resolveAddresses(JSON.stringify(addresses))).resolves.toEqual(addresses);
    await expect(resolveAddresses(JSON.stringify([...addresses, "address20"]))).rejects.toThrow(
      "Address list must contain 1 to 20 nonblank strings",
    );
  });

  it("rejects serialized lists that bypass tool item constraints", async () => {
    for (const addresses of [[], [" "], ["address", 1]]) {
      await expect(resolveAddresses(JSON.stringify(addresses))).rejects.toThrow(
        "Address list must contain 1 to 20 nonblank strings",
      );
    }
  });

  it("trims whitespace around each address", async () => {
    const addr = "0x" + "a".repeat(40);
    await expect(resolveAddresses([`  ${addr}  `])).resolves.toEqual([addr]);
  });
});
