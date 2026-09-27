<script setup lang="ts">
/** Previous and next for a list the worker pages; the parent owns the page number. */
defineProps<{ page: number; count: number; limit: number; loading: boolean }>();

const emit = defineEmits<{ change: [page: number] }>();
</script>

<template>
  <div class="console-controls pager" aria-label="Pages">
    <button
      type="button"
      aria-label="Previous page"
      :disabled="page <= 1 || loading"
      @click="emit('change', page - 1)"
    >
      <UIcon name="i-lucide-chevron-left" />
    </button>
    <span>Page {{ page }}</span>
    <button
      type="button"
      aria-label="Next page"
      :disabled="count < limit || loading"
      @click="emit('change', page + 1)"
    >
      <UIcon name="i-lucide-chevron-right" />
    </button>
  </div>
</template>

<style scoped>
.pager button:disabled {
  cursor: default;
  opacity: 0.4;
}
</style>
