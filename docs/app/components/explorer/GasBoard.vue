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

/** The ruler loops while any tile still waits for its answer. */
const busy = computed(() => chains.some((chain) => tiles[chain.key]?.loading !== false));

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
  <section class="tool-console console-wide gas" aria-label="Fees">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>getGasData(chain)<span class="console-file"
          >× {{ chains.length }}</span
        ></span
      >
      <span class="console-meta">cached 30 s on the worker</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span class="console-cursor" :class="{ 'console-cursor-busy': busy }" />
    </div>

    <div class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Fees <span aria-hidden="true">[ in the provider's own unit ]</span></span>
        <UButton
          color="neutral"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          label="refresh"
          :loading="busy"
          @click="refresh"
        />
      </p>
      <ul class="gas-cells">
        <li v-for="{ chain, tile, fields } in cards" :key="chain.key">
          <p class="gas-head">
            <UIcon :name="chain.icon" class="gas-glyph" aria-hidden="true" />
            <span class="gas-name">{{ chain.name }}</span>
            <UBadge
              v-if="tile?.answer"
              class="gas-unit"
              color="neutral"
              variant="outline"
              :label="tile.answer.gas.unit"
            />
          </p>
          <p v-if="!tile || tile.loading" class="explorers-note gas-state">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />
            Asking
          </p>
          <UAlert
            v-else-if="tile.error"
            color="error"
            variant="outline"
            :title="tile.error"
            role="alert"
          />
          <template v-else-if="tile.answer">
            <dl class="gas-fields">
              <div v-for="[label, value] in fields" :key="label">
                <dt>{{ label }}</dt>
                <dd :class="{ 'console-accent': label === 'proposed' }">{{ value }}</dd>
              </div>
            </dl>
            <p class="gas-foot">
              via {{ providerLabel(tile.answer.provider) }} · {{ dateTime(tile.answer.fetchedAt) }}
            </p>
          </template>
        </li>
      </ul>
    </div>

    <div class="explorers-band">
      <p class="explorers-note">
        A chain missing here has no provider with fee data: Blockstream's estimates don't match the
        recommendation shape, Peppool publishes none, Arweave prices storage per byte, and the
        single chain explorers quote no fees.
      </p>
    </div>

    <footer class="console-footer console-footer-plain">
      <span>{{ chains.length }} chains, three reads at a time</span>
      <ul class="console-links">
        <li>
          <NuxtLink to="/guide/gas-and-blocks"
            ><span aria-hidden="true">→ </span>Gas and blocks</NuxtLink
          >
        </li>
      </ul>
    </footer>
  </section>
</template>

<style scoped>
.gas-cells {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.gas-cells > li {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 10px 12px;
  min-width: 0;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.gas-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  min-width: 0;
}
.gas-glyph {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
}
.gas-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--ui-text-highlighted);
}
.gas-unit {
  margin-left: auto;
  flex: none;
  text-transform: none;
  letter-spacing: 0.04em;
}
.gas-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 10px;
  margin: 0;
}
.gas-fields dt {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.gas-fields dd {
  margin: 2px 0 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.gas-fields dd.console-accent {
  color: var(--console-accent);
}
.gas-foot {
  margin: 0;
  padding-top: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ui-text-dimmed);
  box-shadow: inset 0 1px 0 var(--console-line);
}
.gas-state {
  font-size: 13px;
}
</style>
