<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { PROVIDERS, providerLabel, providersFor } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

/**
 * The order `resolveProvider()` walks for a balance on the sample's chain: configured keys first,
 * then keyless providers, then any registry entry that serves the chain. The docs worker holds no
 * keys, so the keyed rows are what would jump to the top on a machine that has them.
 */
const rows = computed(() => {
  const candidates = providersFor(props.sample.chain, "balances");
  const keyless = candidates.filter((provider) => provider.envVars.length === 0);
  const keyed = candidates.filter((provider) => provider.envVars.length > 0);
  return [
    ...keyless.map((provider) => ({ provider, tier: "keyless" })),
    ...keyed.map((provider) => ({
      provider,
      tier: provider.optionalKey ? "optional key" : "needs a key",
    })),
  ];
});

const others = computed(
  () => PROVIDERS.length - providersFor(props.sample.chain, "balances").length,
);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="font-mono text-xs text-muted">
        <span class="text-dimmed">resolveProvider</span>
        <Transition name="explorers-roll" mode="out-in">
          <span :key="sample.chain" class="ms-2 text-highlighted"
            >(undefined, "{{ sample.chain }}", "balances")</span
          >
        </Transition>
      </p>
      <p class="font-mono text-[11px] text-dimmed">ranking without keys</p>
    </div>
    <div class="explorers-rank p-4">
      <TransitionGroup name="explorers-roll">
        <div
          v-for="(row, index) in rows"
          :key="row.provider.key"
          class="explorers-rank-row"
          :class="{ 'explorers-rank-row-active': row.provider.key === sample.provider }"
        >
          <span class="explorers-rank-index">{{ index + 1 }}</span>
          <span class="truncate">
            {{ providerLabel(row.provider.key) }}
            <span class="text-dimmed">"{{ row.provider.key }}"</span>
          </span>
          <span class="text-[10px] tracking-[0.08em] text-dimmed uppercase">{{ row.tier }}</span>
        </div>
      </TransitionGroup>
      <p class="mt-2 font-mono text-[11px] text-dimmed">
        {{ others }} other providers don't serve {{ sample.chain }} and are never asked.
        A rate limit or a plan restriction on the first one moves the read to the next, once.
      </p>
    </div>
  </div>
</template>
