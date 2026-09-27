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
const hasGas = computed(() => block.value.gasLimit !== "0");

/** On the Bitcoin family the two gas fields carry size and weight, as `src/providers/mempool.ts` and `src/providers/blockstream.ts` map them. */
const evm = computed(() => isEvm(props.answer.chain));

/** Gas used as a share of the limit, from the two strings without a float on the raw values. */
const utilization = computed(() => {
  if (
    !hasGas.value ||
    !/^\d+$/u.test(block.value.gasUsed) ||
    !/^\d+$/u.test(block.value.gasLimit)
  ) {
    return null;
  }
  const used = BigInt(block.value.gasUsed);
  const limit = BigInt(block.value.gasLimit);
  return limit > 0n ? Number((used * 10000n) / limit) / 100 : null;
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
          <div>
            <dt>{{ evm ? "Gas used" : "Size" }}</dt>
            <dd>{{ hasGas ? groupDigits(block.gasUsed) : "n/a" }}</dd>
          </div>
          <div>
            <dt>{{ evm ? "Gas limit" : "Weight" }}</dt>
            <dd>{{ hasGas ? groupDigits(block.gasLimit) : "n/a" }}</dd>
          </div>
          <div>
            <dt>Base fee</dt>
            <dd>{{ baseFeeText ?? "none" }}</dd>
          </div>
        </dl>
        <div
          v-if="utilization !== null"
          class="console-gauge"
          :aria-label="`${utilization}% of the ${evm ? 'gas limit' : 'weight cap'} used`"
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
            >used {{ utilization }}% of the {{ evm ? "limit" : "cap" }}</span
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
