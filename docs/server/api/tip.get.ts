import type { TipAnswer } from "#shared/wire";

/** The tip of one chain: height, stats, latest blocks and transactions, from the chain's public explorer API. */
export default defineEventHandler(async (event) => {
  const chain = readChainOrDefault(getQuery(event));
  try {
    return await cachedAnswer<TipAnswer>(event, "tip", { chain }, TTL.tip, () => readTip(chain));
  } catch (error) {
    return toHttpError(error);
  }
});
