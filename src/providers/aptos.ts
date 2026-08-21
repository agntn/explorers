/**
 * Aptos provider — explicit unsupported explorer contract.
 *
 * Aptos Explorer does not publish a documented account-history API. Direct fullnode REST is
 * deliberately not used: unsupported operations fail clearly.
 */

import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { UnsupportedChainError, UnsupportedOperationError } from "../core/errors.js";
import { register } from "../core/registry.js";

class Aptos extends Provider {
  static readonly key = "aptos";

  get capabilities(): ProviderCapabilities {
    return {
      balances: false,
      txHistory: false,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: false,
    };
  }

  async getBalance(_address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, this.name);
    throw new UnsupportedOperationError("getBalance", this.name);
  }

  async getTxHistory(
    _address: string,
    chain?: ChainKey,
    _options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, this.name);
    throw new UnsupportedOperationError("getTxHistory", this.name);
  }
}

register(Aptos);
