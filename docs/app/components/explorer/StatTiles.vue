<script setup lang="ts">
import type { TipStat } from "../../utils/wire";
import { cellBorders } from "../../utils/format";

defineProps<{ stats: TipStat[] }>();
</script>

<template>
  <dl class="explorers-frame grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3 lg:grid-cols-6">
    <div
      v-for="(stat, index) in stats"
      :key="stat.label"
      class="border-muted px-4 py-3.5"
      :class="cellBorders(index, 3, 6)"
    >
      <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">{{ stat.label }}</dt>
      <dd class="mt-1 font-mono text-base text-highlighted whitespace-nowrap">{{ stat.value }}</dd>
      <dd v-if="stat.hint" class="mt-0.5 font-mono text-[11px] text-dimmed">{{ stat.hint }}</dd>
    </div>
  </dl>
</template>
