import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ExplorerError,
  NotFoundError,
  RateLimitError,
  UnsupportedChainError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { BlockCypher } from "../../src/providers/blockcypher.ts";

const BASE = "https://api.blockcypher.com/v1";

/* Mainnet responses from api.blockcypher.com, trimmed to the fields the provider reads. */
const BALANCE = {
  address: "LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg",
  total_received: 219945536418,
  total_sent: 219945536418,
  balance: 0,
  unconfirmed_balance: 0,
  final_balance: 0,
  n_tx: 2910,
  unconfirmed_n_tx: 0,
  final_n_tx: 2910,
};

const DOGE_BALANCE = {
  address: "DR7EKP5k7x29XWPwSPFtyJNVzuBRHhqcZh",
  total_received: 950419229744,
  total_sent: 932743300000,
  balance: 17675929744,
  unconfirmed_balance: 0,
  final_balance: 17675929744,
  n_tx: 23,
  unconfirmed_n_tx: 0,
  final_n_tx: 23,
};

/* Block 2500000's second transaction: LPo6… pays LMnD… from a single input. */
const TX = {
  block_hash: "4b5b45ab5b7bde1a746f2bd5003285d6e901b0b2f69dcfd3d3958d8226c8bf8d",
  block_height: 2500000,
  hash: "b1683b756314cabb7e4496e1f5a050b5693d321e4ecd1e7c91eb4648197ebf79",
  fees: 113000,
  confirmed: "2023-06-29T00:01:25Z",
  received: "2023-06-29T00:01:25Z",
  double_spend: false,
  vin_sz: 1,
  vout_sz: 1,
  inputs: [
    {
      prev_hash: "2149c1b39607b36bdbdc867840ece4250fd4e1efad48becea621b944e4ade09c",
      output_index: 0,
      output_value: 18665002,
      addresses: ["LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv"],
      script_type: "pay-to-pubkey-hash",
    },
  ],
  outputs: [
    {
      value: 18552002,
      script: "76a9141c0a43d8a53a7ac16adade9ab3593b6d22ae21e688ac",
      spent_by: "41f932f56e2ed53ceedb5ebaddbb440dd6053cc7078569b97ee552e05951a4e6",
      addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
      script_type: "pay-to-pubkey-hash",
    },
  ],
};

/* A Litecoin transaction still in the mempool, where BlockCypher writes height -1. */
const PENDING_TX = {
  block_height: -1,
  hash: "d2c56b8050926bd4d66a82dbbc060745fe5b076391937b2a677488267be7d340",
  fees: 678,
  received: "2026-11-14T15:20:42.501Z",
  double_spend: false,
  vin_sz: 1,
  vout_sz: 2,
  inputs: [
    {
      prev_hash: "967581bbc313fe968ae176d8d551d3f270d0f8b99f6a4838c08b6be0f66114af",
      output_index: 1,
      output_value: 8073221629,
      addresses: ["ltc1q9d35zprvlh078je965fkjsw7k8tukpmmsqxn82"],
      script_type: "pay-to-witness-pubkey-hash",
      witness: [
        "3044022079fba7acea23845e31b5bf09559cf39e17cf29acccd767263624f286540911b5022012a5ed9171aa2ec2eac1f5df4ae151f0d0a495bd06b0902f97074f1c24cb227501",
        "020007ad943f87e0f91d1eb635a5a70f244a34149228019afd639c338dc1923f6d",
      ],
    },
  ],
  outputs: [
    {
      value: 34184044,
      script: "0014299884c8a3734c8ed527429d2a338079260db4d3",
      addresses: ["ltc1q9xvgfj9rwdxga4f8g2wj5vuq0ynqmdxntgngem"],
      script_type: "pay-to-witness-pubkey-hash",
    },
    {
      value: 8039036907,
      script: "00142b6341046cfddfe3cb25d5136941deb1d7cb077b",
      addresses: ["ltc1q9d35zprvlh078je965fkjsw7k8tukpmmsqxn82"],
      script_type: "pay-to-witness-pubkey-hash",
    },
  ],
};

