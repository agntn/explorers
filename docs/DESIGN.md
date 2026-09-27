# Design system

The shared rules (direction, color roles, type, the `console-*` grammar, hero, docs chrome, density, motion, checks) live in the one agntn design system document, kept with the agntn skills until it ships in the shared package. This file records only what explorers owns and where it departs from the shared rules. It does not repeat them.

The instruments explorers owns:

| Instrument | Where | Object |
| --- | --- | --- |
| [LandingHero.vue](app/components/content/LandingHero.vue) | landing, first screen | hero zone, circuit `look up` into the explorer search |
| [Search.vue](app/components/explorer/Search.vue) | under every hero on the landing and `/explorer` | the lookup form: chain, input, what it reads as, examples |
| [LandingBalance.vue](app/components/content/LandingBalance.vue) | "An address in, one Balance out" | one `getBalance` answer, walked across the samples |
| [LandingHistory.vue](app/components/content/LandingHistory.vue) | "History and detail, same Transaction" | five rows of `getTxHistory` |
| [LandingSelection.vue](app/components/content/LandingSelection.vue) | "Keys first, keyless next" | the `resolveProvider()` ranking for the sample's chain |
| [LandingToolCall.vue](app/components/content/LandingToolCall.vue) | "Ten tools, three hosts" | `explorers_balance` arguments and answer |
| [LandingRotatingCode.vue](app/components/content/LandingRotatingCode.vue) | "Same calls, every provider" | the same nine lines for every sample, as a file |
| [LandingStart.vue](app/components/content/LandingStart.vue) | closing section | install, notes, first balance as a file |
| [ProviderMatrix.vue](app/components/content/ProviderMatrix.vue) | landing and `/providers` | roster of the providers on `UTable`, sortable |
| [ChainMatrix.vue](app/components/content/ChainMatrix.vue) | `/providers/chains` | roster of the chains with the providers that serve them |
| [ProviderFacts.vue](app/components/content/ProviderFacts.vue) | every provider page | provider dossier: ID bar with position, reticle, chains, operations, access |
| [Dashboard.vue](app/components/explorer/Dashboard.vue) | `/explorer` | one chain's tip: chain chips, subject, stats, blocks and transactions |
| [GasBoard.vue](app/components/explorer/GasBoard.vue) | `/explorer/gas` | one cell per chain that quotes fees |
| [ProvidersBoard.vue](app/components/explorer/ProvidersBoard.vue) | `/explorer/providers` | roster of what the docs worker can answer |
| [AddressOverview.vue](app/components/explorer/AddressOverview.vue), [TransactionCard.vue](app/components/explorer/TransactionCard.vue), [BlockCard.vue](app/components/explorer/BlockCard.vue) | entity pages | dossiers of one address, one transaction, one block |
| [Landing.takumi.vue](app/components/OgImage/Landing.takumi.vue), [Docs.takumi.vue](app/components/OgImage/Docs.takumi.vue) | OG images | the hero zone in 1200 by 600; a docs page as one instrument with the section tag, ruler and tool tags |

Provider and chain names, icons, blurbs and capabilities come from [providers.ts](app/utils/providers.ts) over the registry snapshot. The landing samples come from [landing-fixtures.ts](app/utils/landing-fixtures.ts), recorded through the library.

## Nuxt UI variants

Controls are Nuxt UI components; `app.config.ts` gives each variant its family look with classes from `app.css`, so a page never hand-builds a button, a field or a status word.

