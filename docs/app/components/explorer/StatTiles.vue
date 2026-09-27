<script setup lang="ts">
import type { TipStat } from "../../utils/wire";

defineProps<{ stats: TipStat[] }>();
</script>

<template>
  <!-- The explorer's own counters as a census: label, a tabular value, the hint it sent under it. -->
  <dl class="census">
    <div v-for="stat in stats" :key="stat.label">
      <dt>{{ stat.label }}</dt>
      <dd class="census-value">{{ stat.value }}</dd>
      <dd v-if="stat.hint" class="census-hint">{{ stat.hint }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.census {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
  gap: 0;
  margin: 0;
}
.census > div {
  padding: 4px 14px 6px;
  min-width: 0;
  box-shadow: inset 1px 0 0 var(--console-line);
}
.census dt {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.census dd {
  margin: 0;
}
.census-value {
  margin-top: 4px !important;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.census-hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
</style>
