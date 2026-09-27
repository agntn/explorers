<script setup lang="ts">
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_METHODS,
  CAPABILITY_SHORT,
  type Capability,
} from "../utils/providers";

const props = defineProps<{
  /** The operations that are served; every other cell stays dim. */
  served: readonly Capability[];
  /** What serves them, for the tooltip: a provider name, or "a provider" on a chain row. */
  subject: string;
}>();

const cells = computed(() =>
  CAPABILITIES.map((capability) => ({
    capability,
    short: CAPABILITY_SHORT[capability],
    served: props.served.includes(capability),
    note: `${CAPABILITY_LABELS[capability]} · ${CAPABILITY_METHODS[capability]} ${
      props.served.includes(capability) ? "served by" : "absent on"
    } ${props.subject}`,
  })),
);
</script>

<template>
  <!-- One boxed cell per operation of the Provider contract, in registry order; the served ones lit. -->
  <ul class="capability-cells" :aria-label="`Operations on ${subject}`">
    <li v-for="cell in cells" :key="cell.capability">
      <UTooltip :text="cell.note">
        <span class="capability-cell" :class="{ 'capability-cell-on': cell.served }"
          >{{ cell.short
          }}<span class="sr-only">: {{ cell.served ? "served" : "absent" }}</span></span
        >
      </UTooltip>
    </li>
  </ul>
</template>

<style scoped>
.capability-cells {
  container-type: inline-size;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.capability-cell {
  display: inline-block;
  min-width: 2rem;
  padding: 1px 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  letter-spacing: 0.06em;
  text-align: center;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ui-text-dimmed) 70%, var(--ui-bg));
  box-shadow: inset 0 0 0 1px var(--ui-border-muted);
}
@container (width < 19rem) {
  .capability-cell {
    min-width: 0;
    padding-inline: 2px;
    letter-spacing: 0.02em;
  }
}
.capability-cell-on {
  color: var(--ui-text-highlighted);
  box-shadow:
    inset 0 -2px 0 color-mix(in srgb, var(--console-accent) 70%, transparent),
    inset 0 0 0 1px var(--console-line);
}
</style>
