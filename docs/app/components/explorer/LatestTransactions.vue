<script setup lang="ts">
import type { TipTransaction } from "../../utils/wire";
import { addressPath, txPath } from "../../utils/entities";
import { ago, shortHash, trimDecimals } from "../../utils/format";

defineProps<{
  chain: string;
  transactions: TipTransaction[];
  symbol: string;
  /** The unit of `fee`, when the feed carries fees without senders (the mempool list). */
  feeUnit: string | null;
  now: number;
  pending?: boolean;
}>();
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <UIcon name="i-lucide-list" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ pending ? "Mempool" : "Latest transactions" }}</span>
      <span class="ms-auto font-mono text-[11px] text-dimmed">
        {{ pending ? `${transactions.length} newest unconfirmed` : `${transactions.length} newest` }}
      </span>
    </div>
    <p v-if="!transactions.length" class="px-4 py-6 text-sm text-muted">The explorer lists none right now.</p>
    <ol class="divide-y divide-muted">
      <li v-for="transaction in transactions" :key="transaction.hash" class="explorers-derive flex items-center gap-3 px-4 py-2.5">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-[10px] text-dimmed">Tx</span>
        <div class="min-w-0 flex-1">
          <p class="flex items-baseline gap-2">
            <NuxtLink :to="txPath(chain, transaction.hash)" class="truncate font-mono text-[13px] text-highlighted hover:text-primary" :title="transaction.hash">{{ shortHash(transaction.hash, 12, 8) }}</NuxtLink>
            <span v-if="transaction.timestamp" class="shrink-0 font-mono text-[11px] text-dimmed" :title="transaction.timestamp">{{ ago(transaction.timestamp, now) }}</span>
            <span v-else class="shrink-0 font-mono text-[11px] text-dimmed">unconfirmed</span>
          </p>
          <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
            <template v-if="transaction.from">
              <NuxtLink :to="addressPath(chain, transaction.from)" class="text-muted hover:text-primary" :title="transaction.from">{{ shortHash(transaction.from, 6, 4) }}</NuxtLink>
              →
              <NuxtLink v-if="transaction.to" :to="addressPath(chain, transaction.to)" class="text-muted hover:text-primary" :title="transaction.to">{{ shortHash(transaction.to, 6, 4) }}</NuxtLink>
              <span v-else>{{ transaction.method === "data" ? "data upload" : "contract creation" }}</span>
              <template v-if="transaction.method && transaction.method !== 'data'"> · {{ transaction.method }}</template>
            </template>
            <template v-else-if="transaction.fee">fee {{ transaction.fee }} {{ feeUnit ?? "" }} · {{ transaction.method }}</template>
          </p>
        </div>
        <span class="shrink-0 text-right">
          <span class="block font-mono text-[13px] whitespace-nowrap" :class="transaction.value === '0' ? 'text-dimmed' : 'text-highlighted'">
            {{ trimDecimals(transaction.valueFormatted, 5) }} {{ symbol }}
          </span>
          <ExplorerStatus v-if="transaction.status !== 'success'" :status="transaction.status" class="mt-0.5" />
        </span>
      </li>
    </ol>
  </div>
</template>
