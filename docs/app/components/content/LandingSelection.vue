<script setup lang="ts">
import { LANDING_SAMPLES, type ExplorerSample } from "../../utils/landing-fixtures";
import { PROVIDERS, providersFor, type ProviderInfo } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

/**
 * The order `resolveProvider()` walks for a balance on a chain: configured keys first, then keyless
 * providers, then any registry entry that serves the chain. The docs worker holds no keys, so the
 * keyed rows are what would jump to the top on a machine that has them.
 */
function ranking(chain: string): { provider: ProviderInfo; tier: string }[] {
  const candidates = providersFor(chain, "balances");
  return [
    ...candidates
      .filter((provider) => provider.envVars.length === 0)
      .map((provider) => ({ provider, tier: "keyless" })),
    ...candidates
      .filter((provider) => provider.envVars.length > 0)
      .map((provider) => ({ provider, tier: provider.optionalKey ? "optional key" : "needs a key" })),
  ];
}

const rows = computed(() => ranking(props.sample.chain));

/** Every sample reserves the rows of the longest ranking, so the panel keeps one height. */
const DEPTH = Math.max(...LANDING_SAMPLES.map((sample) => ranking(sample.chain).length));
const spare = computed(() => Math.max(0, DEPTH - rows.value.length));

/** With every key in the environment the first keyed candidate wins; a chain without one keeps its keyless pick. */
const keyed = computed(() => {
  const candidate = providersFor(props.sample.chain, "balances").find(
    (provider) => provider.envVars.length > 0,
  );
  return candidate ?? rows.value[0]?.provider;
});

const others = computed(() => PROVIDERS.length - providersFor(props.sample.chain, "balances").length);
</script>

<template>
  <section class="tool-console landing-selection" aria-label="Provider selection">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>resolveProvider(undefined,
        <span class="tok-str">"{{ sample.chain }}"</span>)</span
      >
      <span class="console-meta">balances · no keys set</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.chain" class="console-cursor" />
    </div>

    <div class="selection-body">
      <p class="console-label console-rule-title">
        <span>Ranking <span aria-hidden="true">[ keys · keyless · the rest ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ol :key="sample.chain" class="selection-leads console-animate">
        <li
          v-for="(row, index) in rows"
          :key="row.provider.key"
          class="console-lead"
          :class="{ 'selection-picked': row.provider.key === sample.provider }"
          :style="{ animationDelay: `${index * 60}ms` }"
        >
          <span class="console-tag">{{ String(index + 1).padStart(2, "0") }}</span>
          <NuxtLink :to="row.provider.to" class="selection-name"
            >{{ row.provider.label }}<span class="selection-dim"> "{{ row.provider.key }}"</span></NuxtLink
          >
          <span class="console-leader console-draw" aria-hidden="true" />
          <span class="selection-tier">{{ row.tier }}</span>
        </li>
        <li v-for="index in spare" :key="`spare-${index}`" class="console-lead selection-spare" aria-hidden="true">
          <span class="console-tag">00</span>
        </li>
      </ol>
      <p class="console-label console-rule-title selection-keys-title">
        <span>With keys set <span aria-hidden="true">[ configured first ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <div class="console-readout selection-keys">
        <dl class="console-readout-rows">
          <div>
            <dt>Picks</dt>
            <dd class="console-accent">{{ keyed?.label ?? "none" }}</dd>
          </div>
          <div>
            <dt>Env</dt>
            <dd :class="{ 'selection-dim': !keyed?.envVars.length }">
              {{ keyed?.envVars.length ? keyed.envVars.join(" · ") : "nothing to set" }}
            </dd>
          </div>
        </dl>
      </div>
      <p class="selection-note">
        {{ others }} other providers don't serve {{ sample.chain }} and are never asked. A rate or
        plan limit on the first moves the read to the next one, once.
      </p>
    </div>

    <footer class="console-footer console-footer-plain">
      <span>ranked without importing a provider</span>
      <span class="console-meta">create() loads the winner</span>
    </footer>
  </section>
</template>

<style scoped>
.selection-body {
  padding: 16px 20px 18px;
}
.selection-body > .console-rule-title {
  margin: 0 0 10px;
}
.selection-leads {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.selection-leads > .console-lead {
  margin: 0;
  flex-wrap: nowrap;
}
.selection-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.selection-name:hover {
  color: var(--console-accent);
}
.selection-dim {
  color: var(--ui-text-dimmed);
}
.selection-tier {
  flex: none;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.selection-picked > .console-tag {
  color: var(--console-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--console-accent) 55%, transparent);
}
.selection-picked .selection-tier {
  color: var(--console-accent);
}
.selection-spare {
  visibility: hidden;
}
.selection-keys-title {
  margin: 16px 0 10px;
}
.selection-keys .console-readout-rows > div {
  grid-template-columns: 5rem minmax(0, 1fr);
}
.selection-note {
  margin: 14px 0 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ui-text-muted);
}
@media (width < 400px) {
  .selection-body {
    padding-inline: 14px;
  }
  .selection-dim,
  .selection-leads .console-leader {
    display: none;
  }
  .selection-tier {
    margin-left: auto;
  }
}
</style>
