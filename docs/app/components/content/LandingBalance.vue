<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { dateTime, groupDigits, shortHash, trimDecimals } from "../../utils/format";
import { chainIcon, chainLabel, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const balance = computed(() => props.sample.balance);

const formatted = computed(() => trimDecimals(balance.value.balanceFormatted, 8));

/** UTXO explorers add cumulative totals; the row only appears when the provider sent them. */
const totals = computed(() =>
  balance.value.funded !== undefined && balance.value.spent !== undefined
    ? { funded: balance.value.funded, spent: balance.value.spent }
    : null,
);
</script>

<template>
  <div
    class="explorers-frame overflow-hidden rounded-xl"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
  >
    <div class="flex items-center gap-3 border-b border-muted px-4 py-3">
      <UIcon :name="chainIcon(sample.chain)" class="size-4 text-primary" />
      <Transition name="explorers-roll" mode="out-in">
        <span :key="sample.input" class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">
          {{ sample.input }}
        </span>
      </Transition>
      <span class="explorers-state" :class="sample.live ? 'explorers-state-ok' : ''">
        {{ sample.live ? "live" : "sample" }}
      </span>
      <span class="flex items-center gap-1">
        <button
          type="button"
          class="explorers-copy"
          aria-label="Previous address"
          @click="emit('step', -1)"
        >
          <UIcon name="i-solar-alt-arrow-left-linear" class="size-3.5" />
        </button>
        <button
          type="button"
          class="explorers-copy"
          aria-label="Next address"
          @click="emit('step', 1)"
        >
          <UIcon name="i-solar-alt-arrow-right-linear" class="size-3.5" />
        </button>
      </span>
    </div>
    <div class="px-4 py-5">
      <p class="explorers-eyebrow">balanceFormatted</p>
      <p :key="balance.balance" class="explorers-amount explorers-derive mt-2 text-highlighted">
        {{ formatted }} <span class="text-primary">{{ balance.symbol }}</span>
      </p>
      <p class="mt-2 font-mono text-[11px] text-dimmed">
        balance "{{ groupDigits(balance.balance) }}" · a string in the smallest unit
      </p>
    </div>
    <dl class="explorers-kv border-t border-muted">
      <dt>chain</dt>
      <dd class="font-mono text-[13px]">
        {{ balance.chain }} <span class="text-dimmed">· {{ chainLabel(balance.chain) }}</span>
      </dd>
      <dt>provider</dt>
      <dd class="font-mono text-[13px]">
        {{ sample.provider }} <span class="text-dimmed">· {{ providerLabel(sample.provider) }}</span>
      </dd>
      <dt>address</dt>
      <dd class="font-mono text-[13px]" :title="balance.address">
        {{ shortHash(balance.address, 12, 8) }}
      </dd>
      <template v-if="totals">
        <dt>funded</dt>
        <dd class="font-mono text-[13px]">{{ groupDigits(totals.funded) }}</dd>
        <dt>spent</dt>
        <dd class="font-mono text-[13px]">{{ groupDigits(totals.spent) }}</dd>
      </template>
      <dt>blockNumber</dt>
      <dd class="font-mono text-[13px]">
        {{ balance.blockNumber === null ? "null" : balance.blockNumber }}
      </dd>
      <dt>fetchedAt</dt>
      <dd class="font-mono text-[13px]">{{ dateTime(balance.fetchedAt) }}</dd>
    </dl>
  </div>
</template>
