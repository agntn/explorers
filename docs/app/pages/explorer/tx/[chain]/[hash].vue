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

const { loading, error, answer, load } = useAnswer<DetailAnswer>("/api/tx-detail");

onMounted(() => {
  if (known.value) void load({ chain: chain.value, hash: hash.value });
});
</script>

<template>
  <ExplorerShell eyebrow="explorer · transaction" :title="chainLabel(chain)" accent="transaction" :chain="chain" compact>
    <template #status>
      <p class="explorers-enter explorers-enter-2 mx-auto mt-4 max-w-2xl font-mono text-sm break-all text-muted">
        {{ hash }}
      </p>
    </template>

    <div v-if="!known" class="explorers-frame rounded-xl px-5 py-6 text-sm text-muted">
      That isn't a chain this package serves, or not a hash the worker accepts.
    </div>
    <div v-else class="space-y-5">
      <p v-if="!served" class="flex items-start gap-2 text-sm text-dimmed">
        <UIcon name="i-solar-info-circle-linear" class="mt-0.5 size-4 shrink-0 text-primary" />
        <span>No provider serves single transactions on {{ chainLabel(chain) }}; the read below will say so. The history on an <NuxtLink :to="addressPath(chain, hash)" class="text-primary hover:underline">address page</NuxtLink> still works.</span>
      </p>
      <ExplorerState :loading="loading" :error="error" label="Reading the transaction…" />
      <ExplorerTransactionCard v-if="answer" :answer="answer" />
    </div>
  </ExplorerShell>
</template>
