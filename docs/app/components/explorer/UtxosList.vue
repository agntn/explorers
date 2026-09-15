<script setup lang="ts">
import type { Utxo } from "@agntn/explorers";
import { blockPath, txPath } from "../../utils/entities";
import { ago, dateTime, shortHash, trimDecimals } from "../../utils/format";
import { chainInfo } from "../../utils/providers";

const props = defineProps<{ chain: string; items: Utxo[]; total: number }>();

const symbol = computed(() => chainInfo(props.chain)?.symbol ?? "");
</script>

<template>
  <p v-if="!items.length" class="px-4 py-6 text-sm text-muted">Nothing unspent. Every output this address ever received is gone.</p>
  <div v-else class="explorers-table-wrap">
    <table class="explorers-table">
      <thead>
        <tr>
          <th>output</th>
          <th>block</th>
          <th>age</th>
          <th class="text-right">value</th>
          <th>state</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="utxo in items" :key="`${utxo.txid}:${utxo.vout}`">
          <td class="font-mono text-xs whitespace-nowrap">
            <NuxtLink :to="txPath(chain, utxo.txid)" class="text-highlighted hover:text-primary" :title="utxo.txid">{{ shortHash(utxo.txid, 10, 6) }}</NuxtLink>
            <span class="text-dimmed">:{{ utxo.vout }}</span>
          </td>
          <td class="font-mono text-xs text-muted">
            <NuxtLink v-if="utxo.blockNumber !== null" :to="blockPath(chain, utxo.blockNumber)" class="hover:text-primary">{{ utxo.blockNumber }}</NuxtLink>
            <span v-else class="text-dimmed">mempool</span>
          </td>
          <td class="font-mono text-xs text-muted whitespace-nowrap" :title="utxo.timestamp ? dateTime(utxo.timestamp) : ''">{{ utxo.timestamp ? ago(utxo.timestamp) : "no time" }}</td>
          <td class="text-right font-mono text-xs text-highlighted whitespace-nowrap">{{ trimDecimals(utxo.valueFormatted, 8) }} {{ symbol }}</td>
          <td><span class="explorers-state" :class="utxo.confirmed ? 'explorers-state-ok' : ''">{{ utxo.confirmed ? "confirmed" : "pending" }}</span></td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="total > items.length" class="border-t border-muted px-4 py-3 font-mono text-[11px] text-dimmed">
    {{ total }} unspent outputs in total, the first {{ items.length }} shown. The library returns them all.
  </p>
</template>
