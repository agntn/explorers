<script setup lang="ts">
/** The loading line and the failure line every explorer panel shows before it has an answer. */
defineProps<{ loading: boolean; error?: string; label: string }>();
</script>

<template>
  <p v-if="loading" class="explorers-note" role="status">
    <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />
    {{ label }}
  </p>
  <UAlert
    v-else-if="error"
    color="error"
    variant="outline"
    icon="i-lucide-circle-x"
    :title="error"
    role="alert"
  />
</template>
