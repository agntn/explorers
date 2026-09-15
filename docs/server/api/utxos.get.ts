import { resolveAddresses } from "@agntn/explorers";
import type { UtxosAnswer } from "#shared/wire";

/** `getUtxos()` cut to `LIMITS.utxos` rows; `total` says how many the address holds. */
export default defineEventHandler((event): Promise<UtxosAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  return cachedRead(event, {
    prefix: "utxos",
    ttl: TTL.utxos,
    capability: "utxos",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input },
    run: async (selected) => {
      const getUtxos = requireOperation(selected, "utxos", "getUtxos");
      const [address = input] = await resolveAddresses(input, selected.chain);
      const utxos = await getUtxos(address, selected.chain);
      return { input, address, total: utxos.length, items: utxos.slice(0, LIMITS.utxos) };
    },
  });
});
