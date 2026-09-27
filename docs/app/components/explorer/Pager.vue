<script setup lang="ts">
/** Previous and next for a list the worker pages; the parent owns the page number. */
defineProps<{ page: number; count: number; limit: number; loading: boolean }>();

const emit = defineEmits<{ change: [page: number] }>();
</script>

<template>
  <div class="console-controls" aria-label="Pages">
    <UButton
      color="neutral"
      variant="subtle"
      square
      icon="i-lucide-chevron-left"
      aria-label="Previous page"
      :disabled="page <= 1 || loading"
      @click="emit('change', page - 1)"
    />
    <span>Page {{ page }}</span>
    <UButton
      color="neutral"
      variant="subtle"
      square
      icon="i-lucide-chevron-right"
      aria-label="Next page"
      :disabled="count < limit || loading"
      @click="emit('change', page + 1)"
    />
  </div>
</template>
