/** Get contract info (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";
import { resolveInput } from "../core/input.js";

export default defineCommand({
  meta: {
    name: "contract",
    description: "Get smart contract info (supports ENS)",
  },
  args: {
    address: {
      type: "positional",
      description: "Contract address or ENS name",
      required: true,
    },
    chain: {
      type: "string",
      alias: "c",
      description: "Chain",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider",
    },
  },
  async run({ args }) {
    try {
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const providerName = resolveProvider(args.provider as string | undefined, requestedChain);
      const provider = await create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);
      if (!provider.capabilities.contractInfo || !provider.getContractInfo) {
        consola.error(`Provider "${providerName}" does not support contract info`);
        process.exit(1);
      }
      const { address } = await resolveInput(args.address as string, chain);
      const info = await provider.getContractInfo(address, chain);
      consola.log(`[${providerName}] Contract ${info.address}`);
      consola.log(`  Verified: ${info.isVerified}`);
      if (info.name) consola.log(`  Name: ${info.name}`);
      if (info.compilerVersion) consola.log(`  Compiler: ${info.compilerVersion}`);
      if (info.isProxy) consola.log(`  Proxy → ${info.implementationAddress}`);
      if (info.isToken)
        consola.log(`  Token standard: ${info.tokenStandard ?? "ERC-20 (inferred)"}`);
      if (info.creator) consola.log(`  Creator: ${info.creator}`);
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
