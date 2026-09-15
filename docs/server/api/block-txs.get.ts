import type { BlockTransactionsAnswer } from "#shared/wire";

/** The transactions inside one block, first 25, where the chain's explorer lists them. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const number = readInt(query, "number", 0, LIMITS.block);
  if (number === undefined) {
    throw createError({ statusCode: 400, statusMessage: "number is required" });
  }
  const chain = readChainOrDefault(query);
  try {
    return await cachedAnswer<BlockTransactionsAnswer>(
      event,
      "block-txs",
      { chain, number },
      TTL.blockTxs,
      () => readBlockTransactions(chain, number),
    );
  } catch (error) {
    return toHttpError(error);
  }
});
