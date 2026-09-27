<script setup lang="ts">
import type { ExplorerSample, SampleTransaction } from "../../utils/landing-fixtures";
import { dateOnly, shortHash, trimDecimals } from "../../utils/format";
import { providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

const symbol = computed(() => props.sample.balance.symbol);

/** The recipient, the contract a deployment created, or what the row has instead. */
function recipient(transaction: SampleTransaction): string {
  if (transaction.createdContract) return `created ${shortHash(transaction.createdContract, 6, 4)}`;
  if (transaction.to === null) return "none";
  if (transaction.to === "") return "data upload";
  return shortHash(transaction.to, 6, 4);
}

/** What the row carries besides value: a method, token transfers, an OP_RETURN push. */
function extra(transaction: SampleTransaction): string {
  return [
    transaction.functionName ?? "",
    transaction.tokenTransfers.length ? `${transaction.tokenTransfers.length} token transfers` : "",
    transaction.opReturn?.length ? "OP_RETURN" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
</script>

<template>
  <section class="tool-console landing-history" aria-label="Transaction history">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">List</span>getTxHistory(address, <span class="tok-str"
          >"{{ sample.chain }}"</span
        >)</span
      >
      <span class="console-meta">limit 5 · {{ sample.live ? "live" : "recorded" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.input" class="console-cursor" />
    </div>

    <!-- Five rows of two lines each whatever the sample, so the panel keeps one height. -->
    <ol :key="sample.input" class="explorers-rows history-rows console-animate">
      <li
        v-for="(transaction, index) in sample.history.slice(0, 5)"
        :key="transaction.hash"
        :style="{ animationDelay: `${index * 45}ms` }"
      >
        <UTooltip :text="transaction.hash">
          <span class="explorers-value history-hash" tabindex="0">{{
            shortHash(transaction.hash, 12, 6)
          }}</span>
        </UTooltip>
        <span class="history-end">
          <span :class="transaction.value === '0' ? 'explorers-dim' : 'explorers-value'"
            >{{ trimDecimals(transaction.valueFormatted, 6) }}
            <span class="explorers-dim">{{ symbol }}</span></span
          >
          <ExplorerStatus v-if="transaction.status !== 'success'" :status="transaction.status" />
        </span>
        <span class="explorers-clip history-sub"
          >{{ shortHash(transaction.from, 6, 4) || "?" }} → {{ recipient(transaction)
          }}<span class="explorers-dim">
            · block {{ transaction.blockNumber
            }}{{ transaction.timestamp ? ` · ${dateOnly(transaction.timestamp)}` : ""
            }}{{ extra(transaction) ? ` · ${extra(transaction)}` : "" }}</span
          ></span
        >
      </li>
    </ol>

    <footer class="console-footer console-footer-plain">
      <span>same Transaction shape from {{ providerLabel(sample.provider) }}</span>
      <span class="console-meta">raw kept in .raw</span>
    </footer>
  </section>
</template>

<style scoped>
.history-rows {
  padding: 6px 0;
}
.history-rows > li {
  grid-template-columns: minmax(0, 1fr) auto;
}
.history-hash {
  white-space: nowrap;
}
.history-end {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.history-sub {
  grid-column: 1 / -1;
  font-size: 11px;
}
@media (width < 400px) {
  .history-rows > li {
    padding-inline: 14px;
  }
}
</style>
