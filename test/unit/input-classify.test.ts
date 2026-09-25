import { describe, it, expect } from "vite-plus/test";
import { identify } from "@agntn/chains";
import { AddressChainMismatchError } from "../../src/core/errors.ts";
import { classifyInput, inferChain, resolveAddresses } from "../../src/core/input.ts";
import { normalizeChain } from "../../src/core/types.ts";

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
    expect(classifyInput("a".repeat(64), "bitcoincash")).toBe("txhash");
    expect(classifyInput("a".repeat(64), "bitcoinsv")).toBe("txhash");
    expect(classifyInput("a".repeat(64), "bitcoingold")).toBe("txhash");
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

const BITCOIN = "1AndrewYangForPresident2o2ozm6Pzd";
const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("inferChain", () => {
  it("names the chain of an address whose format fits only one", () => {
    expect(inferChain(BITCOIN)).toBe("bitcoin");
    expect(inferChain("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("bitcoin");
    expect(inferChain("TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL")).toBe("tron");
    expect(inferChain("GNiT8AiCaMYPYW9uSgmq2qUsVjNgh1kdty")).toBe("bitcoingold");
    expect(inferChain("bitcoincash:qz3yjg59ypg6jqpwhaxgvjj44jm4hdx0w5wsxw2qez")).toBe(
      "bitcoincash",
    );
  });

  it("names the one chain a provider serves when forks share the format", () => {
    expect(identify(BITCOIN).matches.map((match) => match.key)).toEqual(["bitcoin", "bitcoinsv"]);
    expect(inferChain(BITCOIN)).toBe("bitcoin");
  });

  it("gives a shared format to the chains a named provider serves", () => {
    expect(inferChain(BITCOIN, "whatsonchain")).toBe("bitcoinsv");
    expect(inferChain(BITCOIN, "blockstream")).toBe("bitcoin");
    // Etherscan serves neither, so the address keeps the chain it reads as without a provider.
    expect(inferChain(BITCOIN, "etherscan")).toBe("bitcoin");
  });

  it("leaves EVM addresses, ENS names, hashes and unknown input unresolved", () => {
    expect(inferChain(EVM)).toBeUndefined();
    expect(inferChain("vitalik.eth")).toBeUndefined();
    expect(inferChain("0x" + "a".repeat(64))).toBeUndefined();
    expect(inferChain("not-an-address")).toBeUndefined();
    expect(inferChain(undefined)).toBeUndefined();
  });

  it("resolves a list only when every entry names the same chain", () => {
    expect(inferChain([BITCOIN, "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"])).toBe("bitcoin");
    expect(inferChain(JSON.stringify([BITCOIN, BITCOIN]))).toBe("bitcoin");
    expect(inferChain([BITCOIN, EVM])).toBeUndefined();
  });
});

describe("address family check", () => {
  it("rejects an address whose format belongs to another chain family", async () => {
    const rejection = resolveAddresses(BITCOIN, normalizeChain("ethereum"));
    await expect(rejection).rejects.toBeInstanceOf(AddressChainMismatchError);
    await expect(rejection).rejects.toThrow(
      `Address ${BITCOIN} is not valid on ethereum; its format matches bitcoin`,
    );
  });

  it("shortens a long list of matching chains", async () => {
    await expect(resolveAddresses(EVM, "bitcoin")).rejects.toThrow(
      /its format matches ethereum, base, arbitrum and \d+ more$/,
    );
  });

  it("passes formats the validators do not recognize on to the provider", async () => {
    const rawTon = "0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8";
    await expect(resolveAddresses(rawTon, "ton")).resolves.toEqual([rawTon]);
    await expect(resolveAddresses("not-an-address", "ethereum")).resolves.toEqual([
      "not-an-address",
    ]);
  });

  it("passes formats shared within a chain family", async () => {
    const p2sh = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
    await expect(resolveAddresses(p2sh, "litecoin")).resolves.toEqual([p2sh]);
    await expect(resolveAddresses(BITCOIN, "ecash")).resolves.toEqual([BITCOIN]);
  });
});
