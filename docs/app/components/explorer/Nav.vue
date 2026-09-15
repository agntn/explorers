<script setup lang="ts">
const route = useRoute();

const links = [
  { label: "Search", to: "/explorer", icon: "i-solar-magnifier-linear", exact: true },
  { label: "Gas", to: "/explorer/gas", icon: "i-solar-gas-station-linear", exact: false },
  { label: "Providers", to: "/explorer/providers", icon: "i-solar-server-linear", exact: false },
] as const;

function isActive(link: (typeof links)[number]) {
  return link.exact ? route.path === link.to : route.path.startsWith(link.to);
}
</script>

<template>
  <nav aria-label="Explorer" class="explorers-explorer-nav">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="explorers-explorer-link"
      :class="{ 'explorers-explorer-link-active': isActive(link) }"
    >
      <UIcon :name="link.icon" class="size-3.5" />
      {{ link.label }}
    </NuxtLink>
    <NuxtLink to="/guide/explorer" class="explorers-explorer-link">
      <UIcon name="i-solar-book-2-linear" class="size-3.5" />
      How it works
    </NuxtLink>
  </nav>
</template>
