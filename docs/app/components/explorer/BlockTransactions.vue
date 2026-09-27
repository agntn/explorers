<script setup lang="ts">
import type { BlockTransactionsAnswer } from "../../utils/wire";
import { hasTip } from "#shared/tip-chains";
import type { TableColumn } from "@nuxt/ui";
import type { BlockTransaction } from "../../utils/wire";
import { addressPath, txPath } from "../../utils/entities";
import { STACK } from "../../utils/entity-table";
import { trimDecimals } from "../../utils/format";
import { ROSTER_TABLE_UI } from "../../utils/roster";
import { chainInfo } from "../../utils/providers";

const columns: TableColumn<BlockTransaction>[] = [
  { id: "hash", header: "Hash", meta: { class: { th: "w-[14rem]" } } },
  { id: "route", header: "From → to", meta: { class: { td: STACK.line } } },
  { id: "value", header: "Value", meta: { class: { th: "w-[11rem] text-end", td: `text-end ${STACK.end}` } } },
  { id: "status", header: "Status", meta: { class: { th: "w-[6.5rem]", td: STACK.lastEnd } } },
];

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
  <section class="tool-console console-wide not-prose" aria-label="Transactions in this block">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">List</span>block {{ number }} transactions</span
      >
      <span class="console-meta">{{
        answer
          ? `${answer.total !== null ? `${answer.items.length} of ${answer.total}` : answer.items.length} · via ${answer.source}`
          : feedless
            ? "no list endpoint"
            : ""
      }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span class="console-cursor" :class="{ 'console-cursor-busy': loading }" />
    </div>

    <div v-if="feedless || loading || error || (answer && !answer.items.length)" class="explorers-band">
      <p v-if="feedless" class="explorers-note">
        This chain's explorer doesn't list a block's transactions through a public endpoint, so
        there's nothing to show here.
      </p>
      <p v-else-if="answer && !answer.items.length && !loading" class="explorers-note">An empty block.</p>
      <ExplorerState v-else :loading="loading" :error="error" label="Reading the block's transactions" />
    </div>
    <UTable
      v-else-if="answer"
      :data="answer.items"
      :columns="columns"
      :get-row-id="(row) => row.hash"
      :ui="ROSTER_TABLE_UI"
    >
      <template #hash-cell="{ row }">
        <span class="list-stack">
          <ExplorerHash :value="row.original.hash" :to="txPath(chain, row.original.hash)" :head="12" strong />
          <span v-if="row.original.method" class="list-sub explorers-clip">{{ row.original.method }}</span>
        </span>
      </template>
      <template #route-cell="{ row }">
        <span class="list-route">
          <ExplorerHash v-if="row.original.from" :value="row.original.from" :to="addressPath(chain, row.original.from)" />
          <span v-else class="list-sub">none</span>
          <span class="list-dir">→</span>
          <ExplorerHash v-if="row.original.to" :value="row.original.to" :to="addressPath(chain, row.original.to)" />
          <span v-else class="list-sub">none</span>
        </span>
      </template>
      <template #value-cell="{ row }">
        <span
          v-if="row.original.valueFormatted"
          class="list-amount"
          :class="row.original.value === '0' ? 'list-sub' : 'explorers-value'"
          >{{ trimDecimals(row.original.valueFormatted, 6) }}
          <span class="list-sub">{{ symbol }}</span></span
        >
      </template>
      <template #status-cell="{ row }">
        <ExplorerStatus :status="row.original.status" />
      </template>
    </UTable>

    <footer class="console-footer console-footer-plain">
      <span>The list comes from the explorer's own endpoint, outside the library.</span>
    </footer>
  </section>
</template>
