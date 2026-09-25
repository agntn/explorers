import { fileURLToPath } from "node:url";

/** Bundled from the checkout's sources: a deploy needs neither dist/ nor the root node_modules. */
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const librarySource = fileURLToPath(new URL("../src/index.ts", import.meta.url));

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: fileURLToPath(new URL("./", import.meta.url)),
  alias: {
    "@agntn/explorers": librarySource,
  },
  /** The dev server serves files under workspaceDir only; the library and its package.json sit one level up. */
  vite: {
    server: {
      fs: {
        allow: [repoRoot],
      },
    },
  },
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
      "Seventeen block explorer APIs behind one TypeScript contract: balances, transactions, token transfers, contracts, tokens, gas and blocks on 29 chains. Library, CLI and agent tools.",
    sections: [
      {
        title: "Tools",
        description: "Pages that run the library through the docs worker rather than from Markdown.",
        links: [
          {
            title: "Explorer",
            description:
              "Search an address, an ENS name, a transaction hash or a block number on any of the 29 chains and open its page.",
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
      alt: "@agntn/explorers: seventeen block explorer APIs, one shape",
    },
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:archive",
        "lucide:arrow-left-right",
        "lucide:arrow-right",
        "lucide:arrow-up-right",
        "lucide:book-marked",
        "lucide:book-open",
        "lucide:bot",
        "lucide:box",
        "lucide:chart-column",
        "lucide:check",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:circle-x",
        "lucide:copy",
        "lucide:database",
        "lucide:external-link",
        "lucide:eye",
        "lucide:file-code",
        "lucide:fuel",
        "lucide:globe",
        "lucide:info",
        "lucide:layers",
        "lucide:leaf",
        "lucide:library",
        "lucide:list",
        "lucide:network",
        "lucide:plus",
        "lucide:radio-tower",
        "lucide:receipt",
        "lucide:refresh-cw",
        "lucide:route",
        "lucide:search",
        "lucide:server",
        "lucide:sliders-horizontal",
        "lucide:sun",
        "lucide:sunrise",
        "lucide:terminal",
        "lucide:triangle-alert",
        "lucide:wallet",
        "lucide:x",
        "lucide:zap",
        "simple-icons:github",
        "simple-icons:npm",
        "token:ada",
        "token:apt",
        "token:ar",
        "token:arbitrum-one",
        "token:avax",
        "token:bch",
        "token:bsv",
        "token:btg",
        "token:base",
        "token:berachain",
        "token:bnb",
        "token:btc",
        "token:dcr",
        "token:eth",
        "token:gno",
        "token:linea",
        "token:ltc",
        "token:op",
        "token:pol",
        "token:scroll",
        "token:sol",
        "token:sui",
        "token:ton",
        "token:trx",
        "token:xec",
        "token:xlm",
        "token:zksync",
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
