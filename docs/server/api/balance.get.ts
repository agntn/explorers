import { resolveAddresses } from "@agntn/explorers";
import type { BalanceAnswer } from "#shared/wire";

/** One `Balance` as `getBalance()` returns it, after ENS resolution, plus which provider answered. */
export default defineEventHandler((event): Promise<BalanceAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  return cachedRead(event, {
    prefix: "balance",
    ttl: TTL.balance,
    capability: "balances",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input },
    run: async (selected) => {
      const [address = input] = await resolveAddresses(input, selected.chain);
      return { input, balance: await selected.provider.getBalance(address, selected.chain) };
    },
  });
});
