<script setup lang="ts">
import { TIP_CHAINS, hasTip } from "#shared/tip-chains";
import { CHAINS, chainInfo } from "../../utils/providers";

definePageMeta({ layout: "default" });

const title = "Explorer";
const description =
  "A block explorer for 26 chains. Search any address, ENS name, transaction hash or block number. Latest blocks and transactions on fourteen of them, live.";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [{ title, path: "/explorer" }],
});

defineOgImage(
  "Docs",
  { headline: "Explorer", title, description },
  { alt: "Explorer: the latest blocks and transactions on 26 chains, and a search box" },
);

const route = useRoute();
const router = useRouter();

/** Chains with a live feed first, in the order the worker serves them, then the rest. */
const tabs = [
  ...TIP_CHAINS.map((key) => chainInfo(key)).filter((chain) => chain !== undefined),
  ...CHAINS.filter((chain) => !hasTip(chain.key)),
];

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
    eyebrow="explorer"
    title="Every chain."
    accent="One explorer."
    description="An address, an ENS name, a transaction hash or a block number, on any of 26 chains. Below it, the chain's tip as its public explorer reports it, refreshed every fifteen seconds."
    :chain="chain"
    wide
    compact
  >
    <div class="space-y-6">
      <nav aria-label="Chain" class="flex flex-wrap gap-1.5">
        <button
          v-for="row in tabs"
          :key="row.key"
          type="button"
          class="explorers-explorer-link"
          :class="{ 'explorers-explorer-link-active': chain === row.key }"
          @click="pick(row.key)"
        >
          <UIcon :name="row.icon" class="size-3.5" />
          {{ row.name }}
        </button>
      </nav>

      <ExplorerDashboard :chain="chain" />

      <p class="flex items-start gap-2 text-sm leading-6 text-dimmed">
        <UIcon name="i-lucide-info" class="mt-1 size-4 shrink-0 text-primary" />
        <span
          >Blocks and transactions on this page come straight from the chain's public explorer API,
          because the library reads one thing at a time and doesn't have a feed yet. Every page you
          open from here runs the library. Nothing here holds a wallet or signs anything.
          <NuxtLink to="/guide/explorer" class="text-primary hover:underline">How it works</NuxtLink>.</span
        >
      </p>
    </div>
  </ExplorerShell>
</template>