| Component and variant | Look | Used for |
| --- | --- | --- |
| `UButton` primary solid | amber action segment, glyph in its own cell | the one main action: get started, open address, read the guide |
| `UButton` neutral outline | quiet action segment | second action: GitHub, open the explorer |
| `UButton` neutral subtle | 22 px boxed control, `square` 28 px | copy, refresh, previous and next |
| `UButton` variant `chip`, neutral or primary | chip, picked chip on the accent edge | examples, chain picker, same address on other chains |
| `UBadge` neutral outline, neutral subtle, error outline | boxed mono word: quiet, bright, red | transaction and output status, worker state, contract flags, fee unit |
| `UTabs` link | mono capitals on a rule, accent segment under the active tab | address data |
| `UInput`, `USelectMenu` none | the readout row is the frame, the value mono | the search form; the chain menu in the tooltip grammar |
| `UAlert` error outline | red edge, message in mono | a failed read |

`chip` is a variant this site adds in `app.config.ts`. Docus renders its header search as neutral soft and its own buttons as neutral ghost and link, so those pairs keep the default look.

## Anatomy

- **Operations.** `CapabilityCells` prints the nine `Provider` operations as boxed three letter cells in registry order, the served ones bright on an accent underline, the full name and method in a `UTooltip`. The provider dossier prints the same nine as cells with the method name and a node, an absent method struck through.
- **Provider dossier.** ID bar with the provider key and `04 / 18`, meta with its environment variables or `keyless`. Subject band: reticle with the provider glyph, chain keys as boxed identifiers in their own case. Readout: chains, auth, operations served in the accent, one tick per operation. Bands `Operations [ Provider contract ]` and `Access` with leads `Create`, `Import`, `Host`, `Status`. Footer back to the index with the default chain.
- **Search.** Bar `Call classify(input, "<chain>") → <kind>`; the reticle carries the selected chain. The readout rows hold a `USelectMenu` with every chain and its glyph, filterable, and a `UInput`; `Reads as` answers live in the accent. The submit is a primary `UButton`, the examples soft ones.
- **Explorer pages.** A hero zone per page (`ID explorer / <section>`), the circuit `input` into the search, then the page's instruments on the landing gutters. Entity pages print the id under the title and stack a dossier over a `List` instrument whose tabs are `UTabs`, rows `UTable` with the roster classes and the pager in the footer.
- **Lists.** Five columns at most; narrow, `STACK` in [entity-table.ts](app/utils/entity-table.ts) puts the id and the amount on the first line, the route on the second, block and status on the third. Hashes and addresses go through `ExplorerHash`: short on screen, whole in the tooltip.

## Motion

| Change | Motion |
| --- | --- |
| landing sample advances (4.8 s, paused on hover and focus) | ruler cursor once, scan and reticle arcs on the balance and tool call, rows slide in, file name rolls |
| explorer read in flight | ruler cursor loops (`console-cursor-busy`) on the dashboard, gas board, lists |
| tip refresh (15 s) | cursor once, rows slide in |
| reduced motion | no walk, no refresh timer; manual steps still work |

## Differences

Departures from the shared rules, recorded for the shared package:

- Success is the quiet state of a transaction, not the accent: in lists nearly every row succeeds, and the accent on each one read as a yellow stain. A failure is red, pending is bright, and the accent stays for `IN` on an address's own history.
- The landing's hero instrument is a working form, so it stays on a phone (`hero-instrument-keep`) instead of hiding below 48rem.
- The landing instruments walk recorded samples and swap in the worker's live answer when it lands; the bar meta says `recorded` or `live`.
- `.explorers-band`, `.explorers-rows`, `.explorers-facts`, `.feed-*` and `.list-*` are new: explorer panels carry more rows than any keys or puzzles instrument.
- The sidebar lifts out every view of a section, not only its index: a page with `navigation.lead` in its frontmatter stands as a lead under that tag, so the chain matrix reads `Matrix Chains` above the providers instead of sitting among them. The tags share one width.
- The version comes from the root `package.json`, like keys; no data version exists, so ID strips and footers carry none.
- The OG images ship local Figtree and Fira Code TTFs, the keys mechanism.

## Checks

Beyond the shared checks: `/explorer`, `/explorer/gas`, an address page with the history tab, a transaction and a block at 1440 and 390 px, and no horizontal scroll on the address page at 320 px.
