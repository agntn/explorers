/** Vercel AI SDK tools over the same definitions MCP, Pi, OMP and the CLI read. */
import { toAiTools } from "@agntn/tools/ai";
import type { Tool } from "ai";
import { explorersTools } from "./tools.ts";

/** The name each explorer tool answers to, the same on every host. */
export type ExplorersToolName =
  | "explorers_providers"
  | "explorers_balance"
  | "explorers_tx_history"
  | "explorers_tx_detail"
  | "explorers_utxos"
  | "explorers_pubkey"
  | "explorers_contract"
  | "explorers_tokens"
  | "explorers_token_transfers"
  | "explorers_gas"
  | "explorers_block";

/**
 * Every explorer tool for the AI SDK, keyed by its MCP name. A fresh map per call, so trim it freely.
 *
 * @returns {Record<ExplorersToolName, Tool>} The AI SDK tools, providers first.
 */
export function explorersAiTools(): Record<ExplorersToolName, Tool> {
  return toAiTools(explorersTools()) as Record<ExplorersToolName, Tool>;
}
