<script setup lang="ts">
import type { BlockTransactionsAnswer } from "../../utils/wire";
import { hasTip } from "#shared/tip-chains";
import { addressPath, txPath } from "../../utils/entities";
import { shortHash, trimDecimals } from "../../utils/format";
import { chainInfo } from "../../utils/providers";

/** The transactions inside one block, where the chain's explorer lists them. */
const props = defineProps<{ chain: string; number: number }>();

const { loading, error, answer, load } = useAnswer<BlockTransactionsAnswer>("/api/block-txs");
const symbol = computed(() => chainInfo(props.chain)?.symbol ?? "");
const feedless = computed(() => !hasTip(props.chain));

function read() {
  if (!feedless.value) void load({ chain: props.chain, number: props.number });
}

onMounted(read);
watch(() => [props.chain, props.number], read);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <UIcon name="i-solar-bill-list-linear" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">Transactions in this block</span>
      <span v-if="answer" class="ms-auto font-mono text-[11px] text-dimmed">
        {{ answer.total !== null ? `${answer.items.length} of ${answer.total}` : answer.items.length }} · via {{ answer.source }}
      </span>
    </div>
    <p v-if="feedless" class="px-4 py-4 text-sm text-muted">
      This chain's explorer doesn't list a block's transactions through a public endpoint, so there's nothing to show here.
    </p>
    <p v-else-if="loading" class="flex items-center gap-2 px-4 py-4 text-sm text-muted">
      <UIcon name="i-solar-refresh-linear" class="size-4 animate-spin" /> Reading the block's transactions…
    </p>
    <p v-else-if="error" class="px-4 py-4 font-mono text-xs" :style="{ color: 'var(--explorers-del)' }">{{ error }}</p>
    <p v-else-if="answer && !answer.items.length" class="px-4 py-4 text-sm text-muted">An empty block.</p>
    <div v-else-if="answer" class="explorers-table-wrap">
      <table class="explorers-table">
        <thead>
          <tr>
            <th>hash</th>
            <th>from</th>
            <th>to</th>
            <th class="text-right">value</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="transaction in answer.items" :key="transaction.hash">
            <td class="font-mono text-xs whitespace-nowrap">
              <NuxtLink :to="txPath(chain, transaction.hash)" class="text-highlighted hover:text-primary" :title="transaction.hash">{{ shortHash(transaction.hash, 12, 8) }}</NuxtLink>
              <span v-if="transaction.method" class="ms-2 text-[11px] text-dimmed">{{ transaction.method }}</span>
            </td>
            <td class="font-mono text-xs">
              <NuxtLink v-if="transaction.from" :to="addressPath(chain, transaction.from)" class="text-muted hover:text-primary" :title="transaction.from">{{ shortHash(transaction.from, 8, 6) }}</NuxtLink>
              <span v-else class="text-dimmed">none</span>
            </td>
            <td class="font-mono text-xs">
              <NuxtLink v-if="transaction.to" :to="addressPath(chain, transaction.to)" class="text-muted hover:text-primary" :title="transaction.to">{{ shortHash(transaction.to, 8, 6) }}</NuxtLink>
              <span v-else class="text-dimmed">none</span>
            </td>
            <td class="text-right font-mono text-xs whitespace-nowrap" :class="transaction.value === '0' ? 'text-dimmed' : 'text-highlighted'">
              {{ transaction.valueFormatted ? `${trimDecimals(transaction.valueFormatted, 6)} ${symbol}` : "" }}
            </td>
            <td><ExplorerStatus :status="transaction.status" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
