<script setup lang="ts">
import { statusClass } from "../../utils/format";

defineProps<{ status: string }>();
</script>

<template>
  <span class="explorers-state" :class="statusClass(status)">{{ status }}</span>
</template>
