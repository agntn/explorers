<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { Utxo } from "@agntn/explorers";
import { blockPath, txPath } from "../../utils/entities";
import { STACK } from "../../utils/entity-table";
import { ago, dateTime, trimDecimals } from "../../utils/format";
import { chainInfo } from "../../utils/providers";
import { ROSTER_TABLE_UI } from "../../utils/roster";

const props = defineProps<{ chain: string; items: Utxo[]; total: number }>();

const symbol = computed(() => chainInfo(props.chain)?.symbol ?? "");

const columns: TableColumn<Utxo>[] = [
  { id: "output", header: "Output" },
  { id: "block", header: "Block", meta: { class: { th: "w-[10rem]", td: STACK.lastStart } } },
  { id: "value", header: "Value", meta: { class: { th: "w-[11rem] text-end", td: `text-end ${STACK.end}` } } },
  { id: "state", header: "State", meta: { class: { th: "w-[7.5rem]", td: STACK.lastEnd } } },
];
</script>

<template>
  <p v-if="!items.length" class="explorers-note list-empty">
    Nothing unspent. Every output this address ever received is gone.
  </p>
  <UTable
    v-else
    :data="items"
    :columns="columns"
    :get-row-id="(row) => `${row.txid}:${row.vout}`"
    :ui="ROSTER_TABLE_UI"
  >
    <template #output-cell="{ row }">
      <span class="list-route">
        <ExplorerHash :value="row.original.txid" :to="txPath(chain, row.original.txid)" :head="10" strong />
        <span class="list-sub">:{{ row.original.vout }}</span>
      </span>
    </template>
    <template #block-cell="{ row }">
      <span class="list-stack">
        <NuxtLink
          v-if="row.original.blockNumber !== null"
          :to="blockPath(chain, row.original.blockNumber)"
          class="list-link"
          >{{ row.original.blockNumber }}</NuxtLink
        >
        <span v-else class="list-sub">mempool</span>
        <UTooltip v-if="row.original.timestamp" :text="dateTime(row.original.timestamp)">
          <span class="list-sub">{{ ago(row.original.timestamp) }}</span>
        </UTooltip>
      </span>
    </template>
    <template #value-cell="{ row }">
      <span class="list-amount explorers-value"
        >{{ trimDecimals(row.original.valueFormatted, 8) }}
        <span class="list-sub">{{ symbol }}</span></span
      >
    </template>
    <template #state-cell="{ row }">
      <span class="explorers-state" :class="{ 'explorers-state-warn': row.original.confirmed }">{{
        row.original.confirmed ? "confirmed" : "pending"
      }}</span>
    </template>
  </UTable>
  <p v-if="total > items.length" class="explorers-note list-empty list-more">
    {{ total }} unspent outputs in total, the first {{ items.length }} shown. The library returns
    them all.
  </p>
</template>
