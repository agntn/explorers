<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ExplorersCallout kind="caution" :title="title"><slot mdc-unwrap="p" /></ExplorersCallout>
</template>
