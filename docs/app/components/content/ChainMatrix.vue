<script setup lang="ts">
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  CHAINS,
  PROVIDERS,
  providerLabel,
  type Capability,
} from "../../utils/providers";

/** Which providers serve a chain, and which capabilities any of them cover; the snapshot never changes, so once at import. */
const rows = CHAINS.map((chain) => {
  const providers = PROVIDERS.filter((provider) => provider.chains.includes(chain.key));
  const covered = new Set<Capability>(providers.flatMap((provider) => provider.capabilities));
  return { chain, providers, covered };
});
</script>

<template>
  <div class="explorers-frame not-prose my-6 overflow-hidden rounded-xl">
    <div class="explorers-table-wrap">
      <table class="explorers-table explorers-table-tight">
        <thead>
          <tr>
            <th>chain</th>
            <th>providers</th>
            <th v-for="capability in CAPABILITIES" :key="capability" class="explorers-th-up text-center">
              <span>{{ CAPABILITY_LABELS[capability] }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.chain.key">
            <td>
              <span class="inline-flex items-center gap-2 text-sm whitespace-nowrap text-highlighted">
                <UIcon :name="row.chain.icon" class="size-4 text-muted" />
                {{ row.chain.name }}
                <span class="font-mono text-[11px] text-dimmed">{{ row.chain.key }}</span>
              </span>
            </td>
            <td class="min-w-[11rem]">
              <span class="flex flex-wrap gap-1">
                <NuxtLink
                  v-for="provider in row.providers"
                  :key="provider.key"
                  :to="provider.to"
                  class="explorers-chip explorers-chip-small whitespace-nowrap hover:text-highlighted"
                  >{{ providerLabel(provider.key) }}</NuxtLink
                >
              </span>
            </td>
            <td
              v-for="capability in CAPABILITIES"
              :key="capability"
              class="text-center font-mono text-xs"
            >
              <UIcon
                v-if="row.covered.has(capability)"
                name="i-solar-unread-linear"
                class="size-4 text-primary"
                :aria-label="`${CAPABILITY_LABELS[capability]} available`"
              />
              <span v-else class="text-dimmed">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
