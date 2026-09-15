# docs/

Docus site for `@agntn/explorers`. Markdown lives in `content/`. The explorer is a set of Vue pages in the Nuxt app backed by Nitro routes over the library, not a script.

## Layout

```
docs/
├── nuxt.config.ts                 # extends: ['docus'], cloudflare_module preset (Workers), prerender list
├── app/app.config.ts              # title, github, theme, seo schema
├── app/app.css                    # theme tokens (light + .dark), shared `explorers-*` classes
├── app/components/                # Docus overrides: AppHeaderLogo, AppHeaderCTA (nav), AppFooterLeft, DocsAsideLeftBody; icons are Solar (linear), brands stay simple-icons
├── app/components/content/        # MDC components (`::landing-home`, `::provider-facts`, `::provider-matrix`, `::chain-matrix`), the landing panels, ToolHero, LandingFeature
├── app/components/explorer/       # the explorer: Shell, Search, Nav, State, Pager, the Dashboard (StatTiles, LatestBlocks, LatestTransactions) and one card per entity (AddressOverview, TransactionsList, UtxosList, TokensTable, TransfersList, ContractCard, TransactionCard, BlockCard, BlockTransactions, GasBoard, ProvidersBoard)
├── app/components/OgImage/        # Docs.takumi and Landing.takumi override the Docus OG templates
├── app/assets/fonts.css           # @font-face for the TTFs served from public/fonts (site and OG images)
├── app/composables/               # useAnswer (one worker call with its state, memoised per query), useLandingExplorer (one clock for every live panel), useSubNavigation
├── app/data/explorers.json        # the registry snapshot; written by scripts/snapshot.mjs, committed
├── app/utils/                     # providers (presentation over the snapshot), entities (classify, paths, external links), wire (errorText over the shared shapes), format, landing-fixtures
├── shared/                        # wire.ts (answer shapes, one declaration for app and server), tip-chains.ts (the feed list), identifier.ts (the address predicate)
├── app/pages/explorer/            # index (search hub), gas, providers, address/[chain]/[address], tx/[chain]/[hash], block/[chain]/[number]
├── scripts/snapshot.mjs           # ../dist/index.mjs + @agntn/chains -> app/data/explorers.json
├── scripts/record-fixtures.mjs    # regenerates app/utils/landing-fixtures.ts through dist/
├── server/api/                    # balance, tx, tx-detail, utxos, contract, tokens, transfers, gas, block, providers over the library; tip and block-txs over the explorers' list endpoints
├── server/utils/                  # explorer.ts (chain and provider parsing, `cachedRead` envelope, key status), query.ts (caps, cache, rate limit, errors), slim.ts (raw dropped, source counted), tip.ts (the live feed, outside the library)
├── server/routes/sitemap.xml.ts   # Docus sitemap plus the Vue pages it cannot see
├── public/                        # fonts, favicon.svg and the icons and manifest cut from it
├── content/index.md               # landing
├── content/1.guide/               # getting started, cli, selection, balances, transactions, tokens, contracts, gas-and-blocks, errors, agents, custom, explorer
├── content/2.providers/           # one page per provider
└── content/3.chains.md            # the chain matrix
```

## Commands

```bash
pnpm build            # in the repo root first; the snapshot and the fixtures read dist/
pnpm install          # from docs/
pnpm snapshot         # regenerate app/data/explorers.json from ../dist
pnpm fixtures         # record the landing samples again (network, keyless providers only)
pnpm dev              # http://localhost:3000
pnpm build            # runs the snapshot, then Cloudflare Workers output in .output/, content routes prerendered
pnpm deploy           # build, then wrangler deploy to explorers.agntn.dev
pnpm generate         # static output only, the /api routes need the worker
```

Deployment: Nitro preset `cloudflare_module`. Nuxt Content needs a D1 binding named `DB` and the response cache a KV binding named `CACHE`. `wrangler.jsonc` carries both plus the `NUXT_SITE_URL` var, and Nitro merges it into the generated `.output/server/wrangler.json`. The ids in there are the live ones, created once with `wrangler d1 create agntn-explorers` and `wrangler kv namespace create CACHE`; a fresh deployment elsewhere creates its own and replaces them.

