/**
 * Chains the worker can show a live feed for, in the order the hub lists them. The host tables in
 * `server/utils/tip.ts` cover exactly these keys; a chain added there goes here too.
 */
export const TIP_CHAINS = [
  "ethereum",
  "bitcoin",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "gnosis",
  "linea",
  "scroll",
  "zksync",
  "avalanche",
  "litecoin",
  "pepecoin",
  "arweave",
] as const;

export type TipChain = (typeof TIP_CHAINS)[number];

export function hasTip(chain: string): chain is TipChain {
  return (TIP_CHAINS as readonly string[]).includes(chain);
}
