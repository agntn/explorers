import type { DetailAnswer } from "#shared/wire";

/** One `Transaction` as `getTxDetail()` returns it, `raw` dropped. */
export default defineEventHandler((event): Promise<DetailAnswer> => {
  const query = getQuery(event);
  const hash = readIdentifier(query, "hash");
  return cachedRead(event, {
    prefix: "detail",
    ttl: TTL.detail,
    capability: "txDetail",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { hash },
    run: async (selected) => {
      const getTxDetail = requireOperation(selected, "txDetail", "getTxDetail");
      return { hash, transaction: slimTransaction(await getTxDetail(hash, selected.chain)) };
    },
  });
});
