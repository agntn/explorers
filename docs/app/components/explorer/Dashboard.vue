<script setup lang="ts">
import type { TipAnswer } from "../../utils/wire";
import { TIP_CHAINS, hasTip } from "#shared/tip-chains";
import { ago } from "../../utils/format";
import { CHAINS, chainIcon, chainInfo, chainLabel } from "../../utils/providers";

/** The live pulpit of one chain: stats, latest blocks, latest transactions, refreshed every fifteen seconds. */
const props = defineProps<{ chain: string }>();
const emit = defineEmits<{ pick: [chain: string] }>();

/** Chains with a live feed first, in the order the worker serves them, then the rest. */
const tabs = [
  ...TIP_CHAINS.map((key) => chainInfo(key)).filter((chain) => chain !== undefined),
  ...CHAINS.filter((chain) => !hasTip(chain.key)),
];

const { loading, error, answer: tip, load, reset } = useAnswer<TipAnswer>("/api/tip");
const now = ref(Date.now());
const paused = ref(false);

let refreshTimer: number | undefined;
let clockTimer: number | undefined;

function refresh() {
  if (!hasTip(props.chain)) return;
  void load({ chain: props.chain }, true);
}

function start() {
  stop();
  clockTimer = window.setInterval(() => {
    if (!document.hidden) now.value = Date.now();
  }, 5000);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  refreshTimer = window.setInterval(() => {
    if (!paused.value && !document.hidden) refresh();
  }, 15_000);
}

function stop() {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  refreshTimer = undefined;
  clockTimer = undefined;
}

watch(
  () => props.chain,
  () => {
    reset();
    refresh();
  },
);

onMounted(() => {
  refresh();
  start();
});

onUnmounted(stop);

const feedless = computed(() => !hasTip(props.chain));
</script>

<template>
  <section
    class="tool-console console-wide dashboard"
    aria-label="Chain tip"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Log</span>tip(<span class="dashboard-str">"{{ chain }}"</span
        >)</span
      >
      <span class="console-meta">{{
        feedless ? "no feed" : tip ? `via ${tip.source} · every 15 s` : "reading"
      }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span
        :key="tip?.fetchedAt ?? chain"
        class="console-cursor"
        :class="{ 'console-cursor-busy': loading }"
      />
    </div>

    <div class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Chain <span aria-hidden="true">[ live feed first ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <div class="dashboard-chips" role="group" aria-label="Chain">
        <UButton
          v-for="row in tabs"
          :key="row.key"
          :color="chain === row.key ? 'primary' : 'neutral'"
          variant="soft"
          :icon="row.icon"
          :label="row.name"
          :aria-pressed="chain === row.key"
          @click="emit('pick', row.key)"
        />
      </div>
    </div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="chain" :icon="chainIcon(chain)" />
        <div class="console-name">
          <span class="console-label"
            >Chain / <span class="console-label-key">{{ chain }}</span></span
          >
          <h3>{{ chainLabel(chain) }}</h3>
          <p class="console-about">
            <template v-if="feedless"
              >No live feed. Its providers answer one address, one hash or one block at a time, and
              none of them publishes the newest blocks without a key, so the search above is the way
              in.</template
            >
            <template v-else
              >The tip as the chain's own explorer lists it, straight from its API, refreshed every
              fifteen seconds while nothing holds it still.</template
            >
          </p>
        </div>
      </div>

      <div v-if="tip" class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Height</dt>
            <dd class="console-accent">{{ tip.height }}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{{ tip.source }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ ago(tip.fetchedAt, now) }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div v-if="!feedless && (error || (loading && !tip))" class="explorers-band">
      <ExplorerState
        :loading="loading && !tip"
        :error="error"
        :label="`Reading the ${chainLabel(chain)} tip`"
      />
    </div>

    <template v-if="tip && !feedless">
      <div v-if="tip.stats.length" class="explorers-band">
        <p class="console-label console-rule-title">
          <span
            >Stats <span aria-hidden="true">[ as {{ tip.source }} counts them ]</span></span
          >
          <span class="console-mark" aria-hidden="true" />
        </p>
        <ExplorerStatTiles :stats="tip.stats" />
      </div>
      <div class="dashboard-feeds">
        <ExplorerLatestBlocks :chain="chain" :blocks="tip.blocks" :now="now" />
        <ExplorerLatestTransactions
          :chain="chain"
          :transactions="tip.transactions"
          :symbol="tip.symbol"
          :fee-unit="tip.feeUnit"
          :now="now"
          :pending="tip.source === 'mempool'"
        />
      </div>
    </template>

    <footer class="console-footer console-footer-plain">
      <span>list endpoints, outside the library</span>
      <ul class="console-links">
        <li>
          <NuxtLink to="/guide/explorer"><span aria-hidden="true">→ </span>How it works</NuxtLink>
        </li>
      </ul>
    </footer>
  </section>
</template>

<style scoped>
.dashboard-str {
  color: var(--shiki-token-string);
}
.dashboard-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dashboard-feeds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--console-line);
}
.dashboard-feeds > * {
  padding-top: 18px;
}
.dashboard-feeds > * + * {
  box-shadow: inset 1px 0 0 var(--console-line);
}
@media (width < 64rem) {
  .dashboard-feeds {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-feeds > * + * {
    box-shadow: inset 0 1px 0 var(--console-line);
  }
}
</style>
