/** Tell whether an address has shown its public key on chain */
import { defineCommand } from "citty";
import type { PubkeyReveal } from "../core/types.ts";
import { print, refuseOperation, reportCommandError, withSelectedProvider } from "./shared.ts";

function renderPubkey(providerName: string, reveal: Readonly<PubkeyReveal>): void {
  print(`[${providerName}] ${reveal.address} on ${reveal.chain}`);
  if (reveal.pubkey !== null) {
    const shown = reveal.source === "output" ? "Taproot output paid in" : "Shown by spend";
    print(`  Pubkey: ${reveal.pubkey}`);
    print(`  ${shown}: ${reveal.txid ?? "unknown"}`);
    return;
  }
  if (!reveal.spent) {
    print("  No pubkey shown: the address never spent");
    return;
  }
  print("  Spent, but no key read: a script this read does not parse,");
  print("  or a spend past the newest 1000 transactions");
}

export default defineCommand({
  meta: {
    name: "pubkey",
    description: "Tell whether an address has shown its public key on chain",
  },
  args: {
    address: {
      type: "positional",
      description: "Blockchain address",
      required: true,
    },
    chain: {
      type: "string",
      alias: "c",
      description: "Chain (bitcoin, litecoin, pepecoin)",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider (mempool, blockstream)",
    },
  },
  async run({ args }) {
    try {
      const { resolveInput } = await import("../core/input.ts");
      await withSelectedProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
        "pubkeys",
        async (selected) => {
          const getPubkey = selected.provider.getPubkey?.bind(selected.provider);
          if (!selected.provider.capabilities.pubkeys || !getPubkey) {
            return refuseOperation("getPubkey", selected.name);
          }
          const { address } = await resolveInput(args.address as string, selected.chain);
          renderPubkey(selected.name, await getPubkey(address, selected.chain));
        },
        args.address as string,
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
