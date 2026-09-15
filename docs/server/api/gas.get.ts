import type { GasAnswer } from "#shared/wire";

/** `getGasData()` in the provider's own unit. */
export default defineEventHandler((event): Promise<GasAnswer> => {
  const query = getQuery(event);
  return cachedRead(event, {
    prefix: "gas",
    ttl: TTL.gas,
    capability: "gasData",
    chain: readChain(query),
    preferred: readProvider(query),
    params: {},
    run: async (selected) => {
      const getGasData = requireOperation(selected, "gasData", "getGasData");
      return { gas: await getGasData(selected.chain) };
    },
  });
});
