/** Get contract info (supports ENS) */
import { defineCommand } from "citty";
import type { ContractInfo } from "../core/types.js";
import { failCommand, print, reportCommandError, withSelectedProvider } from "./shared.js";

function renderContract(providerName: string, info: Readonly<ContractInfo>): void {
  print(`[${providerName}] Contract ${info.address}`);
  print(`  Verified: ${info.isVerified}`);
  if (info.name) print(`  Name: ${info.name}`);
  if (info.compilerVersion) print(`  Compiler: ${info.compilerVersion}`);
  if (info.isProxy) print(`  Proxy → ${info.implementationAddress}`);
  if (info.isToken) print(`  Token standard: ${info.tokenStandard ?? "ERC-20 (inferred)"}`);
  if (info.creator) print(`  Creator: ${info.creator}`);
}

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
      const { resolveInput } = await import("../core/input.js");
      await withSelectedProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
        "contractInfo",
        async (selected) => {
          const getContractInfo = selected.provider.getContractInfo?.bind(selected.provider);
          if (!selected.provider.capabilities.contractInfo || !getContractInfo) {
            failCommand(`Provider "${selected.name}" does not support contract info`);
          }
          const { address } = await resolveInput(args.address as string, selected.chain);
          const info = await getContractInfo(address, selected.chain);
          renderContract(selected.name, info);
        },
        args.address as string,
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
