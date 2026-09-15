<script setup lang="ts">
import type { ProvidersAnswer } from "../../utils/wire";
import { CAPABILITY_LABELS, PROVIDERS, chainLabel, providerIcon, providerInfo, providerLabel } from "../../utils/providers";

const { loading, error, answer, load } = useAnswer<ProvidersAnswer>("/api/providers");

onMounted(() => void load({}));

const configured = computed(() => answer.value?.providers.filter((row) => row.configured).length ?? 0);

/** Each row with its snapshot facts looked up once. */
const rows = computed(() =>
  (answer.value?.providers ?? []).map((row) => {
    const info = providerInfo(row.provider);
    return {
      ...row,
      auth: info?.auth ?? "",
      chains: (info?.chains ?? []).map(chainLabel).join(", "),
      capabilities: (info?.capabilities ?? []).map((capability) => CAPABILITY_LABELS[capability]).join(", ") || "none",
    };
  }),
);
</script>

<template>
  <div class="space-y-4">
    <ExplorerState :loading="loading" :error="error" label="Asking the worker which keys it holds…" />
    <div v-if="answer" class="explorers-frame overflow-hidden rounded-xl">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-muted px-4 py-3">
        <p class="font-mono text-xs text-muted">
          the docs worker · @agntn/explorers {{ answer.version }} · {{ configured }} of {{ PROVIDERS.length }} providers can answer
        </p>
        <p class="font-mono text-[11px] text-dimmed">configured means the worker holds the key; never the key itself</p>
      </div>
      <div class="explorers-table-wrap">
        <table class="explorers-table">
          <thead>
            <tr>
              <th>provider</th>
              <th>auth</th>
              <th>on the worker</th>
              <th>chains</th>
              <th>capabilities</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.provider">
              <td>
                <NuxtLink :to="`/providers/${row.provider}`" class="inline-flex items-center gap-2 text-sm text-highlighted hover:text-primary">
                  <UIcon :name="providerIcon(row.provider)" class="size-4 text-muted" />
                  {{ providerLabel(row.provider) }}
                  <span class="font-mono text-[11px] text-dimmed">"{{ row.provider }}"</span>
                </NuxtLink>
              </td>
              <td class="font-mono text-xs text-muted">{{ row.auth }}</td>
              <td>
                <span class="explorers-state" :class="row.configured ? 'explorers-state-ok' : 'explorers-state-warn'">{{
                  row.keyless ? "keyless" : row.configured ? "configured" : "no key"
                }}</span>
              </td>
              <td class="text-xs text-muted">{{ row.chains }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
