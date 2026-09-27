<script setup lang="ts">
/** A transaction status: success stays quiet, a failure red, anything pending bright. */
const props = defineProps<{ status: string }>();

const look = computed(() => {
  if (props.status === "failed") return { color: "error", variant: "outline" } as const;
  if (props.status === "success") return { color: "neutral", variant: "outline" } as const;
  return { color: "neutral", variant: "subtle" } as const;
});
</script>

<template>
  <UBadge :label="status" :color="look.color" :variant="look.variant" />
</template>
