<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { WireTransaction } from "../../utils/wire";
import { addressPath, blockPath, txPath } from "../../utils/entities";
import { STACK } from "../../utils/entity-table";
import { ago, dateTime, trimDecimals } from "../../utils/format";
import { chainInfo } from "../../utils/providers";
import { ROSTER_TABLE_UI } from "../../utils/roster";

const props = defineProps<{
  chain: string;
  items: WireTransaction[];
  /** The address the list belongs to, so its side of each row is muted and the other side links. */
  address?: string;
}>();

const symbol = computed(() => chainInfo(props.chain)?.symbol ?? "");

type Direction = "in" | "out" | "self" | null;

interface Row {
  transaction: WireTransaction;
  fromSelf: boolean;
  toSelf: boolean;
  direction: Direction;
  note: string;
}

/** Each row with its sides classified once, not once per cell. */
const rows = computed<Row[]>(() => {
  const own = props.address?.toLowerCase();
  return props.items.map((transaction) => {
    const fromSelf = own !== undefined && transaction.from.toLowerCase() === own;
    const toSelf =
      own !== undefined && transaction.to !== null && transaction.to.toLowerCase() === own;
    let direction: Direction = null;
    if (fromSelf && toSelf) direction = "self";
    else if (fromSelf) direction = "out";
    else if (toSelf) direction = "in";
    const note = [
      transaction.functionName ?? (transaction.isContractInteraction ? "contract call" : ""),
      transaction.tokenTransfers.length ? `${transaction.tokenTransfers.length} token transfers` : "",
      transaction.opReturn?.length ? "OP_RETURN" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { transaction, fromSelf, toSelf, direction, note };
  });
});

const columns: TableColumn<Row>[] = [
  { id: "hash", header: "Hash", meta: { class: { th: "w-[12rem]" } } },
  { id: "block", header: "Block", meta: { class: { th: "w-[8.5rem]", td: STACK.lastStart } } },
  { id: "route", header: "From → to", meta: { class: { td: STACK.line } } },
  { id: "value", header: "Value", meta: { class: { th: "w-[10rem] text-end", td: `text-end ${STACK.end}` } } },
  { id: "status", header: "Status", meta: { class: { th: "w-[6.5rem]", td: STACK.lastEnd } } },
];
</script>

<template>
  <p v-if="!items.length" class="explorers-note list-empty">No transactions on this page.</p>
  <UTable
    v-else
    :data="rows"
    :columns="columns"
    :get-row-id="(row) => row.transaction.hash"
    :ui="ROSTER_TABLE_UI"
  >
    <template #hash-cell="{ row }">
      <span class="list-stack">
        <ExplorerHash
          :value="row.original.transaction.hash"
          :to="txPath(chain, row.original.transaction.hash)"
          :head="10"
          strong
        />
        <UTooltip v-if="row.original.note" :text="row.original.note">
          <span class="list-sub explorers-clip">{{ row.original.note }}</span>
        </UTooltip>
      </span>
    </template>
    <template #block-cell="{ row }">
      <span class="list-stack">
        <NuxtLink
          v-if="row.original.transaction.blockNumber > 0"
          :to="blockPath(chain, row.original.transaction.blockNumber)"
          class="list-link"
          >{{ row.original.transaction.blockNumber }}</NuxtLink
        >
        <span v-else class="list-sub">pending</span>
        <UTooltip
          v-if="row.original.transaction.timestamp"
          :text="dateTime(row.original.transaction.timestamp)"
        >
          <span class="list-sub">{{ ago(row.original.transaction.timestamp) }}</span>
        </UTooltip>
        <span v-else class="list-sub">no time</span>
      </span>
    </template>
    <template #route-cell="{ row }">
      <span class="list-route">
        <span v-if="row.original.fromSelf" class="list-sub">this address</span>
        <ExplorerHash
          v-else
          :value="row.original.transaction.from"
          :to="addressPath(chain, row.original.transaction.from)"
        />
        <span
          class="list-dir"
          :class="{
            'list-dir-in': row.original.direction === 'in',
            'list-dir-out': row.original.direction === 'out',
          }"
          >{{ row.original.direction ?? "→" }}</span
        >
        <ExplorerHash
          v-if="row.original.transaction.createdContract"
          :value="row.original.transaction.createdContract"
          :to="addressPath(chain, row.original.transaction.createdContract)"
        />
        <span v-else-if="row.original.transaction.to === null" class="list-sub">none</span>
        <span v-else-if="row.original.transaction.to === ''" class="list-sub">data upload</span>
        <span v-else-if="row.original.toSelf" class="list-sub">this address</span>
        <ExplorerHash
          v-else
          :value="row.original.transaction.to"
          :to="addressPath(chain, row.original.transaction.to)"
        />
        <span v-if="row.original.transaction.createdContract" class="list-sub">created</span>
      </span>
    </template>
    <template #value-cell="{ row }">
      <span
        class="list-amount"
        :class="row.original.transaction.value === '0' ? 'list-sub' : 'explorers-value'"
        >{{ trimDecimals(row.original.transaction.valueFormatted, 6) }}
        <span class="list-sub">{{ symbol }}</span></span
      >
    </template>
    <template #status-cell="{ row }">
      <ExplorerStatus :status="row.original.transaction.status" />
    </template>
  </UTable>
</template>
