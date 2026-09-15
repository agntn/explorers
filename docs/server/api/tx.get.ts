import { resolveAddresses } from "@agntn/explorers";
import type { HistoryAnswer } from "#shared/wire";

/** A page of `getTxHistory()`, `raw` dropped, at most `LIMITS.limit` rows. */
export default defineEventHandler((event): Promise<HistoryAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  const limit = readInt(query, "limit", 1, LIMITS.limit) ?? LIMITS.limit;
  const page = readInt(query, "page", 1, LIMITS.page) ?? 1;
  return cachedRead(event, {
    prefix: "history",
    ttl: TTL.history,
    capability: "txHistory",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input, limit, page },
    run: async (selected) => {
      const [address = input] = await resolveAddresses(input, selected.chain);
      const transactions = await selected.provider.getTxHistory(address, selected.chain, {
        limit,
        page,
      });
      return {
        input,
        address,
        limit,
        page,
        paged: pagesHistory(selected.name),
        items: transactions.slice(0, limit).map(slimTransaction),
      };
    },
  });
});
