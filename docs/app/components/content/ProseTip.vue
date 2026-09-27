<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <ExplorersCallout kind="tip" :title="title"><slot mdc-unwrap="p" /></ExplorersCallout>
</template>
