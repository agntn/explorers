<script setup lang="ts">
import { shortHash } from "../../utils/format";

/** A hash or an address shortened on screen, whole in the tooltip, a link when there's somewhere to go. */
const props = withDefaults(
  defineProps<{ value: string; to?: string; head?: number; tail?: number; strong?: boolean }>(),
  { to: undefined, head: 8, tail: 6, strong: false },
);

const text = computed(() => shortHash(props.value, props.head, props.tail));
</script>

<template>
  <UTooltip :text="value">
    <NuxtLink v-if="to" :to="to" class="hash" :class="{ 'hash-strong': strong }">{{ text }}</NuxtLink>
    <span v-else class="hash" :class="{ 'hash-strong': strong }">{{ text }}</span>
  </UTooltip>
</template>

<style scoped>
.hash {
  font-family: var(--font-mono);
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.hash-strong {
  color: var(--ui-text-highlighted);
}
a.hash:hover {
  color: var(--console-accent);
}
a.hash:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
</style>
