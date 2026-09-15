<script setup lang="ts">
import type { TokenBalance } from "@agntn/explorers";
import { addressPath } from "../../utils/entities";
import { clip, shortHash, trimDecimals } from "../../utils/format";

defineProps<{ chain: string; items: TokenBalance[]; total: number }>();
</script>

<template>
  <p v-if="!items.length" class="px-4 py-6 text-sm text-muted">No token holdings with a balance.</p>
  <div v-else class="explorers-table-wrap">
    <table class="explorers-table">
      <thead>
        <tr>
          <th>token</th>
          <th class="text-right">balance</th>
          <th>decimals</th>
          <th>contract</th>
          <th class="text-right">value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="holding in items" :key="holding.contract">
          <td>
            <span class="font-mono text-xs text-highlighted">{{ clip(holding.symbol, 12) }}</span>
            <span v-if="holding.name" class="ms-2 text-xs text-muted">{{ clip(holding.name, 32) }}</span>
          </td>
          <td class="text-right font-mono text-xs text-highlighted whitespace-nowrap">{{ trimDecimals(holding.balanceFormatted, 6) }}</td>
          <td class="font-mono text-xs text-muted">{{ holding.decimals }}</td>
          <td class="font-mono text-xs">
            <NuxtLink :to="addressPath(chain, holding.contract)" class="text-muted hover:text-primary" :title="holding.contract">{{ shortHash(holding.contract, 8, 6) }}</NuxtLink>
          </td>
          <td class="text-right font-mono text-xs text-muted whitespace-nowrap">
            {{ holding.valueUsd !== undefined ? `$${holding.valueUsd.toFixed(2)}` : "no quote" }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="total > items.length" class="border-t border-muted px-4 py-3 font-mono text-[11px] text-dimmed">
    {{ total }} holdings in total, the first {{ items.length }} shown. The library returns them all.
  </p>
</template>
