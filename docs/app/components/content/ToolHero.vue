<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  accent: string;
  description?: string;
  /** Entity pages: a shorter hero, so the data starts above the fold. */
  compact?: boolean;
}>();
</script>

<template>
  <header
    class="explorers-hero mx-auto w-full max-w-[var(--ui-container)] px-8 text-center sm:px-12 lg:px-16"
    :class="compact ? 'pt-10 pb-8' : 'pt-16 pb-10'"
  >
    <p class="explorers-eyebrow justify-center">{{ eyebrow }}</p>
    <h1
      class="explorers-enter mx-auto mt-4 max-w-3xl leading-[1.1] font-medium tracking-tight text-highlighted"
      :class="compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl lg:text-[3rem]'"
    >
      {{ title }} <span class="text-primary">{{ accent }}</span>
    </h1>
    <p
      v-if="description"
      class="explorers-enter explorers-enter-2 mx-auto mt-5 max-w-xl text-base leading-7 text-muted"
    >
      {{ description }}
    </p>
    <slot />
  </header>
</template>
