<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { dateOnly, shortHash, trimDecimals } from "../../utils/format";

const props = defineProps<{ sample: ExplorerSample }>();

const symbol = computed(() => props.sample.balance.symbol);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="font-mono text-xs text-muted">
        <span class="text-dimmed">getTxHistory</span>
        <span class="ms-2 text-highlighted">{ limit: 5 }</span>
      </p>
      <p class="font-mono text-[11px] text-dimmed">
        {{ sample.history.length }} rows · {{ sample.live ? "live" : "sample" }}
      </p>
    </div>
    <ol class="divide-y divide-muted">
      <li
        v-for="transaction in sample.history"
        :key="transaction.hash"
        class="explorers-derive flex items-start gap-3 px-4 py-3"
      >
        <UIcon
          :name="
            transaction.status === 'success'
              ? 'i-lucide-check'
              : transaction.status === 'failed'
                ? 'i-lucide-circle-x'
                : 'i-lucide-archive'
          "
          class="mt-0.5 size-4 shrink-0"
          :class="transaction.status === 'success' ? 'text-primary' : 'text-dimmed'"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate font-mono text-[12px] text-highlighted" :title="transaction.hash">
            {{ shortHash(transaction.hash, 14, 8) }}
          </p>
          <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
            {{ shortHash(transaction.from, 6, 4) }} →
            {{ transaction.to === null ? "contract creation" : transaction.to === "" ? "data upload" : shortHash(transaction.to, 6, 4) }}
            · block {{ transaction.blockNumber }}
            {{ transaction.timestamp ? ` · ${dateOnly(transaction.timestamp)}` : "" }}
            {{ transaction.functionName ? ` · ${transaction.functionName}` : "" }}
            {{ transaction.tokenTransfers.length ? ` · ${transaction.tokenTransfers.length} token transfers` : "" }}
            {{ transaction.opReturn?.length ? ` · OP_RETURN` : "" }}
          </p>
        </div>
        <span class="shrink-0 font-mono text-[12px] text-muted">
          {{ trimDecimals(transaction.valueFormatted, 6) }} {{ symbol }}
        </span>
        <ExplorerStatus :status="transaction.status" />
      </li>
    </ol>
  </div>
</template>
