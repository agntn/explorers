<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { TokenBalance } from "@agntn/explorers";
import { addressPath } from "../../utils/entities";
import { STACK } from "../../utils/entity-table";
import { clip, trimDecimals } from "../../utils/format";
import { ROSTER_TABLE_UI } from "../../utils/roster";

defineProps<{ chain: string; items: TokenBalance[]; total: number }>();

const columns: TableColumn<TokenBalance>[] = [
  { id: "token", header: "Token" },
  { id: "contract", header: "Contract", meta: { class: { th: "w-[11rem]", td: STACK.lastStart } } },
  { id: "balance", header: "Balance", meta: { class: { th: "w-[12rem] text-end", td: `text-end ${STACK.end}` } } },
  { id: "usd", header: "Value", meta: { class: { th: "w-[7rem] text-end", td: `text-end ${STACK.lastEnd}` } } },
];
</script>

<template>
  <p v-if="!items.length" class="explorers-note list-empty">No token holdings with a balance.</p>
  <UTable
    v-else
    :data="items"
    :columns="columns"
    :get-row-id="(row) => row.contract"
    :ui="ROSTER_TABLE_UI"
  >
    <template #token-cell="{ row }">
      <!-- Symbols and names come from whoever deployed the token: interpolated, clipped, never markup. -->
      <span class="list-route">
        <span class="explorers-value">{{ clip(row.original.symbol, 12) }}</span>
        <span v-if="row.original.name" class="list-sub">{{ clip(row.original.name, 32) }}</span>
        <span class="list-sub">· {{ row.original.decimals }} dec</span>
      </span>
    </template>
    <template #contract-cell="{ row }">
      <ExplorerHash :value="row.original.contract" :to="addressPath(chain, row.original.contract)" />
    </template>
    <template #balance-cell="{ row }">
      <span class="list-amount explorers-value">{{ trimDecimals(row.original.balanceFormatted, 6) }}</span>
    </template>
    <template #usd-cell="{ row }">
      <span class="list-amount" :class="row.original.valueUsd !== undefined ? '' : 'list-sub'">{{
        row.original.valueUsd !== undefined ? `$${row.original.valueUsd.toFixed(2)}` : "no quote"
      }}</span>
    </template>
  </UTable>
  <p v-if="total > items.length" class="explorers-note list-empty list-more">
    {{ total }} holdings in total, the first {{ items.length }} shown. The library returns them all.
  </p>
</template>
