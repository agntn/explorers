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
  <div class="feed">
    <p class="console-label console-rule-title">
      <span
        >{{ pending ? "Mempool" : "Transactions" }}
        <span aria-hidden="true"
          >[ {{ transactions.length }} newest{{ pending ? " unconfirmed" : "" }} ]</span
        ></span
      >
      <span class="console-mark" aria-hidden="true" />
    </p>
    <p v-if="!transactions.length" class="explorers-note feed-empty">
      The explorer lists none right now.
    </p>
    <ol class="explorers-rows feed-rows console-animate">
      <li v-for="(transaction, index) in transactions" :key="transaction.hash" :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }">
        <UTooltip :text="transaction.hash">
          <NuxtLink :to="txPath(chain, transaction.hash)" class="explorers-clip">{{
            shortHash(transaction.hash, 10, 6)
          }}</NuxtLink>
        </UTooltip>
        <UTooltip v-if="transaction.timestamp" :text="transaction.timestamp">
          <span class="explorers-dim feed-age">{{ ago(transaction.timestamp, now) }}</span>
        </UTooltip>
        <span v-else class="explorers-dim feed-age">unconfirmed</span>
        <span class="explorers-clip feed-sub">
          <template v-if="transaction.from">
            <NuxtLink :to="addressPath(chain, transaction.from)" class="feed-link">{{
              shortHash(transaction.from, 6, 4)
            }}</NuxtLink>
            <span class="explorers-dim"> → </span>
            <NuxtLink v-if="transaction.to" :to="addressPath(chain, transaction.to)" class="feed-link">{{
              shortHash(transaction.to, 6, 4)
            }}</NuxtLink>
            <span v-else>{{
              transaction.method === "data" ? "data upload" : "contract creation"
            }}</span>
            <span v-if="transaction.method && transaction.method !== 'data'" class="explorers-dim">
              · {{ transaction.method }}</span
            >
          </template>
          <template v-else-if="transaction.fee"
            >fee {{ transaction.fee }} {{ feeUnit ?? "" }}
            <span class="explorers-dim">· {{ transaction.method }}</span></template
          >
        </span>
        <span class="feed-end">
          <span :class="transaction.value === '0' ? 'explorers-dim' : 'explorers-value'"
            >{{ trimDecimals(transaction.valueFormatted, 5) }}
            <span class="explorers-dim">{{ symbol }}</span></span
          >
          <ExplorerStatus v-if="transaction.status !== 'success'" :status="transaction.status" />
        </span>
      </li>
    </ol>
  </div>
</template>
