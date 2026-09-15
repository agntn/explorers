import { resolveAddresses } from "@agntn/explorers";
import type { TokensAnswer } from "#shared/wire";

/** `getTokenBalances()` with `nonZeroOnly`, cut to `LIMITS.tokens` rows; `total` says how many there were. */
export default defineEventHandler((event): Promise<TokensAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  return cachedRead(event, {
    prefix: "tokens",
    ttl: TTL.tokens,
    capability: "tokenBalances",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input },
    run: async (selected) => {
      const getTokenBalances = requireOperation(selected, "tokenBalances", "getTokenBalances");
      const [address = input] = await resolveAddresses(input, selected.chain);
      const tokens = await getTokenBalances(address, selected.chain, { nonZeroOnly: true });
      return { input, total: tokens.length, items: tokens.slice(0, LIMITS.tokens) };
    },
  });
});
