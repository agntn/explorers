<script setup lang="ts">
import { version } from "../../../../package.json";

/** The frame every explorer page shares: the hero zone, the circuit into the search, then the page. */
defineProps<{
  /** What the page is, after `explorer` in the ID strip: `gas`, `address`, `tx`. */
  section?: string;
  title: string;
  accent: string;
  description?: string;
  chain?: string;
  /** The example chips under the search, on the hub. */
  examples?: boolean;
}>();
</script>

<template>
  <div class="explorers-landing not-prose">
    <header class="explorers-hero hero-page shell-hero">
      <div class="hero-zone">
        <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
        <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
        <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
        <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

        <p class="console-id">
          <span class="console-id-tag">ID</span>
          <span>explorer</span>
          <template v-if="section">
            <span class="console-id-sep" aria-hidden="true">/</span>
            <span>{{ section }}</span>
          </template>
          <span class="console-id-sep" aria-hidden="true">/</span>
          <span>@agntn/explorers v{{ version }}</span>
        </p>

        <h1 class="hero-title">
          {{ title }} <span>{{ accent }}</span>
        </h1>
        <p v-if="description" class="hero-lead">{{ description }}</p>
        <slot name="status" />
      </div>

      <div class="hero-instrument hero-instrument-keep">
        <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
          <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
          <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
          <path class="hero-circuit-seg" d="M96 38V48" />
          <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
        </svg>
        <span class="hero-circuit-tag" aria-hidden="true">input</span>
        <ExplorerSearch :chain="chain" :examples="examples" />
      </div>
    </header>

    <section class="explorers-section">
      <div class="shell-body">
        <slot />
      </div>
    </section>
  </div>
</template>

<style scoped>
.shell-hero {
  padding-top: 56px;
  padding-bottom: 56px;
}
.shell-body {
  width: 100%;
  max-width: var(--ui-container);
  margin-inline: auto;
  padding: 48px 2rem 72px;
}
@media (width >= 40rem) {
  .shell-body {
    padding-inline: 3rem;
  }
}
@media (width >= 64rem) {
  .shell-body {
    padding-inline: 4rem;
  }
}
</style>
