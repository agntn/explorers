<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ExplorersCallout kind="note" :title="title"><slot mdc-unwrap="p" /></ExplorersCallout>
</template>
