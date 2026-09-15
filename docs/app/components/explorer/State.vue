<script setup lang="ts">
/** The loading row and the failure card every explorer panel shows before it has an answer. */
defineProps<{ loading: boolean; error?: string; label: string }>();
</script>

<template>
  <p
    v-if="loading"
    class="explorers-frame flex items-center gap-2 rounded-xl px-5 py-4 text-sm text-muted"
  >
    <UIcon name="i-lucide-refresh-cw" class="size-4 animate-spin" />
    {{ label }}
  </p>
  <pre
    v-else-if="error"
    class="explorers-body explorers-frame rounded-xl"
    :style="{ color: 'var(--explorers-del)' }"
    >{{ error }}</pre
  >
</template>
