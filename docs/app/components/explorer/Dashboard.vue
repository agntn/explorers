<script setup lang="ts">
import type { TipAnswer } from "../../utils/wire";
import { hasTip } from "#shared/tip-chains";
import { ago } from "../../utils/format";
import { chainInfo, chainLabel } from "../../utils/providers";

/** The live pulpit of one chain: stats, latest blocks, latest transactions, refreshed every fifteen seconds. */
const props = defineProps<{ chain: string }>();

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

const info = computed(() => chainInfo(props.chain));
const feedless = computed(() => !hasTip(props.chain));
</script>

<template>
  <div class="space-y-4" @mouseenter="paused = true" @mouseleave="paused = false">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <UIcon :name="info?.icon ?? 'i-lucide-layers'" class="size-5 text-primary" />
      <h2 class="text-lg font-medium tracking-tight text-highlighted">{{ chainLabel(chain) }}</h2>
      <span v-if="tip" class="font-mono text-[11px] text-dimmed">
        via {{ tip.source }} · height {{ tip.height }} · updated {{ ago(tip.fetchedAt, now) }}
      </span>
      <span v-if="tip" class="ms-auto explorers-state explorers-state-ok">
        <span class="explorers-chip-dot bg-primary!" />
        live
      </span>
    </div>

    <div v-if="feedless" class="explorers-frame rounded-xl px-5 py-6 text-sm leading-6 text-muted">
      <p>
        No live feed for {{ chainLabel(chain) }}. Its providers answer one address, one hash or one block
        at a time, and none of them publishes a list of the newest blocks without a key. Pretending would
        be worse than saying so.
      </p>
      <p class="mt-2">
        Search still works: paste an address, a hash or a block number above. The
        <NuxtLink to="/chains" class="text-primary hover:underline">chain matrix</NuxtLink> says what each provider serves.
      </p>
    </div>
    <ExplorerState v-else :loading="loading && !tip" :error="error" :label="`Reading the ${chainLabel(chain)} tip…`" />

    <template v-if="tip">
      <ExplorerStatTiles v-if="tip.stats.length" :stats="tip.stats" />
      <div class="grid gap-4 lg:grid-cols-2">
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
  </div>
</template>
