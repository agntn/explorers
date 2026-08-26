import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/providers/etherscan.ts",
        "./src/providers/blockscout.ts",
        "./src/providers/blockchair.ts",
        "./src/providers/mempool.ts",
        "./src/providers/solscan.ts",
        "./src/providers/helius.ts",
        "./src/providers/ton.ts",
        "./src/providers/tronscan.ts",
        "./src/providers/aptos.ts",
        "./src/providers/blockberry.ts",
      ],
    },
  ],
});
