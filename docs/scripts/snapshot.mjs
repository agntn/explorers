/**
 * Writes app/data/explorers.json from the built library.
 *
 * The site never imports the library into the browser, so the provider list, the chains each one
 * serves, its capabilities, its default endpoint and the chain metadata are copied here once. The
 * build script runs it first, so the committed file cannot go stale in production; the committed
 * copy is what `pnpm dev` and the diff show.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { builtins, PROVIDER_DEFAULT_CHAIN, version } from "../../dist/index.mjs";
import { create } from "@agntn/chains";

const out = fileURLToPath(new URL("../app/data/explorers.json", import.meta.url));

const providers = builtins.map((entry) => ({
  key: entry.key,
  chains: [...entry.chains],
  capabilities: [...(entry.capabilities ?? [])],
  defaultURL: entry.defaultURL ?? null,
  defaultChain: PROVIDER_DEFAULT_CHAIN[entry.key] ?? "ethereum",
}));

const chainKeys = [...new Set(providers.flatMap((provider) => provider.chains))];
const chains = chainKeys.map((key) => {
  const chain = create(key);
  return {
    key,
    name: chain.name,
    symbol: chain.symbol,
    type: chain.type,
    explorer: chain.explorer ?? null,
    providers: providers.filter((provider) => provider.chains.includes(key)).map((p) => p.key),
  };
});

const snapshot = { version, generatedAt: new Date().toISOString(), providers, chains };
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `wrote ${out}: ${providers.length} providers, ${chains.length} chains, @agntn/explorers ${version}`,
);
