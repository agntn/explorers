import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { DCRDATA_INSIGHT_URL } from "../core/endpoints.js";
import { ExplorerError, UnsupportedChainError, UnsupportedOperationError } from "../core/errors.js";
import { formatWei } from "../core/types.js";
import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";

function assertChain(chain: ChainKey): void {
  if (chain !== "decred") throw new UnsupportedChainError(chain, Dcrdata.key);
}

function assertAddress(address: string): void {
  try {
    getChain("decred").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Decred mainnet address", Dcrdata.key);
  }
}

/** Decred balances from dcrdata's Insight API. Other operations are not implemented. */
export class Dcrdata extends Provider {
  static readonly key = "dcrdata";
  private readonly base: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.base = normalizeBaseUrl(config.baseUrl ?? DCRDATA_INSIGHT_URL);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: false,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  /**
   * Includes the mempool delta. Received and spent totals cover confirmed activity.
   * @param {string} address - Decred mainnet address.
   * @param {ChainKey} chain - Must be Decred.
   * @returns {Promise<Balance>} Amounts in atoms, with no block snapshot from Insight.
   */
  async getBalance(address: string, chain: ChainKey = "decred"): Promise<Balance> {
    assertChain(chain);
    assertAddress(address);
    const raw = await this.getJSON<unknown>(`${this.base}/addr/${address}?noTxList=1`);
    const atoms = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)]);
    const signedAtoms = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/)]);
    const parsed = z
      .object({
        addrStr: z.literal(address),
        balanceSat: atoms,
        totalReceivedSat: atoms,
        totalSentSat: atoms,
        unconfirmedBalanceSat: signedAtoms,
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid dcrdata balance response", this.name);
    const data = parsed.data;
    const balance = (BigInt(data.balanceSat) + BigInt(data.unconfirmedBalanceSat)).toString();
    return this.snapshotBalance({
      address,
      chain,
      balance,
      balanceFormatted: formatWei(balance, 8),
      funded: String(data.totalReceivedSat),
      spent: String(data.totalSentSat),
      symbol: "DCR",
    });
  }

  async getTxHistory(
    _address: string,
    chain: ChainKey = "decred",
    _options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    throw new UnsupportedOperationError("getTxHistory", this.name);
  }
}
