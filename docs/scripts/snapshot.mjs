/**
 * Writes app/data/explorers.json from the library sources.
 *
 * The site never imports the library into the browser, so the provider list, the chains each one
 * serves, its capabilities, its default endpoint and the chain metadata are copied here once. The
 * build script runs it first, so the committed file cannot go stale in production; the committed
 * copy is what `pnpm dev` and the diff show. It loads `src/` through jiti so Workers Builds, which
 * never produces `dist/`, can still refresh the file.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { create } from "@agntn/chains";

const jiti = createJiti(import.meta.url);
const { builtins } = await jiti.import("../../src/providers/index.ts");
const { PROVIDER_DEFAULT_CHAIN } = await jiti.import("../../src/core/resolve.ts");
const { version } = await jiti.import("../../src/version.ts");

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
