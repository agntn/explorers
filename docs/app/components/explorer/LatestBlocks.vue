<script setup lang="ts">
import type { TipBlock } from "../../utils/wire";
import { addressPath, blockPath } from "../../utils/entities";
import { ago, bytes, shortHash } from "../../utils/format";

const props = defineProps<{ chain: string; blocks: TipBlock[]; now: number }>();

/** Gas used as a whole percent of the limit, or null when the explorer sent no usable numbers. */
function gasShare(block: TipBlock): number | null {
  if (!block.gasUsed || !block.gasLimit) return null;
  const used = Number(block.gasUsed);
  const limit = Number(block.gasLimit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round((used / limit) * 100);
}

/** Derived once per feed, not once per clock tick. */
const rows = computed(() =>
  props.blocks.map((block) => ({ block, gas: gasShare(block), size: bytes(block.size) })),
);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <UIcon name="i-solar-box-minimalistic-linear" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">Latest blocks</span>
      <span class="ms-auto font-mono text-[11px] text-dimmed">{{ blocks.length }} newest</span>
    </div>
    <ol class="divide-y divide-muted">
      <li v-for="{ block, gas, size } in rows" :key="block.hash" class="explorers-derive flex items-center gap-3 px-4 py-2.5">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-[10px] text-dimmed">Bk</span>
        <div class="min-w-0 flex-1">
          <p class="flex items-baseline gap-2">
            <NuxtLink :to="blockPath(chain, block.number)" class="font-mono text-[13px] text-highlighted hover:text-primary">{{ block.number }}</NuxtLink>
            <span class="font-mono text-[11px] text-dimmed" :title="block.timestamp">{{ ago(block.timestamp, now) }}</span>
          </p>
          <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
            <template v-if="block.miner">
              by <NuxtLink :to="addressPath(chain, block.miner)" class="text-muted hover:text-primary" :title="block.miner">{{ shortHash(block.miner, 8, 6) }}</NuxtLink>
            </template>
            <template v-else-if="block.producer">by {{ block.producer }}</template>
            <template v-else>{{ shortHash(block.hash, 10, 6) }}</template>
            {{ size ? ` · ${size}` : "" }}
          </p>
        </div>
        <span class="shrink-0 text-right">
          <span class="block font-mono text-[13px] text-highlighted">{{ block.txCount }} txs</span>
          <span v-if="gas !== null" class="block font-mono text-[11px] text-dimmed">{{ gas }}% gas</span>
        </span>
      </li>
    </ol>
  </div>
</template>