Explorer keys are Worker secrets, never vars: `wrangler secret put ETHERSCAN_API_KEY`, `SOLSCAN_API_KEY`, `HELIUS_API_KEY`, `TRONSCAN_API_KEY`, `BLOCKBERRY_API_KEY`, optionally `BLOCKCHAIR_API_KEY`. With `nodejs_compat` the runtime exposes them on `process.env`, which is where the library's `resolveProvider()` reads them. A provider without its key shows `configured: false` in `/api/providers` and a read that lands on it answers 503; Blockchair's key is optional, so it stays `configured` without one. Without `ETHERSCAN_API_KEY` every EVM read goes through Blockscout, which is fine for a demo.

The site imports `@agntn/explorers` from `file:..`, and pnpm copies the package at install time instead of linking it. After a library change, `pnpm build` in the root and then `pnpm update @agntn/explorers` in `docs/`, or the worker ships the old copy; `pnpm install` alone says up to date and refreshes nothing.

Resolution traps, both caused by the repo root being a pnpm workspace:

- `pnpm-workspace.yaml` sets `shamefullyHoist: true`. Without it `docs/node_modules` holds only direct dependencies, Node walks up to the root `node_modules`, and the server bundle can get a second copy of Vue.
- `nuxt.config.ts` pins `workspaceDir` to `docs/` and disables devtools and telemetry, which would otherwise be resolved from the root.

## The snapshot

- `app/data/explorers.json` is the single source for every provider, chain, capability and endpoint on the site. `scripts/snapshot.mjs` maps `builtins` and `PROVIDER_DEFAULT_CHAIN` from `../dist/index.mjs` and the chain metadata from `@agntn/chains` to plain objects; the build script runs it first, so a stale file cannot ship, but the committed copy is what `pnpm dev` and the diff show. A provider added to the library shows up in the grid, the sidebar, the matrix and the explorer by itself; it needs one entry in `PRESENTATION` in `app/utils/providers.ts` (label, icon, env vars, blurb) and a page in `content/2.providers/`, and the utils throw at import if the entry is missing.
- Two things the snapshot does not carry are mirrored by hand in `app/utils/providers.ts`, each with a comment naming its source: the environment variables per provider (`ENV_MAP` and `OPTIONAL_CREDENTIAL_PROVIDERS` in `src/core/resolve.ts`) and the native decimals per chain (what each provider passes to `formatWei()`). Change either in the library, change them here.
- `classify` in `app/utils/entities.ts` is a port of `classifyInput` in `src/core/input.ts`, plus digits for a block number. `GasBoard` keeps a `NO_FEES` set for chains a provider advertises but cannot serve (Pepecoin on Mempool), because capabilities are declared by the provider, not by the chain.

## Live data

- The one thing on the site that is not the library: `server/utils/tip.ts`. The hub's stats, latest blocks and latest transactions, and the block page's transaction list, come from the explorers' own list endpoints (Blockscout `/api/v2/stats`, `/blocks`, `/transactions`, `/blocks/:n/transactions`; Mempool `/api/v1/blocks`, `/api/mempool`, `/api/mempool/recent`, `/api/block/:hash/txs`; the Arweave gateway `/info`, `/block/current`, `/block/height/:n` and GraphQL), fetched with the library's `getJSON`. Hosts mirror `CHAIN_BASES` in `src/providers/blockscout.ts` and `src/providers/mempool.ts`. Chains outside those three families get a 404 from `/api/tip` and the hub says there is no feed. When the library grows a tip read, delete the file and call the library.

