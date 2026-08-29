/** Get contract info (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveInput } from "../core/input.js";
import type { ContractInfo } from "../core/types.js";
import { failCommand, reportCommandError, selectProvider } from "./shared.js";

function renderContract(providerName: string, info: Readonly<ContractInfo>): void {
  consola.log(`[${providerName}] Contract ${info.address}`);
  consola.log(`  Verified: ${info.isVerified}`);
  if (info.name) consola.log(`  Name: ${info.name}`);
  if (info.compilerVersion) consola.log(`  Compiler: ${info.compilerVersion}`);
  if (info.isProxy) consola.log(`  Proxy → ${info.implementationAddress}`);
  if (info.isToken) consola.log(`  Token standard: ${info.tokenStandard ?? "ERC-20 (inferred)"}`);
  if (info.creator) consola.log(`  Creator: ${info.creator}`);
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
      const selected = await selectProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
      );
      const getContractInfo = selected.provider.getContractInfo?.bind(selected.provider);
      if (!selected.provider.capabilities.contractInfo || !getContractInfo) {
        failCommand(`Provider "${selected.name}" does not support contract info`);
      }
      const { address } = await resolveInput(args.address as string, selected.chain);
      const info = await getContractInfo(address, selected.chain);
      renderContract(selected.name, info);
    } catch (error) {
      reportCommandError(error);
    }
  },
});
