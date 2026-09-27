<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { shortHash, trimDecimals } from "../../utils/format";
import { chainIcon, chainLabel, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

const balance = computed(() => props.sample.balance);
</script>

<template>
  <section class="tool-console landing-call" aria-label="One tool call">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>explorers_balance(<UTooltip :text="sample.input"
          ><span class="tok-str" tabindex="0">"{{ shortHash(sample.input, 8, 4) }}"</span></UTooltip
        >)</span
      >
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.input" class="console-cursor" />
    </div>

    <!-- The chain it asked for on the crosses grid; the arguments, then the answer, in the readout. -->
    <div class="call-subject">
      <div :key="sample.input" class="console-scan" aria-hidden="true" />
      <div class="call-identity">
        <ConsoleReticle :key="sample.input" :icon="chainIcon(sample.chain)" />
        <div class="call-name">
          <span class="console-label">Tool / read-only</span>
          <h3>{{ chainLabel(sample.chain) }}</h3>
          <p class="call-note">
            The agent gets the normalized Balance and nothing else, the raw answer stays on the
            server until a call asks.
          </p>
        </div>
      </div>
      <div class="console-readout">
        <dl class="console-readout-rows">
          <div>
            <dt>address</dt>
            <dd>
              <UTooltip :text="sample.input"
                ><span tabindex="0" class="call-line">"{{ sample.input }}"</span></UTooltip
              >
            </dd>
          </div>
          <div>
            <dt>chain</dt>
            <dd>"{{ sample.chain }}"</dd>
          </div>
          <div>
            <dt>provider</dt>
            <dd>"{{ sample.provider }}"</dd>
          </div>
          <div>
            <dt>balanceFormatted</dt>
            <dd class="console-accent">
              <span class="call-line"
                >"{{ trimDecimals(balance.balanceFormatted, 8) }}" {{ balance.symbol }}</span
              >
            </dd>
          </div>
          <div>
            <dt>blockNumber</dt>
            <dd :class="{ 'call-dim': balance.blockNumber === null }">
              {{ balance.blockNumber === null ? "null" : balance.blockNumber }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <span aria-label="Supported hosts: MCP, Pi and OMP">MCP · Pi · OMP</span>
      <span class="console-meta">explorers mcp · stdio · via {{ providerLabel(sample.provider) }}</span>
    </footer>
  </section>
</template>

<style scoped>
.call-subject {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.call-subject > :not(.console-scan) {
  position: relative;
}
.call-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.call-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.call-name h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
}
.call-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
.landing-call .console-readout-rows > div {
  grid-template-columns: 8.5rem minmax(0, 1fr);
}
.landing-call .console-readout-rows dt {
  text-transform: none;
  letter-spacing: 0.02em;
}
.call-dim {
  color: var(--ui-text-dimmed);
}
.call-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (width < 400px) {
  .call-subject {
    padding-inline: 14px;
  }
  .call-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
