import { resolveAddresses } from "@agntn/explorers";
import type { ContractAnswer } from "#shared/wire";

/** `getContractInfo()` with the ABI and the source measured instead of shipped. */
export default defineEventHandler((event): Promise<ContractAnswer> => {
  const query = getQuery(event);
  const input = readIdentifier(query, "address");
  return cachedRead(event, {
    prefix: "contract",
    ttl: TTL.contract,
    capability: "contractInfo",
    chain: readChain(query),
    preferred: readProvider(query),
    params: { input },
    run: async (selected) => {
      const getContractInfo = requireOperation(selected, "contractInfo", "getContractInfo");
      const [address = input] = await resolveAddresses(input, selected.chain);
      return { input, contract: slimContract(await getContractInfo(address, selected.chain)) };
    },
  });
});
