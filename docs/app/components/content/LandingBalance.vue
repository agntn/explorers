<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { addressPath } from "../../utils/entities";
import { dateTime, groupDigits, shortHash, trimDecimals } from "../../utils/format";
import { chainIcon, chainLabel, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const balance = computed(() => props.sample.balance);

/** UTXO explorers add cumulative totals; the row says so when a provider leaves them out. */
const totals = computed(() =>
  balance.value.funded !== undefined && balance.value.spent !== undefined
    ? `${groupDigits(balance.value.funded)} / ${groupDigits(balance.value.spent)}`
    : null,
);
</script>

<template>
  <section
    class="tool-console landing-balance"
    aria-label="One balance read"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>getBalance(<UTooltip :text="sample.input"
          ><span class="tok-str" tabindex="0">"{{ shortHash(sample.input, 8, 4) }}"</span></UTooltip
        >, <span class="tok-str">"{{ sample.chain }}"</span>)</span
      >
      <span class="console-meta">{{ sample.live ? "live" : "recorded" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.input" class="console-cursor" />
    </div>

    <div class="balance-subject">
      <div :key="sample.input" class="console-scan" aria-hidden="true" />
      <div class="balance-identity">
        <ConsoleReticle :key="sample.input" :icon="chainIcon(sample.chain)" />
        <div class="balance-name">
          <span class="console-label"
            >Balance / <span class="console-label-key">{{ sample.chain }}</span></span
          >
          <h3>
            {{ trimDecimals(balance.balanceFormatted, 8) }}
            <span class="console-accent">{{ balance.symbol }}</span>
          </h3>
          <p class="balance-raw">
            <UTooltip :text="`&quot;${balance.balance}&quot;`">
              <span>"{{ groupDigits(balance.balance) }}"</span>
            </UTooltip>
            <span class="balance-dim"> smallest unit</span>
          </p>
        </div>
      </div>
      <div class="console-readout">
        <dl class="console-readout-rows">
          <div>
            <dt>Provider</dt>
            <dd>{{ providerLabel(sample.provider) }}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>
              <UTooltip :text="balance.address">
                <span tabindex="0">{{ shortHash(balance.address, 10, 6) }}</span>
              </UTooltip>
            </dd>
          </div>
          <div>
            <dt>In / out</dt>
            <dd :class="{ 'balance-dim': !totals }">
              <span class="balance-line">{{ totals ?? `not sent on ${chainLabel(sample.chain)}` }}</span>
            </dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd :class="{ 'balance-dim': balance.blockNumber === null }">
              {{ balance.blockNumber === null ? "not named, null" : balance.blockNumber }}
            </dd>
          </div>
          <div>
            <dt>Fetched</dt>
            <dd>{{ dateTime(balance.fetchedAt) }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <NuxtLink :to="addressPath(sample.chain, sample.input)" class="balance-link"
        ><span aria-hidden="true">→ </span>open in the explorer</NuxtLink
      >
      <div class="console-controls" aria-label="Sample addresses">
        <button type="button" aria-label="Previous address" @click="emit('step', -1)">
          <UIcon name="i-lucide-chevron-left" />
        </button>
        <span>Address</span>
        <button type="button" aria-label="Next address" @click="emit('step', 1)">
          <UIcon name="i-lucide-chevron-right" />
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.balance-subject {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.balance-subject > :not(.console-scan) {
  position: relative;
}
.balance-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.balance-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.balance-name h3 {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
  font-variant-numeric: tabular-nums;
}
.balance-raw {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.balance-dim {
  color: var(--ui-text-dimmed);
}
.balance-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.landing-balance .console-readout-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
.balance-link {
  color: var(--ui-text-highlighted);
}
.balance-link:hover {
  color: var(--console-accent);
}
.balance-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 400px) {
  .balance-subject {
    padding-inline: 14px;
  }
  .balance-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
