<script setup lang="ts">
import type { BlockAnswer } from "../../utils/wire";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, formatUnits, groupDigits, trimDecimals } from "../../utils/format";
import { chainIcon, chainLabel, isEvm, providerLabel } from "../../utils/providers";

const props = defineProps<{ answer: BlockAnswer }>();

const block = computed(() => props.answer.block);
const external = computed(() =>
  externalUrl("block", props.answer.chain, String(block.value.number)),
);
const hasGas = computed(
  () => block.value.gasLimit !== undefined && block.value.gasLimit !== "0",
);

/** Bitcoin and Litecoin bring size and weight and no gas at all, see `src/core/esplora.ts`. */
const weighed = computed(() => block.value.weight !== undefined);

/** The BIP 141 ceiling, four million weight units, which Litecoin kept too. */
const MAX_BLOCK_WEIGHT = 4_000_000;

/** Gas used as a share of the limit, from the two strings without a float on the raw values. */
function gasShare(used: string | undefined, limit: string | undefined): number | null {
  if (!used || !limit || !/^\d+$/u.test(used) || !/^\d+$/u.test(limit)) return null;
  const cap = BigInt(limit);
  return cap > 0n ? Number((BigInt(used) * 10000n) / cap) / 100 : null;
}

/** How full the block is: weight against the cap, or gas against the limit. */
const utilization = computed(() => {
  const { weight } = block.value;
  if (weight !== undefined) return Math.round((weight / MAX_BLOCK_WEIGHT) * 10000) / 100;
  return hasGas.value ? gasShare(block.value.gasUsed, block.value.gasLimit) : null;
});

/** A header word in the hex block explorers print it in. */
function hexWord(word: number): string {
  return `0x${word.toString(16).padStart(8, "0")}`;
}

const header = computed(() => {
  const { version, merkleRoot, bits, nonce, difficulty, medianTime } = block.value;
  if (merkleRoot === undefined) return null;
  return [
    ["Version", version === undefined ? null : hexWord(version)],
    ["Merkle root", merkleRoot],
    ["Bits", bits === undefined ? null : hexWord(bits)],
    ["Nonce", nonce === undefined ? null : groupDigits(String(nonce))],
    ["Difficulty", difficulty === undefined ? null : groupDigits(String(difficulty))],
    ["Median time", medianTime ?? null],
  ].filter((field): field is [string, string] => field[1] !== null);
});

/** Twenty ticks for the share: the used ones hatched, the headroom in the accent, like every gauge. */
const TICKS = 20;
const usedTicks = computed(() =>
  utilization.value === null ? 0 : Math.round((Math.min(100, utilization.value) / 100) * TICKS),
);

const baseFeeText = computed(() => {
  const fee = block.value.baseFee;
  if (!fee) return null;
  return isEvm(props.answer.chain)
    ? `${trimDecimals(formatUnits(fee, 9), 4)} gwei`
    : groupDigits(fee);
});
</script>

<template>
  <section class="tool-console console-wide not-prose" aria-label="Block">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>getBlockInfo(<span class="entity-str"
          >"{{ answer.chain }}"</span
        >, {{ block.number }})</span
      >
      <span class="console-meta">via {{ providerLabel(answer.provider) }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="block.hash" class="console-cursor" />
    </div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="block.hash" :icon="chainIcon(answer.chain)" />
        <div class="console-name">
          <span class="console-label"
            >Block / <span class="console-label-key">{{ answer.chain }}</span></span
          >
          <h3 class="block-number">{{ block.number }}</h3>
          <p class="console-about">
            Sealed {{ dateTime(block.timestamp) }}, read through
            {{ providerLabel(answer.provider) }}. The arrows at the foot step to its neighbours.
          </p>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Transactions</dt>
            <dd class="console-accent">{{ block.txCount }}</dd>
          </div>
          <div v-if="weighed">
            <dt>Size</dt>
            <dd>{{ block.size === undefined ? "n/a" : `${groupDigits(String(block.size))} B` }}</dd>
          </div>
          <div v-if="weighed">
            <dt>Weight</dt>
            <dd>{{ groupDigits(String(block.weight)) }} WU</dd>
          </div>
          <div v-if="!weighed">
            <dt>Gas used</dt>
            <dd>{{ hasGas && block.gasUsed ? groupDigits(block.gasUsed) : "n/a" }}</dd>
          </div>
          <div v-if="!weighed">
            <dt>Gas limit</dt>
            <dd>{{ hasGas && block.gasLimit ? groupDigits(block.gasLimit) : "n/a" }}</dd>
          </div>
          <div>
            <dt>Base fee</dt>
            <dd>{{ baseFeeText ?? "none" }}</dd>
          </div>
        </dl>
        <div
          v-if="utilization !== null"
          class="console-gauge"
          :aria-label="`${utilization}% of the ${weighed ? 'weight cap' : 'gas limit'} used`"
        >
          <span class="console-ticks" aria-hidden="true">
            <span
              v-for="index in TICKS"
              :key="index"
              :class="index <= usedTicks ? 'console-tick-closed' : 'console-tick-open'"
              :style="{ animationDelay: `${index * 12}ms` }"
            />
          </span>
          <span class="console-gauge-read"
            >used {{ utilization }}% of the {{ weighed ? "cap" : "limit" }}</span
          >
        </div>
      </div>
    </div>

    <div class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Chain <span aria-hidden="true">[ hash · parent · producer ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div>
          <dt>Hash</dt>
          <dd>{{ block.hash }}</dd>
        </div>
        <div>
          <dt>Parent</dt>
          <dd>
            <NuxtLink v-if="block.number > 0" :to="blockPath(answer.chain, block.number - 1)">{{
              block.parentHash
            }}</NuxtLink>
            <template v-else>{{ block.parentHash }}</template>
          </dd>
        </div>
        <div>
          <dt>Timestamp</dt>
          <dd>{{ block.timestamp }}</dd>
        </div>
        <div>
          <dt>Producer</dt>
          <dd>
            <NuxtLink v-if="block.miner" :to="addressPath(answer.chain, block.miner)">{{
              block.miner
            }}</NuxtLink>
            <span v-else class="explorers-dim">empty · the explorer names no producer</span>
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="header" class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Header <span aria-hidden="true">[ the 80 bytes a miner grinds ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div v-for="[label, value] in header" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/explorer"><span aria-hidden="true">→ </span>Explorer</NuxtLink>
        </li>
        <li v-if="external">
          <a :href="external" target="_blank" rel="noopener nofollow"
            ><span aria-hidden="true">↗ </span>{{ externalHost(answer.chain) }}</a
          >
        </li>
      </ul>
      <div class="console-controls" aria-label="Blocks">
        <UButton
          v-if="block.number > 0"
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-left"
          :to="blockPath(answer.chain, block.number - 1)"
          :aria-label="`Block ${block.number - 1}`"
        />
        <span>{{ chainLabel(answer.chain) }} block</span>
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-right"
          :to="blockPath(answer.chain, block.number + 1)"
          :aria-label="`Block ${block.number + 1}`"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.block-number {
  font-family: var(--font-mono) !important;
}
</style>
