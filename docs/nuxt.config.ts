import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: fileURLToPath(new URL("./", import.meta.url)),
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://explorers.agntn.dev",
    name: "@agntn/explorers",
  },
  llms: {
    domain: "https://explorers.agntn.dev",
    title: "@agntn/explorers",
    description:
      "Thirteen block explorer APIs behind one TypeScript contract: balances, transactions, token transfers, contracts, tokens, gas and blocks on 23 chains. Library, CLI and agent tools.",
    sections: [
      {
        title: "Tools",
        description: "Pages that run the library through the docs worker rather than from Markdown.",
        links: [
          {
            title: "Explorer",
            description:
              "Search an address, an ENS name, a transaction hash or a block number on any of the 23 chains and open its page.",
            href: "https://explorers.agntn.dev/explorer",
          },
          {
            title: "Gas",
            description: "Current fee suggestions on every chain with a provider that quotes them.",
            href: "https://explorers.agntn.dev/explorer/gas",
          },
          {
            title: "Providers",
            description: "Which providers the docs worker holds a key for, and what each one serves.",
            href: "https://explorers.agntn.dev/explorer/providers",
          },
        ],
      },
    ],
    notes: [
      "Every provider, chain and capability on the site comes from the published @agntn/explorers registry; explorer answers are live reads through the docs worker, cached for a while.",
    ],
  },
  /** Docus pages define their own OG images; the alt text is the one thing they leave unset. */
  ogImage: {
    defaults: {
      alt: "@agntn/explorers: thirteen block explorer APIs, one shape",
    },
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:external-link",
        "lucide:x",
        "simple-icons:bitcoin",
        "simple-icons:cardano",
        "simple-icons:ethereum",
        "simple-icons:litecoin",
        "simple-icons:npm",
        "simple-icons:optimism",
        "simple-icons:polygon",
        "simple-icons:solana",
        "simple-icons:sui",
        "simple-icons:ton",
        "simple-icons:bnbchain",
        "solar:add-circle-linear",
        "solar:alt-arrow-left-linear",
        "solar:alt-arrow-right-linear",
        "solar:arrow-right-linear",
        "solar:arrow-right-up-linear",
        "solar:bill-list-linear",
        "solar:bolt-linear",
        "solar:book-2-linear",
        "solar:bot-linear",
        "solar:box-minimalistic-linear",
        "solar:calculator-linear",
        "solar:close-circle-linear",
        "solar:code-file-linear",
        "solar:code-square-linear",
        "solar:copy-linear",
        "solar:danger-triangle-linear",
        "solar:database-linear",
        "solar:gas-station-linear",
        "solar:global-linear",
        "solar:hashtag-linear",
        "solar:history-linear",
        "solar:info-circle-linear",
        "solar:key-minimalistic-linear",
        "solar:layers-linear",
        "solar:library-linear",
        "solar:magnifier-linear",
        "solar:link-round-angle-linear",
        "solar:refresh-linear",
        "solar:routing-2-linear",
        "solar:server-linear",
        "solar:shield-warning-linear",
        "solar:square-transfer-horizontal-linear",
        "solar:structure-linear",
        "solar:tuning-2-linear",
        "solar:unread-linear",
        "solar:wallet-linear",
        "vscode-icons:file-type-js",
        "vscode-icons:file-type-json",
        "vscode-icons:file-type-shell",
        "vscode-icons:file-type-typescript",
      ],
    },
  },
  colorMode: {
    preference: "dark",
  },
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      meta: [
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0d10" },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#eef1f4" },
        { name: "apple-mobile-web-app-title", content: "explorers" },
        { name: "author", content: "oritwoen" },
        { property: "og:locale", content: "en_US" },
      ],
    },
  },
  /** Docus ships an MCP endpoint that wants the Cloudflare Agents SDK on Workers. Not needed. */
  mcp: {
    enabled: false,
  },
  nitro: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-09-03",
    prerender: {
      crawlLinks: true,
      routes: [
        "/",
        "/explorer",
        "/explorer/gas",
        "/explorer/providers",
        "/sitemap.xml",
        "/robots.txt",
        "/llms.txt",
        "/llms-full.txt",
      ],
      /** Entity pages read live data after mount; prerendering their shells would only bake in a stale sample. */
      ignore: ["/api", "/explorer/address", "/explorer/tx", "/explorer/block"],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  compatibilityDate: "2026-09-03",
  /** In production the response cache lives in KV, so it survives isolates. */
  $production: {
    nitro: {
      storage: {
        cache: {
          driver: "cloudflare-kv-binding",
          binding: "CACHE",
        },
      },
    },
  },
  /** Fonts live in public/fonts and app/assets/fonts.css, where nuxt-og-image reads them from. */
  css: ["~/assets/fonts.css"],
  fonts: {
    families: [
      { name: "Space Grotesk", provider: "local", weights: [400, 500, 600] },
      { name: "Space Mono", provider: "local", weights: [400, 700] },
    ],
  },
  content: {
    database: {
      type: "d1",
      bindingName: "DB",
    },
    build: {
      markdown: {
        highlight: {
          theme: {
            default: "github-light",
            light: "github-light",
            dark: "poimandres",
          },
        },
      },
    },
  },
});
