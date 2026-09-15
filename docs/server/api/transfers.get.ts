import { resolveAddresses } from "@agntn/explorers";
import { isIdentifier } from "#shared/identifier";
import type { TransfersAnswer } from "#shared/wire";

/** A page of `getTokenTransfers()`, optionally for one token contract, at most `LIMITS.limit` rows. */
export default defineEventHandler((event): Promise<TransfersAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  const token = readString(query, "token", LIMITS.address);
  if (token !== undefined && !isIdentifier(token)) {
    throw createError({ statusCode: 400, statusMessage: "token must be a contract address" });
  }
  const limit = readInt(query, "limit", 1, LIMITS.limit) ?? LIMITS.limit;
  const page = readInt(query, "page", 1, LIMITS.page) ?? 1;
  return cachedRead(event, {
    prefix: "transfers",
    ttl: TTL.transfers,
    capability: "tokenTransfers",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input, token, limit, page },
    run: async (selected) => {
      const getTokenTransfers = requireOperation(selected, "tokenTransfers", "getTokenTransfers");
      const [address = input] = await resolveAddresses(input, selected.chain);
      const transfers = await getTokenTransfers(address, selected.chain, { limit, page, token });
      return { input, address, token: token ?? null, limit, page, items: transfers.slice(0, limit) };
    },
  });
});