const BLOCK = {
  hash: "4b5b45ab5b7bde1a746f2bd5003285d6e901b0b2f69dcfd3d3958d8226c8bf8d",
  height: 2500000,
  chain: "LTC.main",
  total: 3320970177806,
  fees: 2997046,
  size: 151230,
  vsize: 96302,
  ver: 536870912,
  time: "2023-06-29T00:01:25Z",
  received_time: "2023-06-29T00:03:35.419Z",
  relayed_by: "188.63.158.192:9333",
  bits: 436249296,
  nonce: 1729419803,
  n_tx: 421,
  prev_block: "a056dfaf96c6fc705f4ae0036d27b445404bf83b2fadc75f9744d179049ef836",
  mrkl_root: "93c69d443ef9a0cff34c67808c2a23de6792a062fea93320c504fb69f964a34c",
  txids: ["fffbf4cf21ec5646a5510f40776ea6671ab30648d94108bfd0777d1eb4d58394"],
  depth: 713014,
  prev_block_url:
    "https://api.blockcypher.com/v1/ltc/main/blocks/a056dfaf96c6fc705f4ae0036d27b445404bf83b2fadc75f9744d179049ef836",
  tx_url: "https://api.blockcypher.com/v1/ltc/main/txs/",
};

/* LPo6… sends, receives, then sends again; the page says there is more. */
const HISTORY = {
  address: "LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv",
  total_received: 13729702777,
  total_sent: 13729702777,
  balance: 0,
  unconfirmed_balance: 0,
  final_balance: 0,
  n_tx: 473,
  unconfirmed_n_tx: 0,
  final_n_tx: 473,
  hasMore: true,
  txs: [
    {
      block_hash: "fecd21c24bcca41556b99000788871d6a2fce11fe4361d2dee4d59863e9705ee",
      block_height: 3083761,
      hash: "284712c3bdb4677b152f1b6d8ba051ecbe2a95f5162ec97acf8e544355e48495",
      fees: 6780,
      confirmed: "2026-04-03T22:20:33Z",
      received: "2026-04-03T22:18:43.141Z",
      double_spend: false,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "5aa930668a944b4fc7d11861b3ab5a7cee4e387afd1c0b3c7f6290f2a705d833",
          output_index: 3,
          output_value: 28296000,
          addresses: ["LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 28289220,
          script: "76a914077cd4462650502381647216b40126359be272e188ac",
          spent_by: "bd6c8b359d6d8e812d603c14ec1b1e4ca812a71ced5bf949cc024fa3b88c5e7e",
          addresses: ["LKuYXqhGxsfRYTER1y2iYBvnBhNM8PuaL9"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
    },
    {
      block_hash: "364272dd55b2044f5012c6b4e3ca96d31e0aa0e997617093dc8252bcac0508bd",
      block_height: 3065954,
      hash: "5aa930668a944b4fc7d11861b3ab5a7cee4e387afd1c0b3c7f6290f2a705d833",
      fees: 2600,
      confirmed: "2026-03-03T16:13:37Z",
      received: "2026-03-03T16:13:37Z",
      double_spend: false,
      vin_sz: 1,
      vout_sz: 5,
      inputs: [
        {
          prev_hash: "ed481da9ff6591cef3f06b1604ee803b7922e98d407c12504dd8d3ea7c362c25",
          output_index: 2,
          output_value: 3599011680,
          addresses: ["MDEJjRMcCqxR1FWc2HCLkfvuZhuvGLFnrx"],
          script_type: "pay-to-script-hash",
        },
      ],
      outputs: [
        {
          value: 59990000,
          script: "0014f897a4aa3f0c6e963b9c50dedc64972162fdd279",
          spent_by: "b862277122e06bd0a55210a6730f24f1c226077a72bdeed19d159296bdb4f430",
          addresses: ["ltc1qlzt6f23lp3hfvwuu2r0dceyhy930m5necg8g9r"],
          script_type: "pay-to-witness-pubkey-hash",
        },
        {
          value: 3367425080,
          script: "0014266dce2acfd82d59ff8989b91de7178589d624b7",
          spent_by: "dc3015207c66e2fdc9f7efc73aab8b3ffaae53d1c0115b67d3ab10e9289c65ab",
          addresses: ["ltc1qyekuu2k0mqk4nluf3xu3mechskyavf9hq7umhl"],
          script_type: "pay-to-witness-pubkey-hash",
        },
        {
          value: 45653000,
          script: "0014d2d7dac5ba91a6b979d122c05d2f39b8073ef04d",
          spent_by: "e895b50f5c734966059589eadf987c252878e6ced7b7be5e3ab1379543c5efce",
          addresses: ["ltc1q6tta43d6jxntj7w3ytq96teehqrnauzdnlglee"],
          script_type: "pay-to-witness-pubkey-hash",
        },
        {
          value: 28296000,
          script: "76a9143224f1c665173a778618a7c55e45be8b231a9cd188ac",
          spent_by: "284712c3bdb4677b152f1b6d8ba051ecbe2a95f5162ec97acf8e544355e48495",
          addresses: ["LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv"],
          script_type: "pay-to-pubkey-hash",
        },
        {
          value: 97645000,
          script: "001468ff31a859389bc91e23a4fffe0136d33f8bf62c",
          spent_by: "4c5d79908ace7c4600f02fe4ee21c69338e3cfc56927c89084e0d4770fd9ad56",
          addresses: ["ltc1qdrlnr2ze8zduj83r5nlluqfk6vlcha3vjxc0cq"],
          script_type: "pay-to-witness-pubkey-hash",
        },
      ],
    },
    {
      block_hash: "bf75272b244a0ab33a114897e375af8054ed1e316b5db5f73fb91833989441fb",
      block_height: 3053332,
      hash: "48b976ac448b2bc452202f2391ef70805ee945cc678c3b1d0c9d0db3b5fa73d8",
      fees: 6780,
      confirmed: "2026-02-09T22:43:25Z",
      received: "2026-02-09T22:40:58.627Z",
      double_spend: false,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "acd574e91ae201981b87dffb86bf90991f64a8d1358d474326a8b980dc5a3512",
          output_index: 0,
          output_value: 42765200,
          addresses: ["LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 42758420,
          script: "76a91486c3651d45b19cd896a16d346131cb0bcf08d17288ac",
          addresses: ["LXWWtCWuiHsHZf8zwMWdRWZd9kvFmB57G1"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
    },
  ],
};

/* LMnD… swept 217 inputs in one transaction, which alone fills the first page. */
const SWEEP_PAGE = {
  address: "LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg",
  total_received: 219945536418,
  total_sent: 219945536418,
  balance: 0,
  unconfirmed_balance: 0,
  final_balance: 0,
  n_tx: 2910,
  unconfirmed_n_tx: 0,
  final_n_tx: 2910,
  txs: [
    {
      block_hash: "513219fd6eeab2fc2449edbd229101f6c8ff13a84dcd28cf33bcd43feaa5de50",
      block_height: 2600470,
      hash: "5e27a9c5d86d3259c9772f19da97ce25435f351c581abac33de41b5aeb3e145b",
      fees: 113000,
      confirmed: "2023-12-20T23:30:45Z",
      received: "2023-12-20T23:28:03.706Z",
      double_spend: false,
      vin_sz: 217,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "c6c7c191eec246d71238fab67159857dce00d688d5255db92d2cc6f47f1bf678",
          output_index: 0,
          output_value: 169745163,
          addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
          script_type: "pay-to-pubkey-hash",
        },
        {
          prev_hash: "d77217300b335f0dbf078ce03c268db7eef9f6b456c37b1e771e0f10bb07986f",
          output_index: 0,
          output_value: 71968000,
          addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 37046711007,
          script: "001432c0913debf665ebf85ef084c71b83b8bf2ae99d",
          spent_by: "a16692533b3dccad86280895f96ca5a4a78ea630e0e3a776af556dd8bcb62c14",
          addresses: ["ltc1qxtqfz00t7ej7h7z77zzvwxurhzlj46vae2eyuv"],
          script_type: "pay-to-witness-pubkey-hash",
        },
      ],
    },
  ],
};

/* The page under `before=2600470`, where LMnD… was still collecting. */
const BEFORE_SWEEP = {
  address: "LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg",
  total_received: 219945536418,
  total_sent: 219945536418,
  balance: 0,
  unconfirmed_balance: 0,
  final_balance: 0,
  n_tx: 2910,
  unconfirmed_n_tx: 0,
  final_n_tx: 2910,
  hasMore: true,
  txs: [
    {
      block_hash: "50ff12562c5d867c220568844395f37913bedaea3ab1b2476e71ad0d0b06d483",
      block_height: 2599038,
      hash: "c6c7c191eec246d71238fab67159857dce00d688d5255db92d2cc6f47f1bf678",
      fees: 409000,
      confirmed: "2023-12-18T00:23:54Z",
      received: "2023-12-18T00:18:17.711Z",
      double_spend: false,
      vin_sz: 5,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "40a1ae5a56ddddb524b4e426e270b0da883548083f36680628ecaba837052809",
          output_index: 0,
          output_value: 134943925,
          addresses: ["LbNbbr8Ag1SimQXgUwTTBVfANFh1evpoHe"],
          script_type: "pay-to-pubkey-hash",
        },
        {
          prev_hash: "56580489685677b5c4fb914f0c6533a1c2cea91f17e44a4cb31bec45dcb3e3d3",
          output_index: 0,
          output_value: 8641000,
          addresses: ["LbNbbr8Ag1SimQXgUwTTBVfANFh1evpoHe"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 169745163,
          script: "76a9141c0a43d8a53a7ac16adade9ab3593b6d22ae21e688ac",
          spent_by: "5e27a9c5d86d3259c9772f19da97ce25435f351c581abac33de41b5aeb3e145b",
          addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
    },
    {
      block_hash: "50ff12562c5d867c220568844395f37913bedaea3ab1b2476e71ad0d0b06d483",
      block_height: 2599038,
      hash: "d77217300b335f0dbf078ce03c268db7eef9f6b456c37b1e771e0f10bb07986f",
      fees: 113000,
      confirmed: "2023-12-18T00:23:54Z",
      received: "2023-12-18T00:17:38.824Z",
      double_spend: false,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "1c0d4934f56367023c9d9703425440882d21fdf699db65fc6b1776af55377e48",
          output_index: 0,
          output_value: 72081000,
          addresses: ["LQZrueKxXueDmHQGiFmRSmVkesbuuwyCwm"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 71968000,
          script: "76a9141c0a43d8a53a7ac16adade9ab3593b6d22ae21e688ac",
          spent_by: "5e27a9c5d86d3259c9772f19da97ce25435f351c581abac33de41b5aeb3e145b",
          addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
    },
    {
      block_hash: "6ac47f9a2fde4109780965ba7ca9f4ebe7d643bb51e8b94b7306c465a3ce11d3",
      block_height: 2599033,
      hash: "4f0d5b0da7f7ea46be422aabccda21a49aa5fd811f71c229e72c9e49064d9c54",
      fees: 112000,
      confirmed: "2023-12-18T00:11:16Z",
      received: "2023-12-18T00:09:36.634Z",
      double_spend: false,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          prev_hash: "a167f5014b96559e1899d973d9a8b498bfc29b27152e9ae3ffc132e2261ff5b4",
          output_index: 1,
          output_value: 8969000,
          addresses: ["LbEBtPcKFUsSYktaCu4ckSmybn7x8bN6Np"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
      outputs: [
        {
          value: 8857000,
          script: "76a9141c0a43d8a53a7ac16adade9ab3593b6d22ae21e688ac",
          spent_by: "5e27a9c5d86d3259c9772f19da97ce25435f351c581abac33de41b5aeb3e145b",
          addresses: ["LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg"],
          script_type: "pay-to-pubkey-hash",
        },
      ],
    },
  ],
};

/* Dogecoin unspent outputs, cut to two of 18 and marked as continuing to exercise paging. */
const DOGE_UNSPENT = {
  address: "DR7EKP5k7x29XWPwSPFtyJNVzuBRHhqcZh",
  total_received: 950419229744,
  total_sent: 932743300000,
  balance: 17675929744,
  unconfirmed_balance: 0,
  final_balance: 17675929744,
  n_tx: 23,
  unconfirmed_n_tx: 0,
  final_n_tx: 23,
  txrefs: [
    {
      tx_hash: "6486e917094c45671c57d0c64ed49e710f7482e5a52bb3353336a322bc2d6376",
      block_height: 5555523,
      tx_input_n: -1,
      tx_output_n: 0,
      value: 100000,
      ref_balance: 17675929744,
      spent: false,
      confirmations: 901893,
      confirmed: "2025-01-22T10:47:34Z",
      double_spend: false,
    },
    {
      tx_hash: "30ee71f6212a3a661c46ee92c8681482d1a8c27e2ec4582949060deeb6412892",
      block_height: 5480809,
      tx_input_n: -1,
      tx_output_n: 0,
      value: 100000,
      ref_balance: 17675829744,
      spent: false,
      confirmations: 976607,
      confirmed: "2024-11-28T15:42:30Z",
      double_spend: false,
    },
  ],
  tx_url: "https://api.blockcypher.com/v1/doge/main/txs/",
  hasMore: true,
};

/* A Litecoin output still in the mempool; its txref has no height at all. */
const PENDING_UNSPENT = {
  address: "ltc1q9xvgfj9rwdxga4f8g2wj5vuq0ynqmdxntgngem",
  total_received: 0,
  total_sent: 0,
  balance: 0,
  unconfirmed_balance: 34184044,
  final_balance: 34184044,
  n_tx: 0,
  unconfirmed_n_tx: 1,
  final_n_tx: 1,
  unconfirmed_txrefs: [
    {
      address: "ltc1q9xvgfj9rwdxga4f8g2wj5vuq0ynqmdxntgngem",
      tx_hash: "d2c56b8050926bd4d66a82dbbc060745fe5b076391937b2a677488267be7d340",
      tx_input_n: -1,
      tx_output_n: 0,
      value: 34184044,
      spent: false,
      received: "2026-11-14T15:20:42.501625121Z",
      confirmations: 0,
      double_spend: false,
      preference: "low",
    },
  ],
  tx_url: "https://api.blockcypher.com/v1/ltc/main/txs/",
};

const MISSING_TX = {
  error: "Transaction 0000000000000000000000000000000000000000000000000000000000000000 not found.",
};

const MISSING_BLOCK = { error: "Block 99999999 not found." };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* Answer every request through `route` and keep the URLs asked for, in order. */
function stubApi(route: (url: URL) => unknown): URL[] {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: string | URL | Request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      urls.push(url);
      const answer = route(url);
      return answer instanceof Response ? answer : jsonResponse(answer);
    }),
  );
  return urls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blockcypher provider", () => {
  it("reports the operations BlockCypher serves", async () => {
    const provider = await create("blockcypher");

    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(provider.getOutspends).toBeUndefined();
    expect(provider.getGasData).toBeUndefined();
  });

  it("reads a Litecoin balance with its totals", async () => {
    const urls = stubApi(() => BALANCE);

    const balance = await new BlockCypher().getBalance(BALANCE.address, "litecoin");

    expect(urls.map(String)).toEqual([`${BASE}/ltc/main/addrs/${BALANCE.address}/balance`]);
    expect(balance).toMatchObject({
      address: BALANCE.address,
      chain: "litecoin",
      balance: "0",
      balanceFormatted: "0",
      funded: "219945536418",
      spent: "219945536418",
      unconfirmed: "0",
      symbol: "LTC",
      blockNumber: null,
    });
  });

  it("reads a Dogecoin balance in koinus", async () => {
    const urls = stubApi(() => DOGE_BALANCE);

    const balance = await new BlockCypher().getBalance(DOGE_BALANCE.address, "dogecoin");

    expect(urls[0]?.pathname).toBe(`/v1/doge/main/addrs/${DOGE_BALANCE.address}/balance`);
    expect(balance).toMatchObject({
      balance: "17675929744",
      balanceFormatted: "176.75929744",
      symbol: "DOGE",
    });
  });

  it("keeps a negative mempool change as a signed amount", async () => {
    stubApi(() => ({ ...BALANCE, balance: 5000, unconfirmed_balance: -2000 }));

    const balance = await new BlockCypher().getBalance(BALANCE.address, "litecoin");

    expect(balance.unconfirmed).toBe("-2000");
  });

  it("asks for a segwit address in the lowercase the feed prints", async () => {
    const urls = stubApi(() => PENDING_UNSPENT);
    const address = PENDING_UNSPENT.address;

    await new BlockCypher().getBalance(address.toUpperCase(), "litecoin");

    expect(urls[0]?.pathname).toBe(`/v1/ltc/main/addrs/${address}/balance`);
  });

  it("refuses a malformed address and a foreign chain before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = new BlockCypher();

    await expect(provider.getBalance("notanaddress", "litecoin")).rejects.toThrow(
      new ExplorerError("Invalid Litecoin address", "blockcypher"),
    );
    await expect(provider.getBalance(BALANCE.address, "ethereum")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a confirmed transaction with every input and output", async () => {
    const urls = stubApi(() => TX);

    const tx = await new BlockCypher().getTxDetail(TX.hash, "litecoin");

    expect(urls[0]?.pathname).toBe(`/v1/ltc/main/txs/${TX.hash}`);
    expect(urls[0]?.searchParams.get("limit")).toBe("1000");
    expect(tx).toMatchObject({
      hash: TX.hash,
      blockNumber: 2_500_000,
      timestamp: "2023-06-29T00:01:25.000Z",
      from: "LPo6JkP8usUMayqvVHQWdCZSDPTH3fhYrv",
      to: "LMnDUoyMEECwUwLzEPpDX8QvkXgyvn3nKg",
      value: "18552002",
      valueFormatted: "0.18552002",
      fee: "113000",
      status: "success",
      isContractInteraction: false,
    });
    expect(tx.raw).toEqual(TX);
    expect(() => JSON.stringify(tx)).not.toThrow();
  });

  it("reads a mempool transaction as pending, without a block or a time", async () => {
    stubApi(() => PENDING_TX);

    const tx = await new BlockCypher().getTxDetail(PENDING_TX.hash, "litecoin");

    expect(tx.status).toBe("pending");
    expect(tx.blockNumber).toBe(0);
    expect(tx.timestamp).toBeUndefined();
  });

  it("marks a mempool transaction that lost a double spend as failed", async () => {
    stubApi(() => ({ ...PENDING_TX, double_spend: true }));

    const tx = await new BlockCypher().getTxDetail(PENDING_TX.hash, "litecoin");

    expect(tx.status).toBe("failed");
  });

  it("leaves the time out when BlockCypher's doesn't parse, and keeps the rest", async () => {
    stubApi(() => ({ ...TX, confirmed: "yesterday" }));

    const tx = await new BlockCypher().getTxDetail(TX.hash, "litecoin");

    expect(tx.timestamp).toBeUndefined();
    expect(tx).toMatchObject({ blockNumber: 2_500_000, value: "18552002", status: "success" });
  });

  it("refuses a transaction BlockCypher cut short instead of miscounting it", async () => {
    const cut = {
      ...TX,
      next_inputs: `${BASE}/ltc/main/txs/${TX.hash}?instart=1000&outstart=0&limit=1000`,
    };
    stubApi(() => cut);
    const provider = new BlockCypher();

    await expect(provider.getTxDetail(TX.hash, "litecoin")).rejects.toThrow(
      new ExplorerError(
        `BlockCypher cut transaction ${TX.hash} short at 1000 inputs or outputs`,
        "blockcypher",
      ),
    );
    stubApi(() => ({ ...HISTORY, txs: [{ ...HISTORY.txs[0], next_outputs: "more" }] }));
    await expect(
      provider.getTxHistory(HISTORY.address, "litecoin", { limit: 1 }),
    ).rejects.toBeInstanceOf(ExplorerError);
  });

  it("names a missing transaction instead of the URL", async () => {
    stubApi(() => jsonResponse(MISSING_TX, 404));
    const hash = "0".repeat(64);

    await expect(new BlockCypher().getTxDetail(hash, "litecoin")).rejects.toThrow(
      new NotFoundError(`Transaction ${hash}`, "blockcypher"),
    );
  });

  it("reads history newest first, from the address's side of each transaction", async () => {
    const urls = stubApi(() => HISTORY);

    const txs = await new BlockCypher().getTxHistory(HISTORY.address, "litecoin", { limit: 3 });

    expect(urls).toHaveLength(1);
    expect(urls[0]?.pathname).toBe(`/v1/ltc/main/addrs/${HISTORY.address}/full`);
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      limit: "3",
      txlimit: "1000",
    });
    expect(
      txs.map(({ hash, blockNumber, from, to, value }) => ({ hash, blockNumber, from, to, value })),
    ).toEqual([
      {
        hash: HISTORY.txs[0]?.hash,
        blockNumber: 3_083_761,
        from: HISTORY.address,
        to: "LKuYXqhGxsfRYTER1y2iYBvnBhNM8PuaL9",
        value: "28289220",
      },
      {
        hash: HISTORY.txs[1]?.hash,
        blockNumber: 3_065_954,
        from: "MDEJjRMcCqxR1FWc2HCLkfvuZhuvGLFnrx",
        to: HISTORY.address,
        value: "28296000",
      },
      {
        hash: HISTORY.txs[2]?.hash,
        blockNumber: 3_053_332,
        from: HISTORY.address,
        to: "LXWWtCWuiHsHZf8zwMWdRWZd9kvFmB57G1",
        value: "42758420",
      },
    ]);
  });

  it("walks below the lowest block of a short page", async () => {
    const urls = stubApi((url) => (url.searchParams.has("before") ? BEFORE_SWEEP : SWEEP_PAGE));

    const txs = await new BlockCypher().getTxHistory(SWEEP_PAGE.address, "litecoin", { limit: 3 });

    expect(urls.map((url) => url.searchParams.get("before"))).toEqual([null, "2600470"]);
    expect(urls.map((url) => url.searchParams.get("limit"))).toEqual(["3", "2"]);
    expect(txs.map((tx) => tx.hash)).toEqual([
      SWEEP_PAGE.txs[0]?.hash,
      BEFORE_SWEEP.txs[0]?.hash,
      BEFORE_SWEEP.txs[1]?.hash,
    ]);
    expect(txs[0]).toMatchObject({ from: SWEEP_PAGE.address, value: "37046711007" });
  });

  it("stops when a page comes back empty", async () => {
    const urls = stubApi((url) =>
      url.searchParams.has("before") ? { ...BEFORE_SWEEP, txs: [] } : SWEEP_PAGE,
    );

    const txs = await new BlockCypher().getTxHistory(SWEEP_PAGE.address, "litecoin", { limit: 3 });

    expect(urls).toHaveLength(2);
    expect(txs).toHaveLength(1);
  });

  it("turns inclusive block bounds into BlockCypher's exclusive after and before", async () => {
    const urls = stubApi(() => ({ ...HISTORY, txs: [] }));

    await new BlockCypher().getTxHistory(HISTORY.address, "litecoin", {
      startBlock: 3_053_332,
      endBlock: 3_083_761,
    });

    expect(urls[0]?.searchParams.get("after")).toBe("3053331");
    expect(urls[0]?.searchParams.get("before")).toBe("3083762");
  });

  it("refuses ascending order and a reversed range before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = new BlockCypher();

    await expect(
      provider.getTxHistory(HISTORY.address, "litecoin", { sort: "asc" }),
    ).rejects.toThrow(
      new ExplorerError("BlockCypher lists history newest first only", "blockcypher"),
    );
    await expect(
      provider.getTxHistory(HISTORY.address, "litecoin", { startBlock: 10, endBlock: 9 }),
    ).rejects.toThrow(
      new ExplorerError(
        "BlockCypher history needs whole block heights from 0 and startBlock <= endBlock",
        "blockcypher",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("doesn't take a short page of mempool rows for the end of history", async () => {
    const urls = stubApi(() => ({ ...HISTORY, txs: [PENDING_TX] }));
    const provider = new BlockCypher();

    await expect(
      provider.getTxHistory(HISTORY.address, "litecoin", { limit: 5 }),
    ).resolves.toHaveLength(1);
    await expect(
      provider.getTxHistory(HISTORY.address, "litecoin", { limit: 1, page: 2 }),
    ).rejects.toThrow(
      new ExplorerError(
        "BlockCypher history stops after 1 of the newest transactions, short of page 2",
        "blockcypher",
      ),
    );
    expect(urls).toHaveLength(2);
  });

  it("refuses a page its four reads never reach", async () => {
    let height = 3_000_000;
    const urls = stubApi(() => {
      height -= 1;
      return { ...SWEEP_PAGE, txs: [{ ...SWEEP_PAGE.txs[0], block_height: height }] };
    });

    await expect(
      new BlockCypher().getTxHistory(SWEEP_PAGE.address, "litecoin", { limit: 5, page: 2 }),
    ).rejects.toThrow(
      new ExplorerError(
        "BlockCypher history stops after 4 of the newest transactions, short of page 2",
        "blockcypher",
      ),
    );
    expect(urls).toHaveLength(4);
  });

  it("lists unspent outputs across pages, by the lowest height of each", async () => {
    const urls = stubApi((url) =>
      url.searchParams.has("before")
        ? { ...DOGE_UNSPENT, txrefs: [], hasMore: false }
        : DOGE_UNSPENT,
    );

    const utxos = await new BlockCypher().getUtxos(DOGE_UNSPENT.address, "dogecoin");

    expect(urls[0]?.searchParams.get("unspentOnly")).toBe("true");
    expect(urls[0]?.searchParams.get("limit")).toBe("2000");
    expect(urls[1]?.searchParams.get("before")).toBe("5480809");
    expect(utxos).toEqual([
      {
        txid: DOGE_UNSPENT.txrefs[0]?.tx_hash,
        vout: 0,
        value: "100000",
        valueFormatted: "0.001",
        confirmed: true,
        blockNumber: 5_555_523,
        blockHash: null,
        timestamp: "2025-01-22T10:47:34.000Z",
      },
      {
        txid: DOGE_UNSPENT.txrefs[1]?.tx_hash,
        vout: 0,
        value: "100000",
        valueFormatted: "0.001",
        confirmed: true,
        blockNumber: 5_480_809,
        blockHash: null,
        timestamp: "2024-11-28T15:42:30.000Z",
      },
    ]);
  });

  it("keeps a mempool output that carries no height", async () => {
    stubApi(() => PENDING_UNSPENT);

    const utxos = await new BlockCypher().getUtxos(PENDING_UNSPENT.address, "litecoin");

    expect(utxos).toEqual([
      {
        txid: PENDING_UNSPENT.unconfirmed_txrefs[0]?.tx_hash,
        vout: 0,
        value: "34184044",
        valueFormatted: "0.34184044",
        confirmed: false,
        blockNumber: null,
        blockHash: null,
      },
    ]);
  });

  it("reads a block with its header and no gas", async () => {
    const urls = stubApi(() => BLOCK);

    const block = await new BlockCypher().getBlockInfo(2_500_000, "litecoin");

    expect(urls[0]?.pathname).toBe("/v1/ltc/main/blocks/2500000");
    expect(block).toEqual({
      number: 2_500_000,
      hash: BLOCK.hash,
      parentHash: BLOCK.prev_block,
      timestamp: "2023-06-29T00:01:25.000Z",
      miner: "",
      txCount: 421,
      version: 536_870_912,
      merkleRoot: BLOCK.mrkl_root,
      bits: 436_249_296,
      nonce: 1_729_419_803,
      size: 151_230,
    });
  });

  it("names a block past the tip as missing", async () => {
    stubApi(() => jsonResponse(MISSING_BLOCK, 404));

    await expect(new BlockCypher().getBlockInfo(99_999_999, "litecoin")).rejects.toThrow(
      new NotFoundError("Block 99999999", "blockcypher"),
    );
  });

  it("gives up on the hourly limit as a rate limit, so selection can move on", async () => {
    vi.useFakeTimers();
    const urls = stubApi(() => jsonResponse({ error: "Limits reached." }, 429));

    const read = expect(new BlockCypher().getBlockInfo(1, "bitcoin")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    await vi.runAllTimersAsync();
    await read;

    expect(urls).toHaveLength(3);
  });
});
