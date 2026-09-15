<script setup lang="ts">
/** Previous and next for a list the worker pages; the parent owns the page number. */
defineProps<{ page: number; count: number; limit: number; loading: boolean }>();

const emit = defineEmits<{ change: [page: number] }>();
</script>

<template>
  <div class="flex items-center justify-between gap-3 border-t border-muted px-4 py-3">
    <span class="font-mono text-[11px] text-dimmed">page {{ page }} · {{ limit }} per page</span>
    <span class="flex items-center gap-1">
      <button
        type="button"
        class="explorers-copy"
        :disabled="page <= 1 || loading"
        aria-label="Previous page"
        @click="emit('change', page - 1)"
      >
        <UIcon name="i-solar-alt-arrow-left-linear" class="size-3.5" /> prev
      </button>
      <button
        type="button"
        class="explorers-copy"
        :disabled="count < limit || loading"
        aria-label="Next page"
        @click="emit('change', page + 1)"
      >
        next <UIcon name="i-solar-alt-arrow-right-linear" class="size-3.5" />
      </button>
    </span>
  </div>
</template>
