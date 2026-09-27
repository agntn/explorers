<script setup lang="ts">
import type { BlockAnswer } from "../../../../utils/wire";
import { chainInfo, chainLabel, providersFor } from "../../../../utils/providers";

definePageMeta({ layout: "default" });

const route = useRoute();

const chain = computed(() => String(route.params.chain ?? ""));
const raw = computed(() => String(route.params.number ?? ""));
const number = computed(() => (/^\d{1,10}$/u.test(raw.value) ? Number(raw.value) : null));
const known = computed(() => chainInfo(chain.value) !== undefined && number.value !== null);
const served = computed(() => providersFor(chain.value, "blockInfo").length > 0);

const title = computed(() => `Block ${raw.value} on ${chainLabel(chain.value)}`);
const description = computed(
  () => `Block ${raw.value} on ${chainLabel(chain.value)}. Hash, parent, timestamp, producer, gas and transaction count, read live through @agntn/explorers.`,
);

useSeo({
  title: title.value,
  description: description.value,
  type: "article",
  breadcrumbs: [
    { title: "Explorer", path: "/explorer" },
    { title: chainLabel(chain.value), path: `/explorer/block/${chain.value}/${raw.value}` },
  ],
});

useSeoMeta({ robots: "noindex, follow" });

const { loading, error, answer, load, reset } = useAnswer<BlockAnswer>("/api/block");

/** A new number means a new block: drop the old card first, or it sits under the new heading while the read runs. */
function read() {
  reset();
  if (known.value) void load({ chain: chain.value, number: number.value ?? undefined });
}

onMounted(read);
/** The previous and next links stay on this page, so a param change has to read again. */
watch([chain, raw], read);
</script>

<template>
  <ExplorerShell section="block" :title="chainLabel(chain)" :accent="`block ${raw}`" :chain="chain">
    <p v-if="!known" class="explorers-error">
      <span class="console-tag">Input</span
      ><span>That isn't a chain this package serves, or not a block number.</span>
    </p>
    <div v-else class="entity-stack">
      <p v-if="!served" class="explorers-note">
        <UIcon name="i-lucide-info" class="size-3.5" aria-hidden="true" />
        <span>No provider serves blocks on {{ chainLabel(chain) }}; the read below will say so.</span>
      </p>
      <ExplorerState :loading="loading" :error="error" label="Reading the block" />
      <ExplorerBlockCard v-if="answer" :answer="answer" />
      <ExplorerBlockTransactions v-if="answer && number !== null" :chain="chain" :number="number" />
    </div>
  </ExplorerShell>
</template>
