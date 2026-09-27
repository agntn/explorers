<script setup lang="ts">
import type { DetailAnswer } from "../../../../utils/wire";
import { addressPath, isIdentifier } from "../../../../utils/entities";
import { shortHash } from "../../../../utils/format";
import { chainInfo, chainLabel, providersFor } from "../../../../utils/providers";

definePageMeta({ layout: "default" });

const route = useRoute();

const chain = computed(() => String(route.params.chain ?? ""));
const hash = computed(() => String(route.params.hash ?? ""));
const known = computed(() => chainInfo(chain.value) !== undefined && isIdentifier(hash.value));
const served = computed(() => providersFor(chain.value, "txDetail").length > 0);

const title = computed(() => `Transaction ${shortHash(hash.value, 10, 6)} on ${chainLabel(chain.value)}`);
const description = computed(
  () => `Transaction ${hash.value} on ${chainLabel(chain.value)}. Sender, recipient, value, fee, status and token transfers, read live through @agntn/explorers.`,
);

useSeo({
  title: title.value,
  description: description.value,
  type: "article",
  breadcrumbs: [
    { title: "Explorer", path: "/explorer" },
    { title: chainLabel(chain.value), path: `/explorer/tx/${chain.value}/${hash.value}` },
  ],
});

useSeoMeta({ robots: "noindex, follow" });

const { loading, error, answer, load, reset } = useAnswer<DetailAnswer>("/api/tx-detail");

function read() {
  reset();
  if (known.value) void load({ chain: chain.value, hash: hash.value });
}

onMounted(read);
/** The search box stays on this page, so a new hash on the same chain has to read again. */
watch([chain, hash], read);
</script>

<template>
  <ExplorerShell section="tx" :title="chainLabel(chain)" accent="transaction" :chain="chain">
    <template #status>
      <p class="entity-id">{{ hash }}</p>
    </template>

    <p v-if="!known" class="explorers-error">
      <span class="console-tag">Input</span
      ><span>That isn't a chain this package serves, or not a hash the worker accepts.</span>
    </p>
    <div v-else class="entity-stack">
      <p v-if="!served" class="explorers-note">
        <UIcon name="i-lucide-info" class="size-3.5" aria-hidden="true" />
        <span
          >No provider serves single transactions on {{ chainLabel(chain) }}; the read below will say
          so. The history on an
          <NuxtLink :to="addressPath(chain, hash)" class="entity-link">address page</NuxtLink> still
          works.</span
        >
      </p>
      <ExplorerState :loading="loading" :error="error" label="Reading the transaction" />
      <ExplorerTransactionCard v-if="answer" :answer="answer" />
    </div>
  </ExplorerShell>
</template>
