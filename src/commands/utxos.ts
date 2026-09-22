/** List the unspent outputs an address still controls */
import { defineCommand } from "citty";
import type { Utxo } from "../core/types.js";
import { failCommand, print, reportCommandError, withSelectedProvider } from "./shared.js";

function renderUtxos(
  providerName: string,
  address: string,
  chain: string,
  utxos: readonly Readonly<Utxo>[],
): void {
  const confirmed = utxos.filter((utxo) => utxo.confirmed);
  const total = confirmed.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  print(`[${providerName}] ${utxos.length} unspent outputs for ${address} on ${chain}`);
  print(`  Confirmed total: ${total} base units`);
  if (confirmed.length < utxos.length) {
    print(`  Pending: ${utxos.length - confirmed.length}`);
  }
  print("");
  for (const utxo of utxos) {
    const position = utxo.confirmed ? `block ${utxo.blockNumber ?? "unknown"}` : "pending";
    print(`  ${utxo.txid}:${utxo.vout}  ${utxo.valueFormatted}  [${position}]`);
  }
}

export default defineCommand({
  meta: {
    name: "utxos",
    description: "List the unspent outputs a Bitcoin-like address still controls",
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
      const { resolveInput } = await import("../core/input.js");
      await withSelectedProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
        "utxos",
        async (selected) => {
          const getUtxos = selected.provider.getUtxos?.bind(selected.provider);
          if (!selected.provider.capabilities.utxos || !getUtxos) {
            failCommand(`Provider "${selected.name}" does not support unspent outputs`);
          }
          const { address } = await resolveInput(args.address as string, selected.chain);
          const utxos = await getUtxos(address, selected.chain);
          renderUtxos(selected.name, address, selected.chain, utxos);
        },
        args.address as string,
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
