<script setup lang="ts">
import { dateTime } from "../../utils/format";
import { providerLabel } from "../../utils/providers";

/** The line over a list: what it holds, which provider answered, when. */
defineProps<{ summary: string; provider: string; fetchedAt: string }>();
</script>

<template>
  <p class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-2.5 font-mono text-[11px] text-dimmed">
    <span>{{ summary }}</span>
    <span>· via {{ providerLabel(provider) }}</span>
    <span class="ms-auto">fetched {{ dateTime(fetchedAt) }}</span>
  </p>
</template>
