import type { BlockAnswer } from "#shared/wire";

/** `getBlockInfo()` for one block number. */
export default defineEventHandler((event): Promise<BlockAnswer> => {
  const query = getQuery(event);
  const number = readInt(query, "number", 0, LIMITS.block);
  if (number === undefined) {
    throw createError({ statusCode: 400, statusMessage: "number is required" });
  }
  return cachedRead(event, {
    prefix: "block",
    ttl: TTL.block,
    capability: "blockInfo",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { number },
    run: async (selected) => {
      const getBlockInfo = requireOperation(selected, "blockInfo", "getBlockInfo");
      return { number, block: await getBlockInfo(number, selected.chain) };
    },
  });
});
