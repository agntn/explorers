<script setup lang="ts">
import type { GasAnswer } from "../../utils/wire";
import { errorText } from "../../utils/wire";
import { dateTime, trimDecimals } from "../../utils/format";
import { CHAINS, providerLabel, providersFor } from "../../utils/providers";

/** Capabilities are declared by the provider, not by the chain: Mempool quotes fees on Bitcoin and Litecoin, and Peppool has no fee endpoint (`FEE_UNITS` in `src/providers/mempool.ts`). */
const NO_FEES = new Set(["pepecoin"]);

/** Every chain some provider quotes fees on, from the registry; each tile is its own read. */
const chains = CHAINS.filter(
  (chain) => !NO_FEES.has(chain.key) && providersFor(chain.key, "gasData").length > 0,
);

interface Tile {
  loading: boolean;
  error?: string;
  answer?: GasAnswer;
}

const tiles = reactive<Record<string, Tile>>({});

async function load(chain: string) {
  tiles[chain] = { loading: true };
  try {
    const answer = await $fetch<GasAnswer>("/api/gas", { query: { chain }, retry: 0 });
    tiles[chain] = { loading: false, answer };
  } catch (error) {
    tiles[chain] = { loading: false, error: errorText(error) };
  }
}

/** Three reads at a time: Etherscan allows five a second and the worker counts thirty new reads a minute. */
async function refresh() {
  const queue = chains.map((chain) => chain.key);
  for (const key of queue) tiles[key] = { loading: true };
  const workers = Array.from({ length: 3 }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await load(next);
    }
  });
  await Promise.all(workers);
}

onMounted(refresh);

const FIELDS: ReadonlyArray<[string, keyof GasAnswer["gas"]]> = [
  ["safe", "safeGasPrice"],
  ["proposed", "proposedGasPrice"],
  ["fast", "fastGasPrice"],
  ["base fee", "baseFee"],
  ["priority", "priorityFee"],
];

/** One card per chain with its fields derived once per answer, not once per render. */
const cards = computed(() =>
  chains.map((chain) => {
    const tile = tiles[chain.key];
    const gas = tile?.answer?.gas;
    const fields = gas
      ? FIELDS.flatMap(([label, key]) => {
          const value = gas[key];
          return typeof value === "string" ? [[label, trimDecimals(value, 4)] as const] : [];
        })
      : [];
    return { chain, tile, fields };
  }),
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-muted">
        {{ chains.length }} chains with a provider that quotes fees. Cached thirty seconds on the worker.
      </p>
      <button type="button" class="explorers-btn" @click="refresh">
        <UIcon name="i-lucide-refresh-cw" class="size-4" /> Refresh
      </button>
    </div>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="{ chain, tile, fields } in cards" :key="chain.key" class="explorers-frame overflow-hidden rounded-xl">
        <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
          <UIcon :name="chain.icon" class="size-4 text-primary" />
          <span class="text-sm font-medium text-highlighted">{{ chain.name }}</span>
          <span class="ms-auto font-mono text-[11px] text-dimmed">
            {{ tile?.answer ? `${tile.answer.gas.unit} · ${providerLabel(tile.answer.provider)}` : chain.key }}
          </span>
        </div>
        <p v-if="!tile || tile.loading" class="flex items-center gap-2 px-4 py-4 text-sm text-muted">
          <UIcon name="i-lucide-refresh-cw" class="size-4 animate-spin" /> Asking…
        </p>
        <p v-else-if="tile.error" class="px-4 py-4 font-mono text-xs" :style="{ color: 'var(--explorers-del)' }">
          {{ tile.error }}
        </p>
        <template v-else-if="tile.answer">
          <dl class="grid grid-cols-3">
            <div
              v-for="([label, value], index) in fields"
              :key="label"
              class="border-muted px-4 py-3"
              :class="{ 'border-l': index % 3 !== 0, 'border-t': index >= 3 }"
            >
              <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">{{ label }}</dt>
              <dd class="mt-1 font-mono text-base text-highlighted">{{ value }}</dd>
            </div>
          </dl>
          <p class="border-t border-muted px-4 py-2 font-mono text-[11px] text-dimmed">
            fetched {{ dateTime(tile.answer.fetchedAt) }}
          </p>
        </template>
      </div>
    </div>
    <p class="text-sm text-muted">
      Chains missing here have no provider with fee data: Blockstream's estimates don't match the recommendation shape, Peppool publishes none, Arweave prices storage per byte, and the single chain explorers don't quote fees at all. Details on <NuxtLink to="/guide/gas-and-blocks" class="text-primary hover:underline">Gas and blocks</NuxtLink>.
    </p>
  </div>
</template>
