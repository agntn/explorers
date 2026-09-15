<script setup lang="ts">
import type { WireTransaction } from "../../utils/wire";
import { addressPath, blockPath, txPath } from "../../utils/entities";
import { ago, dateTime, shortHash, trimDecimals } from "../../utils/format";
import { chainInfo } from "../../utils/providers";

const props = defineProps<{
  chain: string;
  items: WireTransaction[];
  /** The address the list belongs to, so its side of each row is muted and the other side links. */
  address?: string;
}>();

const symbol = computed(() => chainInfo(props.chain)?.symbol ?? "");

type Direction = "in" | "out" | "self" | null;

/** Each row with its sides classified once, not once per cell. */
const rows = computed(() => {
  const own = props.address?.toLowerCase();
  return props.items.map((transaction) => {
    const fromSelf = own !== undefined && transaction.from.toLowerCase() === own;
    const toSelf = own !== undefined && transaction.to !== null && transaction.to.toLowerCase() === own;
    let direction: Direction = null;
    if (fromSelf && toSelf) direction = "self";
    else if (fromSelf) direction = "out";
    else if (toSelf) direction = "in";
    return { transaction, fromSelf, toSelf, direction };
  });
});
</script>

<template>
  <p v-if="!items.length" class="px-4 py-6 text-sm text-muted">No transactions on this page.</p>
  <div v-else class="explorers-table-wrap">
    <table class="explorers-table">
      <thead>
        <tr>
          <th>hash</th>
          <th>block</th>
          <th>age</th>
          <th>from</th>
          <th v-if="address" class="text-center"></th>
          <th>to</th>
          <th class="text-right">value</th>
          <th>status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ transaction, fromSelf, toSelf, direction } in rows" :key="transaction.hash">
          <td class="font-mono text-xs whitespace-nowrap">
            <NuxtLink :to="txPath(chain, transaction.hash)" class="text-highlighted hover:text-primary" :title="transaction.hash">
              {{ shortHash(transaction.hash, 10, 6) }}
            </NuxtLink>
            <p v-if="transaction.functionName || transaction.tokenTransfers.length || transaction.opReturn?.length" class="mt-0.5 text-[11px] text-dimmed">
              {{ transaction.functionName ?? (transaction.isContractInteraction ? "contract call" : "") }}
              {{ transaction.tokenTransfers.length ? ` · ${transaction.tokenTransfers.length} token transfers` : "" }}
              {{ transaction.opReturn?.length ? " · OP_RETURN" : "" }}
            </p>
          </td>
          <td class="font-mono text-xs text-muted">
            <NuxtLink v-if="transaction.blockNumber > 0" :to="blockPath(chain, transaction.blockNumber)" class="hover:text-primary">{{ transaction.blockNumber }}</NuxtLink>
            <span v-else class="text-dimmed">pending</span>
          </td>
          <td class="font-mono text-xs text-muted whitespace-nowrap" :title="transaction.timestamp ? dateTime(transaction.timestamp) : ''">{{ transaction.timestamp ? ago(transaction.timestamp) : "no time" }}</td>
          <td class="font-mono text-xs">
            <span v-if="fromSelf" class="text-dimmed">this address</span>
            <NuxtLink v-else :to="addressPath(chain, transaction.from)" class="text-muted hover:text-primary" :title="transaction.from">{{ shortHash(transaction.from, 8, 6) }}</NuxtLink>
          </td>
          <td v-if="address" class="text-center">
            <span
              v-if="direction"
              class="explorers-state"
              :class="{ 'explorers-state-ok': direction === 'in', 'explorers-state-warn': direction === 'out' }"
              >{{ direction }}</span
            >
          </td>
          <td class="font-mono text-xs">
            <span v-if="transaction.to === null" class="text-dimmed">contract creation</span>
            <span v-else-if="toSelf" class="text-dimmed">this address</span>
            <NuxtLink v-else :to="addressPath(chain, transaction.to)" class="text-muted hover:text-primary" :title="transaction.to">{{ shortHash(transaction.to, 8, 6) }}</NuxtLink>
          </td>
          <td class="text-right font-mono text-xs whitespace-nowrap" :class="transaction.value === '0' ? 'text-dimmed' : 'text-highlighted'">
            {{ trimDecimals(transaction.valueFormatted, 6) }} {{ symbol }}
          </td>
          <td><ExplorerStatus :status="transaction.status" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
