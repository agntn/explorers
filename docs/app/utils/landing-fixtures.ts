/**
 * Landing samples recorded through the library by scripts/record-fixtures.mjs.
 * Generated on 2026-09-05T17:24:46.831Z. Do not edit by hand; run `pnpm fixtures`.
 */
import type { Balance, GasData, TokenTransfer, Transaction } from "@agntn/explorers";

export type SampleTransaction = Omit<Transaction, "raw" | "tokenTransfers"> & {
  tokenTransfers: Omit<TokenTransfer, "txHash">[];
};

export interface ExplorerSample {
  chain: string;
  /** What was typed: an ENS name or an address. */
  input: string;
  /** The address the read went to, after ENS resolution. */
  address: string;
  provider: string;
  balance: Balance;
  history: SampleTransaction[];
  gas: GasData | null;
  /** False for the recorded sample, true once the worker's answer replaced it. */
  live: boolean;
}

export const LANDING_SAMPLES: readonly ExplorerSample[] = [
  {
    "chain": "ethereum",
    "input": "vitalik.eth",
    "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "provider": "blockscout",
    "balance": {
      "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "chain": "ethereum",
      "balance": "6712150161831460931",
      "balanceFormatted": "6.712150161831460931",
      "symbol": "ETH",
      "fetchedAt": "2026-09-05T17:24:43.491Z",
      "blockNumber": null,
      "blockHash": null
    },
    "history": [
      {
        "hash": "0x18fbf4798992552d03c80a474f2c5b42dfe67a1bbfcba6cacec93268f083cbab",
        "blockNumber": 25882055,
        "timestamp": "2026-09-01T11:12:59.000000Z",
        "from": "0xFD8d904767176d9F2FEB7305E4714dc89758dC48",
        "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "value": "0",
        "valueFormatted": "0",
        "gasUsed": "30880",
        "gasPrice": "143361614",
        "fee": "4427006640320",
        "status": "success",
        "functionName": "0x4f414d20",
        "isContractInteraction": true,
        "tokenTransfers": []
      },
      {
        "hash": "0xc26d92ef86e1c36c23e01d07a6e043d2987778bd0f9c7f5ab85345408395a01b",
        "blockNumber": 25881912,
        "timestamp": "2026-09-01T10:44:23.000000Z",
        "from": "0xFD8d904767176d9F2FEB7305E4714dc89758dC48",
        "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "value": "0",
        "valueFormatted": "0",
        "gasUsed": "23980",
        "gasPrice": "131370305",
        "fee": "3150259913900",
        "status": "success",
        "functionName": "0x4f414d50",
        "isContractInteraction": true,
        "tokenTransfers": []
      },
      {
        "hash": "0x9e614e2ccc3d8e9829261eb53b0a99e32f19390041889f65c9e7cb9d1d41fab8",
        "blockNumber": 25834334,
        "timestamp": "2026-08-25T19:34:47.000000Z",
        "from": "0x899Ac98d90CD60Eda9aF2b4690307Db784D03871",
        "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "value": "66600000000000",
        "valueFormatted": "0.0000666",
        "gasUsed": "21062",
        "gasPrice": "2097425912",
        "fee": "44175984558544",
        "status": "success",
        "isContractInteraction": true,
        "tokenTransfers": []
      },
      {
        "hash": "0x2a6b0fd28b548a4843a2c7ae0ed8e9c6fe263d5498f8dcfae8f7c380429437ba",
        "blockNumber": 25830440,
        "timestamp": "2026-08-25T06:32:23.000000Z",
        "from": "0xb8aEccC3ab76a0a1FB807244205B1E3f88C86B89",
        "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "value": "409321084501238",
        "valueFormatted": "0.000409321084501238",
        "gasUsed": "21062",
        "gasPrice": "1105688411",
        "fee": "23288009312482",
        "status": "success",
        "isContractInteraction": true,
        "tokenTransfers": []
      },
      {
        "hash": "0xff3d62e0f231a98db040a34b85f23752c0b66fdb4b815bdfb65fcd28e81abc1b",
        "blockNumber": 25823663,
        "timestamp": "2026-08-24T07:53:11.000000Z",
        "from": "0xb8aEccC3ab76a0a1FB807244205B1E3f88C86B89",
        "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "value": "409321084501238",
        "valueFormatted": "0.000409321084501238",
        "gasUsed": "21062",
        "gasPrice": "1042101375",
        "fee": "21948739160250",
        "status": "success",
        "isContractInteraction": true,
        "tokenTransfers": []
      }
    ],
    "gas": {
      "chain": "ethereum",
      "unit": "gwei",
      "safeGasPrice": "0.25",
      "proposedGasPrice": "0.66",
      "fastGasPrice": "2.47"
    },
    "live": false
  },
  {
    "chain": "bitcoin",
    "input": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "provider": "mempool",
    "balance": {
      "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      "chain": "bitcoin",
      "balance": "5743286310",
      "balanceFormatted": "57.4328631",
      "funded": "5743286310",
      "spent": "0",
      "symbol": "BTC",
      "fetchedAt": "2026-09-05T17:24:44.787Z",
      "blockNumber": null,
      "blockHash": null
    },
    "history": [
      {
        "hash": "c99e446ab2d43e999de5708e62a8384f187f8015cc6d188af2a23e8d313b39a4",
        "blockNumber": 0,
        "from": "14skjJCMJ7R2YgeyENTnAFnxPcQdswkAtH",
        "to": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "value": "3672",
        "valueFormatted": "0.00003672",
        "fee": "20",
        "status": "pending",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "fc99f992ded3ee2dda7fc59184d6e3d7acbd1b453360361ecb9c23e5034e1dfe",
        "blockNumber": 965625,
        "timestamp": "2026-09-05T14:41:30.000Z",
        "from": "bc1pcv0utyu5n8ynxajrsraycc9d69j652mlh7akqjt50207fn6449kss5h364",
        "to": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "value": "546",
        "valueFormatted": "0.00000546",
        "fee": "406",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "cf55a48ce92a576238ef6e7b74320469d6998802401f8e7ab476714f625e998e",
        "blockNumber": 965621,
        "timestamp": "2026-09-05T13:38:09.000Z",
        "from": "bc1ppyyv2r4nz8gckls7mhjdgsmze24gfdd4d38hglfp0r7f3re63pnsgugtqm",
        "to": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "value": "546",
        "valueFormatted": "0.00000546",
        "fee": "203",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "3b7ab762a09f5de4a71718b98524e909aa10160898d39d96e194e69611001d50",
        "blockNumber": 965620,
        "timestamp": "2026-09-05T13:34:54.000Z",
        "from": "bc1p2k36ls57fm9rejxyujym43xzpwfxk8yud9w8t4dh072wv5h0eqwsxpm4q7",
        "to": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "value": "546",
        "valueFormatted": "0.00000546",
        "fee": "406",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "9e1d2f91aeb32fedaa10c35915ba142dcd832662c9e717417c999da6e9385b69",
        "blockNumber": 965598,
        "timestamp": "2026-09-05T10:36:00.000Z",
        "from": "bc1pywdad8zlslxvphlaqyflal4fsxlavd576rrc824l7nxr0tgxx76sl0r4l3",
        "to": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "value": "546",
        "valueFormatted": "0.00000546",
        "fee": "203",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      }
    ],
    "gas": {
      "chain": "bitcoin",
      "unit": "sat/vB",
      "safeGasPrice": "1",
      "proposedGasPrice": "1",
      "fastGasPrice": "2",
      "priorityFee": "1"
    },
    "live": false
  },
  {
    "chain": "arweave",
    "input": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
    "address": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
    "provider": "arweave",
    "balance": {
      "address": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
      "chain": "arweave",
      "fetchedAt": "2026-09-05T17:24:46.105Z",
      "blockNumber": null,
      "blockHash": null,
      "balance": "1048593667750437",
      "balanceFormatted": "1048.593667750437",
      "symbol": "AR"
    },
    "history": [
      {
        "hash": "2gui6mcjOmFY0THJ_Ve2EBsmvX3jF6qa4-H3QUg6n_8",
        "from": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
        "to": "",
        "value": "0",
        "valueFormatted": "0",
        "fee": "3252562619",
        "blockNumber": 1994812,
        "timestamp": "2026-09-05T17:23:33.000Z",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "ml5xJOCv7GmWzz8SaSbjbUt6ng8tRMMvGJ7gUpZUuM8",
        "from": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
        "to": "",
        "value": "0",
        "valueFormatted": "0",
        "fee": "3252562619",
        "blockNumber": 1994812,
        "timestamp": "2026-09-05T17:23:33.000Z",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "-hDlQK90MMeYDtFtxaqiPJC8kxmevXDdW15siZs7N3Q",
        "from": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
        "to": "",
        "value": "0",
        "valueFormatted": "0",
        "fee": "157486940923",
        "blockNumber": 1994811,
        "timestamp": "2026-09-05T17:21:47.000Z",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "031X3nxbCGwelhsfBiYbhFDucSpRANQLsUt0xx3Hb_s",
        "from": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
        "to": "",
        "value": "0",
        "valueFormatted": "0",
        "fee": "3252562619",
        "blockNumber": 1994811,
        "timestamp": "2026-09-05T17:21:47.000Z",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      },
      {
        "hash": "19YV33f_TRaHGlDUpu1VGQaaJXVyKU268CiVI3Nsqv4",
        "from": "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw",
        "to": "",
        "value": "0",
        "valueFormatted": "0",
        "fee": "54664022054",
        "blockNumber": 1994811,
        "timestamp": "2026-09-05T17:21:47.000Z",
        "status": "success",
        "isContractInteraction": false,
        "tokenTransfers": []
      }
    ],
    "gas": null,
    "live": false
  }
];