- Every library route is `cachedRead()` in `server/utils/explorer.ts` plus its own query parsing: `withProvider()` from the library (the same selection, keys and single retry as the CLI and the tools), the answer stamped with provider and time, library errors mapped to statuses. An explicit `provider` is passed through strictly; `auto` or none lets the library choose. `requireOperation()` throws the library's own `UnsupportedOperationError` for a flag that is false.
- Every route goes through `cachedAnswer` in `server/utils/query.ts`: exact parameters as the key, two minutes for a balance or the unspent outputs, five for history and transfers, ten for holdings, an hour for a transaction or a block, a day for contract metadata, thirty seconds for gas and the feed, nothing for a thrown failure. Misses on one key in one isolate share a single production, and KV expires entries itself a while after the logical TTL. Do not bypass it, the public explorers rate limit by address and the whole page runs on one. A cache miss also counts against `RATE_LIMIT` (30 new requests a minute per address, 429 past it). Cache hits are free.
- Parameters are capped in `server/utils/query.ts` (identifiers 128 chars, 25 rows a page, 100 pages, block numbers under two billion). `readIdentifier` accepts letters, digits, dots, dashes, underscores and colons only, so an address, an ENS name, a hash or an Arweave id passes and a path or markup does not.
- Answers are cut to size in `server/utils/slim.ts` before they leave the worker: `raw` never travels, a contract's ABI and source are counted rather than shipped, transactions keep at most twenty token transfers, holdings and unspent outputs stop at fifty rows with the total alongside.
- Library errors are mapped in `toHttpError`: `NotFoundError` 404, `UnknownProviderError` 400, `UnsupportedChainError` and `UnsupportedOperationError` 422, `AuthError` and `PlanRestrictedError` 503, `RateLimitError` 429, `HTTPError` and other `ExplorerError` 502, a `RangeError` from `normalizeChain` 400. The message never repeats an endpoint, `failureText` keeps only the part before the first `:` or `[`.
- `app/utils/landing-fixtures.ts` holds answers recorded through the library so the landing and the hub paint before the worker answers. Regenerate it with `pnpm fixtures`. Never edit the recorded text by hand, it drifts and nobody notices.
- In production the cache lives in the KV binding `CACHE` (`$production.nitro.storage.cache`). Locally it is in memory.
- Entity pages read after mount and keep their state in the route: the address page's tab and page number in the query, everything else in the path. They are `noindex`, and `nitro.prerender.ignore` keeps them out of the build; the hub, gas and providers pages are prerendered as shells.

## SEO

- `seo.schema` in `app/app.config.ts` emits the landing JSON-LD: `WebSite`, the agntn `Organization` as publisher, and a free `SoftwareApplication` with `sameAs` on GitHub and npm. Docs pages get `Article` plus `BreadcrumbList` from Docus on their own; the explorer pages call `useSeo` and `defineOgImage` themselves.
- The Docus sitemap reads content collections only. `server/routes/sitemap.xml.ts` wraps it and appends the pages listed in `PAGES`; a new static page under `app/pages/` goes there too or it is invisible to crawlers. Entity pages stay out.
- Docus links `/favicon.ico` without shipping one. `public/favicon.svg` is the source, the PNGs and the `.ico` are cut from it with ImageMagick, `app.head` in `nuxt.config.ts` links them with the manifest and theme colours.

## OG images

- `app/components/OgImage/Docs.takumi.vue` and `Landing.takumi.vue` override the Docus templates of the same name and are rendered by Takumi at build time. Takumi has no CSS variables, so the theme colours from `app.css` are repeated there as literals.
- nuxt-og-image does not see the faces `@nuxt/fonts` generates on this Nuxt version, but it parses `@font-face` rules from the files in `css`. That is why `app/assets/fonts.css` declares the five TTFs in `public/fonts` and `fonts.families` uses the `local` provider.
- The landing OG file is named from the SEO description. Nitro refuses to write a prerender path containing `..`, so a description ending in a period is silently skipped and the landing ships with a dead `og:image`. Docus also cuts a description longer than 150 minus the title's length at the last period, which puts a period at the end. Keep the description in `content/index.md` under that budget and without a trailing period, and check the build log for `c_Landing` with `(skipped)`.

## Constraints

- Token symbols, token names, contract names and decoded function names come from public chains and the explorers that index them; anyone can deploy a token called anything. Render them as text through interpolation, clip them, never `v-html`; nothing in `app/` uses it.
- Provider labels, icons, env vars, blurbs and chain icons live once in `app/utils/providers.ts`. The sidebar, the landing grid, the matrices, the explorer and `::provider-facts` read from it.
- The docs API shapes live once, in `shared/wire.ts`; routes type their answers with them and the page reads the same declarations.
- Every endpoint, option, error class and limit quoted in `content/` has a line in `src/` or in the snapshot. Check a new one the same way before writing it down.
- Never commit a key, and never put one in `wrangler.jsonc` vars. The worker holds no wallet and signs nothing; the footer says so.
