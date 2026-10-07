# @agntn/explorers

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/explorers)](https://npmx.dev/package/@agntn/explorers)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/explorers)](https://npmx.dev/package/@agntn/explorers)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/explorers)](https://npmx.dev/package/@agntn/explorers)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/explorers)

🔭 Nineteen block explorers, 30 chains, one shape. You ask for a balance, you get a balance. Same object on Ethereum, Bitcoin, Solana, Cardano or Stellar, from your terminal, your TypeScript or your agent, and nobody has to know what Insight is.

## Why?

Block explorers all have the same data and every one of them has its own idea of how to give it to you. This one wants an API key. That one wants the address in a POST body. Another one answers a balance question with 222 kB of UTxOs, thanks. Now put that into an agent and watch the model try to remember which is which. It won't. Neither do I, honestly.

So this is one `Provider` contract in front of all of them. Same shape everywhere, and amounts never touch a JavaScript number, because you really don't want to find out what `Number` does to wei.

Docs and a live explorer: [explorers.agntn.dev](https://explorers.agntn.dev).

## ✨ Features

- 🧩 **Nineteen backends, one contract.** Etherscan, Blockscout, Blockchair, Mempool, Blockstream, Solscan, Helius, TONAPI, TRONSCAN, Aptos, Blockberry, Koios, Arweave, dcrdata, Horizon, WhatsOnChain, Blockbook, Haskoin and eCash Explorer, and from your side they all look the same.
- ⛓️ **30 chains.** Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Gnosis, Linea, Berachain, zkSync, Scroll, Bitcoin, Bitcoin Cash, Bitcoin SV, Bitcoin Gold, Litecoin, Dogecoin, Pepecoin, eCash, Zcash, Solana, TON, TRON, Aptos, Sui, Cardano, Arweave, Decred and Stellar.
- 🔢 **Amounts stay exact.** Strings in the smallest unit. Your 0.1 ETH is `100000000000000000` and it stays that way.
- 🖥️ **CLI, library, MCP, Pi and OMP.** Whatever you're holding, same commands, same objects.
- 🏷️ **ENS just works.** `vitalik.eth` wherever an Ethereum address would go, no extra dependency.
- 🎯 **Picks a provider for you and tells you which.** Keys first, keyless next, Blockscout when nobody else wants the chain. `-p` if you know better.
- 📦 **Loads only what you use.** One bundle per provider, `create()` pulls in exactly one.
- 💸 **Bitcoin gets treated like Bitcoin.** Pending activity in `unconfirmed`, the spendable set from `getUtxos()`, OP_RETURN and inscriptions decoded when they're text. And `getPubkey()` finds the key a spend already gave away.

## 📦 Install

```bash
pnpm add @agntn/explorers
```

Node.js 24 or newer.

## 🚀 First call

```bash
npx @agntn/explorers vitalik.eth
```

```
[blockscout] ethereum balance for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  6.712597953701629485 ETH
  Raw: 6712597953701629485 base units
  Fetched: 2026-09-15T12:42:41.628Z
  Block: unknown
```

No key, no config, no subcommand. Give it something that looks like an address and it's a `balance`, give it nothing and you get `providers`, give it `vitalik.eth` and it resolves the name first. Without keys it goes to Blockscout. Drop an `ETHERSCAN_API_KEY` in your env and the exact same command goes to Etherscan, or `-p` if you'd rather pick yourself. How it decides: [Provider selection](https://explorers.agntn.dev/guide/selection).

`balance` takes as many addresses as you throw at it. Vitalik and the zero address, where ETH goes to die:

```bash
explorers balance vitalik.eth 0x0000000000000000000000000000000000000000
```

```
[blockscout] ethereum balance for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  6.712597953701629485 ETH
  Raw: 6712597953701629485 base units
  Fetched: 2026-09-15T12:43:23.629Z
  Block: unknown
[blockscout] ethereum balance for 0x0000000000000000000000000000000000000000
  14149.803103387147250366 ETH
  Raw: 14149803103387147250366 base units
  Fetched: 2026-09-15T12:43:23.494Z
  Block: unknown
```

The graveyard is doing better than most of us ;)

A few more, same rules:

```bash
explorers tx vitalik.eth -n 5
explorers balance bc1qjvm9jkrjw9uvsn8905dwa6eau0guyc9laau03a -c btc
explorers utxos bc1qjvm9jkrjw9uvsn8905dwa6eau0guyc9laau03a -c btc
explorers pubkey 1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
explorers tokens vitalik.eth
explorers gas -c base
explorers block 1000 -c dcr
explorers providers
```

How does `tx` know if you gave it a hash or an address? It looks at the shape. When the shape lies, like on Arweave where addresses and transaction IDs look identical, `-m history` or `-m detail` settles it.

Anything from the Bitcoin family comes with its OP_RETURN decoded, hex always, text when it's actually text. The one every tutorial quotes:

```bash
explorers tx 8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684 -c btc
```

```
[mempool] Tx 8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684
  Block: 308570
  From: 1HnhWpkMHMjgt167kvgcPyurMmsCQ2WPgg
  To: 1HnhWpkMHMjgt167kvgcPyurMmsCQ2WPgg
  Value: 0.002
  Status: success
  Fee: 20000 base units
  OP_RETURN: charley loves heidi
```

Ordinals inscriptions show up too, on one transaction from Mempool or Blockstream. They're read straight from the witness. No indexer, no inscription numbers, just the bytes.

And does an address still hide its public key? The one that paid 10,000 BTC for two pizzas doesn't:

```bash
explorers pubkey 1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
```

```
[mempool] 1XPTgDRhN8RFnzniWCddobD9iKZatrvH4 on bitcoin
  Pubkey: 0434417dd8d89deaf0f6481c2c160d6de0921624ef7b956f38eef9ed4a64e36877be84b77cdee5a8d92b7d93694f89c3011bf1cbdf4fd7d8ca13b58a7bb4ab0804
  Shown by spend: fefde2ee3cbaa812134c7b575ac06e372c839dc95622c3967e8142922dd3912b
```

Every spend from a P2PKH or P2WPKH address leaves its key on chain, and a taproot address is its key. No key on chain, no Kangaroo. Worth knowing before the GPU fans spin up.

### Commands

| Command     | What it does                                                                           | Example                           |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------- |
| `balance`   | Native balance, several addresses at once                                              | `explorers balance vitalik.eth`   |
| `tx`        | Transaction history or one transaction                                                 | `explorers tx vitalik.eth -n 5`   |
| `utxos`     | Unspent outputs on Bitcoin, Bitcoin Cash, Bitcoin SV, Bitcoin Gold, Litecoin, Pepecoin | `explorers utxos bc1q... -c btc`  |
| `pubkey`    | Whether an address has shown its public key, on Bitcoin, Litecoin, Pepecoin            | `explorers pubkey 1XPTgDRhN8...`  |
| `contract`  | ABI, source and verification status                                                    | `explorers contract 0x1f984...`   |
| `tokens`    | ERC-20, SPL and Cardano native holdings                                                | `explorers tokens vitalik.eth`    |
| `transfers` | ERC-20 transfer history for an address                                                 | `explorers transfers vitalik.eth` |
| `gas`       | Current gas prices                                                                     | `explorers gas -c base`           |
| `block`     | Block data by number                                                                   | `explorers block 18000000`        |
| `providers` | Registered providers and their capabilities                                            | `explorers providers`             |
| `mcp`       | The MCP server on stdio                                                                | `explorers mcp`                   |

Every command takes `-c` for the chain and `-p` for the provider. `tx`, `transfers`, `tokens` and `utxos` take `-n`, `transfers` takes `-t` if you only care about one token. Everything else: [CLI guide](https://explorers.agntn.dev/guide/cli).

## 🧠 Library

```typescript
import { create, formatWei, resolveEns, resolveProvider } from "@agntn/explorers";

const address = await resolveEns("vitalik.eth");
if (!address) throw new Error("no such name");

const provider = await create(resolveProvider(undefined, "ethereum"));
const balance = await provider.getBalance(address, "ethereum");
const history = await provider.getTxHistory(address, "ethereum", { limit: 10 });

console.log(formatWei(balance.balance), balance.symbol); // 6.712597953701629485 ETH
console.log(history.map((transaction) => transaction.hash));
```

That's most of it, really. `create()` loads one provider and nothing else. `withProvider()` picks one for you and, after that backend has already waited out its 429s, retries once on another provider. And if you already know you want Mempool, `import { Mempool } from "@agntn/explorers/providers/mempool"` and skip the registry. Amounts come back as strings, `formatWei()` makes them readable again. Errors are one hierarchy, and the API key is scrubbed from the URL before it lands in your logs. The details and the gotchas: [Provider selection](https://explorers.agntn.dev/guide/selection), [Balances](https://explorers.agntn.dev/guide/balances), [Transactions](https://explorers.agntn.dev/guide/transactions), [Errors](https://explorers.agntn.dev/guide/errors).

## 🗺️ Providers

| Provider         | Auth                            | Chains                                                                                | Capabilities                                                             |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **etherscan**    | `ETHERSCAN_API_KEY`             | ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, linea, berachain | balances, tx, transfers, contract, tokens, gas, block                    |
| **blockscout**   | None                            | ethereum, base, arbitrum, optimism, polygon, gnosis, linea, scroll, zksync, avalanche | balances, tx, transfers, contract, tokens, gas, block                    |
| **blockchair**   | Optional `BLOCKCHAIR_API_KEY`   | bitcoin, bitcoincash, litecoin, dogecoin, ethereum, ecash, zcash                      | balances, tx, block                                                      |
| **mempool**      | None                            | bitcoin, litecoin, pepecoin                                                           | balances, tx, utxos, pubkey, gas and block, the last two not on Pepecoin |
| **blockstream**  | None                            | bitcoin                                                                               | balances, tx detail/history, utxos, pubkey, block                        |
| **solscan**      | `SOLSCAN_API_KEY`               | solana                                                                                | balances, tx detail/history, block                                       |
| **helius**       | `HELIUS_API_KEY`                | solana                                                                                | tx detail/history, tokens                                                |
| **ton**          | None                            | ton                                                                                   | balances, tx                                                             |
| **tronscan**     | `TRONSCAN_API_KEY`              | tron                                                                                  | balances, tx detail/history, block                                       |
| **aptos**        | None                            | aptos                                                                                 | no supported explorer operations                                         |
| **blockberry**   | `BLOCKBERRY_API_KEY`            | sui                                                                                   | balances, tx history                                                     |
| **koios**        | None                            | cardano                                                                               | balances, tx detail/history, tokens                                      |
| **arweave**      | None                            | arweave                                                                               | balances, tx detail/history, block                                       |
| **dcrdata**      | None                            | decred                                                                                | balances, tx detail/history, block                                       |
| **horizon**      | None                            | stellar                                                                               | balances, tx detail/history, transfers, tokens, gas, block               |
| **whatsonchain** | Optional `WHATSONCHAIN_API_KEY` | bitcoinsv                                                                             | balances, tx detail/history, utxos, block                                |
| **blockbook**    | None                            | bitcoingold                                                                           | balances, tx detail/history, utxos, block                                |
| **haskoin**      | None                            | bitcoincash                                                                           | balances, tx detail/history, utxos, block                                |
| **ecash**        | None                            | ecash                                                                                 | tx history, block                                                        |

Aptos is in the table so you don't ask why it's not in the table. Aptos Explorer has no documented account or history API, so it's registered, does nothing and throws `UnsupportedOperationError` if you insist. Bitcoin SV kept Bitcoin's `1...` addresses, so one of those still reads as Bitcoin until you say `-c bsv` or `-p whatsonchain`. eCash Explorer serves its balance only as HTML, so eCash balances still go to Blockchair, while history no longer burns a Blockchair request per transaction. The rest, with their quirks: [Providers](https://explorers.agntn.dev/providers).

## 🤖 Agents

```bash
explorers mcp
pi install npm:@agntn/explorers
omp install @agntn/explorers
```

```json
{
  "mcpServers": {
    "explorers": { "command": "npx", "args": ["-y", "@agntn/explorers", "mcp"] }
  }
}
```

Eleven read-only tools, `explorers_balance` through `explorers_providers`, the same eleven on all three. Got your own transport? `createMcpServer()` lives in `@agntn/explorers/mcp`. The heavy stuff, `raw` records and contract ABIs, stays out of the answer until a call asks for it. Your context window will thank you. [Agents guide](https://explorers.agntn.dev/guide/agents).

## 🚫 What this does not do

Nodes. No RPC, no `eth_call`, no fullnode anything, that's not this package. Also no keys, no signing, no broadcasting. [@agntn/keys](https://github.com/agntn/keys) holds the keys.

## 🧩 Adding a provider

Want a twentieth? A class extending `Provider` and an entry in `builtins`, and there's a test that notices when you skip one. The build finds the file on its own now, so that's one less line to forget. Walkthrough: [Custom providers](https://explorers.agntn.dev/guide/custom).

## 🛠️ Development

```bash
pnpm install
pnpm fmt         # vp lint --fix and vp fmt
pnpm lint
pnpm typecheck   # builds first, the OMP extension imports dist/
pnpm test:run
pnpm test:live    # public explorer roundtrips, not CI
pnpm build       # obuild, one file per provider
```

## 📄 License

[MIT](./LICENSE)
