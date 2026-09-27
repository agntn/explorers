<script setup lang="ts">
import { TIP_CHAINS } from "#shared/tip-chains";
import { CHAINS, PROVIDERS } from "../../utils/providers";

definePageMeta({ layout: "default" });

const title = "Explorer";
const description =
  "A block explorer for 29 chains. Search any address, ENS name, transaction hash or block number. Latest blocks and transactions on fourteen of them, live.";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [{ title, path: "/explorer" }],
});

defineOgImage(
  "Docs",
  { headline: "Explorer", title, description },
  { alt: "Explorer: the latest blocks and transactions on 29 chains, and a search box" },
);

const route = useRoute();
const router = useRouter();

const chain = ref("ethereum");

function pick(key: string) {
  chain.value = key;
  void router.replace({ query: key === "ethereum" ? {} : { chain: key } });
}

/** The deep link is read after mount, once the router has restored the address a prerendered page lost. */
onMounted(() => {
  const wanted = route.query.chain;
  if (typeof wanted === "string" && CHAINS.some((row) => row.key === wanted)) {
    chain.value = wanted;
  }
});
</script>

<template>
  <ExplorerShell
    title="Every chain."
    accent="One explorer."
    description="An address, an ENS name, a transaction hash or a block number, on any chain the library serves. Under the search, the chain's tip as its public explorer reports it. Nothing here holds a wallet or signs anything."
    :chain="chain"
    examples
  >
    <template #status>
      <dl class="hero-metrics">
        <div>
          <dt>Chains</dt>
          <dd>{{ CHAINS.length }}</dd>
          <dd class="hero-metric-sub">searchable</dd>
        </div>
        <div>
          <dt>Live feeds</dt>
          <dd class="hero-metric-accent">{{ TIP_CHAINS.length }}</dd>
          <dd class="hero-metric-sub">every 15 s</dd>
        </div>
        <div>
          <dt>Providers</dt>
          <dd>{{ PROVIDERS.length }}</dd>
          <dd class="hero-metric-sub">behind each page</dd>
        </div>
      </dl>
    </template>
    <ExplorerDashboard :chain="chain" @pick="pick" />
  </ExplorerShell>
</template>
