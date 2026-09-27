<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { TokenTransfer } from "@agntn/explorers";
import { addressPath, blockPath, txPath } from "../../utils/entities";
import { STACK } from "../../utils/entity-table";
import { ago, clip, dateTime, trimDecimals } from "../../utils/format";
import { ROSTER_TABLE_UI } from "../../utils/roster";

const props = defineProps<{ chain: string; items: TokenTransfer[]; address?: string }>();

function isSelf(value: string): boolean {
  return props.address !== undefined && value.toLowerCase() === props.address.toLowerCase();
}

const columns: TableColumn<TokenTransfer>[] = [
  { id: "tx", header: "Transaction", meta: { class: { th: "w-[12rem]" } } },
  { id: "block", header: "Block", meta: { class: { th: "w-[8.5rem]", td: STACK.lastStart } } },
  { id: "route", header: "From → to", meta: { class: { td: STACK.line } } },
  { id: "amount", header: "Amount", meta: { class: { th: "w-[13rem] text-end", td: `text-end ${STACK.end}` } } },
];
</script>

<template>
  <p v-if="!items.length" class="explorers-note list-empty">No token transfers on this page.</p>
  <UTable
    v-else
    :data="items"
    :columns="columns"
    :get-row-id="(row) => row.txHash + row.contract + row.from + row.to + row.value"
    :ui="ROSTER_TABLE_UI"
  >
    <template #tx-cell="{ row }">
      <ExplorerHash :value="row.original.txHash" :to="txPath(chain, row.original.txHash)" :head="10" strong />
    </template>
    <template #block-cell="{ row }">
      <span class="list-stack">
        <NuxtLink :to="blockPath(chain, row.original.blockNumber)" class="list-link">{{
          row.original.blockNumber
        }}</NuxtLink>
        <UTooltip v-if="row.original.timestamp" :text="dateTime(row.original.timestamp)">
          <span class="list-sub">{{ ago(row.original.timestamp) }}</span>
        </UTooltip>
      </span>
    </template>
    <template #route-cell="{ row }">
      <span class="list-route">
        <span v-if="isSelf(row.original.from)" class="list-sub">this address</span>
        <ExplorerHash v-else :value="row.original.from" :to="addressPath(chain, row.original.from)" />
        <span class="list-dir">→</span>
        <span v-if="isSelf(row.original.to)" class="list-sub">this address</span>
        <ExplorerHash v-else :value="row.original.to" :to="addressPath(chain, row.original.to)" />
      </span>
    </template>
    <template #amount-cell="{ row }">
      <!-- The symbol and name come from the token's deployer: interpolated and clipped. -->
      <span class="list-amount">
        <span class="explorers-value">{{ trimDecimals(row.original.valueFormatted, 6) }}</span>
        <UTooltip :text="row.original.name ? `${row.original.name} · ${row.original.contract}` : row.original.contract">
          <NuxtLink :to="addressPath(chain, row.original.contract)" class="list-link list-token">
            {{ clip(row.original.symbol, 12) }}</NuxtLink
          >
        </UTooltip>
      </span>
    </template>
  </UTable>
</template>
