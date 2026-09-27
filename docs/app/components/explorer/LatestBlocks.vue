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
  <div class="feed">
    <p class="console-label console-rule-title">
      <span>Blocks <span aria-hidden="true">[ {{ blocks.length }} newest ]</span></span>
      <span class="console-mark" aria-hidden="true" />
    </p>
    <ol class="explorers-rows feed-rows console-animate">
      <li v-for="({ block, gas, size }, index) in rows" :key="block.hash" :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }">
        <NuxtLink :to="blockPath(chain, block.number)" class="explorers-value">{{
          block.number
        }}</NuxtLink>
        <UTooltip :text="block.timestamp">
          <span class="explorers-dim feed-age">{{ ago(block.timestamp, now) }}</span>
        </UTooltip>
        <span class="explorers-clip feed-sub">
          <template v-if="block.miner">
            by
            <UTooltip :text="block.miner">
              <NuxtLink :to="addressPath(chain, block.miner)" class="feed-link">{{
                shortHash(block.miner, 8, 6)
              }}</NuxtLink>
            </UTooltip>
          </template>
          <template v-else-if="block.producer">by {{ block.producer }}</template>
          <template v-else>{{ shortHash(block.hash, 10, 6) }}</template>
          <span v-if="size" class="explorers-dim"> · {{ size }}</span>
          <span v-if="gas !== null" class="explorers-dim"> · {{ gas }}% gas</span>
        </span>
        <span class="feed-end"
          ><span class="explorers-value">{{ block.txCount }}</span
          ><span class="explorers-dim"> txs</span></span
        >
      </li>
    </ol>
  </div>
</template>
