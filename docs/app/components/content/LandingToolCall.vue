<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { shortHash, trimDecimals } from "../../utils/format";

const props = defineProps<{ sample: ExplorerSample }>();

const balance = computed(() => props.sample.balance);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="font-mono text-xs text-muted">
        <span class="text-dimmed">tool</span>
        <span class="ms-2 text-highlighted">explorers_balance</span>
      </p>
      <p class="font-mono text-[11px] text-dimmed">MCP · Pi · OMP</p>
    </div>
    <div class="divide-y divide-muted">
      <div class="px-4 py-4">
        <p class="explorers-eyebrow mb-3">input</p>
        <pre class="explorers-tool"><code>{
  <span class="tok-key">"address"</span>: <span class="tok-str">"<Transition name="explorers-roll" mode="out-in"><span :key="sample.input" class="explorers-roll-slot">{{ sample.input }}</span></Transition>"</span>,
  <span class="tok-key">"chain"</span>: <span class="tok-str">"<Transition name="explorers-roll" mode="out-in"><span :key="sample.chain" class="explorers-roll-slot">{{ sample.chain }}</span></Transition>"</span>
}</code></pre>
      </div>
      <div class="px-4 py-4">
        <p class="explorers-eyebrow mb-3">output</p>
        <pre :key="balance.balance + sample.provider" class="explorers-tool explorers-derive"><code>{
  <span class="tok-key">"provider"</span>: <span class="tok-str">"{{ sample.provider }}"</span>,
  <span class="tok-key">"data"</span>: {
    <span class="tok-key">"address"</span>: <span class="tok-str">"{{ shortHash(balance.address, 12, 8) }}"</span>,
    <span class="tok-key">"chain"</span>: <span class="tok-str">"{{ balance.chain }}"</span>,
    <span class="tok-key">"balance"</span>: <span class="tok-str">"{{ balance.balance }}"</span>,
    <span class="tok-key">"balanceFormatted"</span>: <span class="tok-str">"{{ trimDecimals(balance.balanceFormatted, 8) }}"</span>,
    <span class="tok-key">"symbol"</span>: <span class="tok-str">"{{ balance.symbol }}"</span>,
    <span class="tok-key">"blockNumber"</span>: <span class="tok-kw">{{ balance.blockNumber === null ? "null" : balance.blockNumber }}</span>,
    <span class="tok-key">"fetchedAt"</span>: <span class="tok-str">"{{ balance.fetchedAt }}"</span>
  }
}</code></pre>
      </div>
    </div>
  </div>
</template>
