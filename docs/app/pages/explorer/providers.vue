<script setup lang="ts">
definePageMeta({ layout: "default" });

const title = "Providers";
const description =
  "Which of the fifteen providers the docs worker holds a key for and what each one serves. Never the key itself, just configured or not.";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [
    { title: "Explorer", path: "/explorer" },
    { title, path: "/explorer/providers" },
  ],
});

defineOgImage(
  "Docs",
  { headline: "Explorer", title, description },
  { alt: "Providers: what the docs worker can answer" },
);
</script>

<template>
  <ExplorerShell
    eyebrow="explorer · providers"
    title="Who answers"
    accent="on this worker."
    description="The same list explorers_providers returns, read from this worker: every registered provider, whether it needs a key, whether the worker has one, and what it serves. A chain whose only provider has no key here answers 503. The library on your machine with the key answers fine, the worker just doesn't have it."
  >
    <ExplorerProvidersBoard />
  </ExplorerShell>
</template>
