/**
 * Records the landing samples through the built library and writes app/utils/landing-fixtures.ts.
 *
 * Keyless providers only, so the script runs on any machine. The landing paints these before the
 * worker answers and swaps each one for a live answer as it arrives. Never edit the output by hand.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveAddresses, withProvider } from "../../dist/index.mjs";
import { slimTransaction } from "../server/utils/slim.ts";

const out = fileURLToPath(new URL("../app/utils/landing-fixtures.ts", import.meta.url));

const TARGETS = [
  { chain: "ethereum", input: "vitalik.eth", provider: "blockscout" },
  { chain: "bitcoin", input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", provider: "mempool" },
  { chain: "arweave", input: "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw", provider: "arweave" },
];

const LIMIT = 5;

/**
 * Optional fields a provider can still send as null (`src/providers/blockscout.ts` passes `method`
 * through); JSON keeps the null, the `Transaction` type does not. Nullable fields such as `to` stay.
 */
const OPTIONAL = ["timestamp", "gasUsed", "gasPrice", "fee", "methodId", "functionName"];

function withoutNulls(transaction) {
  const row = { ...transaction };
  for (const key of OPTIONAL) if (row[key] === null) delete row[key];
  return row;
}

function slim(transaction) {
  return withoutNulls(slimTransaction(transaction));
}

async function record(target) {
  return withProvider(
    target.provider,
    target.chain,
    async (selected) => {
      const [address] = await resolveAddresses(target.input, selected.chain);
      const balance = await selected.provider.getBalance(address, selected.chain);
      const history = (
        await selected.provider.getTxHistory(address, selected.chain, { limit: LIMIT })
      )
        .slice(0, LIMIT)
        .map(slim);
      let gas = null;
      if (selected.provider.capabilities.gasData && selected.provider.getGasData) {
        gas = await selected.provider.getGasData(selected.chain);
      }
      return {
        chain: selected.chain,
        input: target.input,
        address,
        provider: selected.name,
        balance,
        history,
        gas,
        live: false,
      };
    },
    "balances",
  );
}

const samples = [];
for (const target of TARGETS) {
  console.log(`recording ${target.input} on ${target.chain} through ${target.provider}`);
  samples.push(await record(target));
}

const body = `/**
 * Landing samples recorded through the library by scripts/record-fixtures.mjs.
 * Generated on ${new Date().toISOString()}. Do not edit by hand; run \`pnpm fixtures\`.
 */
import type { Balance, GasData, TokenTransfer, Transaction } from "@agntn/explorers";

export type SampleTransaction = Omit<Transaction, "raw" | "tokenTransfers"> & {
  tokenTransfers: Omit<TokenTransfer, "txHash">[];
};

export interface ExplorerSample {
  chain: string;
  /** What was typed: an ENS name or an address. */
  input: string;
  /** The address the read went to, after ENS resolution. */
  address: string;
  provider: string;
  balance: Balance;
  history: SampleTransaction[];
  gas: GasData | null;
  /** False for the recorded sample, true once the worker's answer replaced it. */
  live: boolean;
}

export const LANDING_SAMPLES: readonly ExplorerSample[] = ${JSON.stringify(samples, null, 2)};
`;

writeFileSync(out, body);
console.log(`wrote ${out}: ${samples.length} samples`);
