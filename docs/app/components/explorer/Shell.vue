<script setup lang="ts">
/** The frame every explorer page shares: the hero, the search box and the section nav, then the page in a slot. */
defineProps<{
  eyebrow: string;
  title: string;
  accent: string;
  description?: string;
  chain?: string;
  /** The tall search with examples on the hub, the compact one everywhere else. */
  wide?: boolean;
  /** Entity pages: shorter hero. */
  compact?: boolean;
}>();
</script>

<template>
  <div class="explorers-landing not-prose">
    <ToolHero :eyebrow="eyebrow" :title="title" :accent="accent" :description="description" :compact="compact">
      <slot name="status" />
      <div
        class="explorers-enter explorers-enter-3 mx-auto"
        :class="[compact ? 'mt-6' : 'mt-8', wide ? 'max-w-5xl' : 'max-w-4xl']"
      >
        <ExplorerSearch :chain="chain" :compact="!wide" :examples="wide" />
      </div>
      <ExplorerNav />
    </ToolHero>

    <section class="explorers-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 sm:px-12 lg:px-16" :class="compact ? 'py-8' : 'py-12'">
        <slot />
      </div>
    </section>
  </div>
</template>
