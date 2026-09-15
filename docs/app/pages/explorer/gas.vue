<script setup lang="ts">
definePageMeta({ layout: "default" });

const title = "Gas";
const description =
  "Current fee suggestions on every chain with a provider that quotes them. In the provider's own unit: gwei on EVM chains, sat/vB on Bitcoin, litoshi/vB on Litecoin.";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [
    { title: "Explorer", path: "/explorer" },
    { title, path: "/explorer/gas" },
  ],
});

defineOgImage(
  "Docs",
  { headline: "Explorer", title, description },
  { alt: "Gas: fee suggestions on every chain that quotes them" },
);
</script>

<template>
  <ExplorerShell
    eyebrow="explorer · gas"
    title="Fees right now,"
    accent="every chain."
    description="getGasData on every chain with a provider that quotes fees. The unit is part of the answer, fields a provider doesn't quote are absent, and nothing here gets converted to a currency."
  >
    <ExplorerGasBoard />
  </ExplorerShell>
</template>
