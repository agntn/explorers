<script setup lang="ts">
import type { TokenTransfer } from "@agntn/explorers";
import { addressPath, blockPath, txPath } from "../../utils/entities";
import { ago, clip, dateTime, shortHash, trimDecimals } from "../../utils/format";

const props = defineProps<{ chain: string; items: TokenTransfer[]; address?: string }>();

function isSelf(value: string): boolean {
  return props.address !== undefined && value.toLowerCase() === props.address.toLowerCase();
}
</script>

<template>
  <p v-if="!items.length" class="px-4 py-6 text-sm text-muted">No token transfers on this page.</p>
  <div v-else class="explorers-table-wrap">
    <table class="explorers-table">
      <thead>
        <tr>
          <th>transaction</th>
          <th>block</th>
          <th>age</th>
          <th>from</th>
          <th>to</th>
          <th class="text-right">amount</th>
          <th>token</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="transfer in items" :key="transfer.txHash + transfer.contract + transfer.from + transfer.to + transfer.value">
          <td class="font-mono text-xs">
            <NuxtLink :to="txPath(chain, transfer.txHash)" class="text-highlighted hover:text-primary" :title="transfer.txHash">{{ shortHash(transfer.txHash, 10, 6) }}</NuxtLink>
          </td>
          <td class="font-mono text-xs text-muted">
            <NuxtLink :to="blockPath(chain, transfer.blockNumber)" class="hover:text-primary">{{ transfer.blockNumber }}</NuxtLink>
          </td>
          <td class="font-mono text-xs text-muted whitespace-nowrap" :title="transfer.timestamp ? dateTime(transfer.timestamp) : ''">{{ transfer.timestamp ? ago(transfer.timestamp) : "no time" }}</td>
          <td class="font-mono text-xs">
            <span v-if="isSelf(transfer.from)" class="text-dimmed">this address</span>
            <NuxtLink v-else :to="addressPath(chain, transfer.from)" class="text-muted hover:text-primary" :title="transfer.from">{{ shortHash(transfer.from, 8, 6) }}</NuxtLink>
          </td>
          <td class="font-mono text-xs">
            <span v-if="isSelf(transfer.to)" class="text-dimmed">this address</span>
            <NuxtLink v-else :to="addressPath(chain, transfer.to)" class="text-muted hover:text-primary" :title="transfer.to">{{ shortHash(transfer.to, 8, 6) }}</NuxtLink>
          </td>
          <td class="text-right font-mono text-xs text-highlighted whitespace-nowrap">{{ trimDecimals(transfer.valueFormatted, 6) }}</td>
          <td>
            <NuxtLink :to="addressPath(chain, transfer.contract)" class="font-mono text-xs text-muted hover:text-primary" :title="transfer.contract">{{ clip(transfer.symbol, 12) }}</NuxtLink>
            <span v-if="transfer.name" class="ms-2 text-xs text-dimmed">{{ clip(transfer.name, 24) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
