<script setup lang="ts">
/** The loading line and the failure line every explorer panel shows before it has an answer. */
defineProps<{ loading: boolean; error?: string; label: string }>();
</script>

<template>
  <p v-if="loading" class="explorers-note" role="status">
    <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />
    {{ label }}
  </p>
  <p v-else-if="error" class="explorers-error" role="alert">
    <span class="console-tag">Error</span><span class="state-text">{{ error }}</span>
  </p>
</template>

<style scoped>
.state-text {
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
