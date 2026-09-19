<script setup lang="ts">
import type { DetailAnswer } from "../../utils/wire";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, formatUnits, groupDigits, shortHash, trimDecimals } from "../../utils/format";
import { chainIcon, chainInfo, chainLabel, isEvm, nativeDecimals, providerLabel } from "../../utils/providers";

const props = defineProps<{ answer: DetailAnswer }>();

const transaction = computed(() => props.answer.transaction);
const symbol = computed(() => chainInfo(props.answer.chain)?.symbol ?? "");
const external = computed(() => externalUrl("tx", props.answer.chain, transaction.value.hash));
const decimals = computed(() => nativeDecimals(props.answer.chain));
const feeFormatted = computed(() =>
  transaction.value.fee ? trimDecimals(formatUnits(transaction.value.fee, decimals.value), 8) : null,
);
/** Gas price in gwei on EVM chains; other chains keep the smallest unit. */
const gasPriceText = computed(() => {
  const price = transaction.value.gasPrice;
  if (!price) return null;
  return isEvm(props.answer.chain) ? `${trimDecimals(formatUnits(price, 9), 4)} gwei` : groupDigits(price);
});
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
      <UIcon :name="chainIcon(answer.chain)" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ chainLabel(answer.chain) }} transaction</span>
      <ExplorerStatus :status="transaction.status" />
      <span class="ms-auto font-mono text-[11px] text-dimmed">
        via {{ providerLabel(answer.provider) }} · fetched {{ dateTime(answer.fetchedAt) }}
      </span>
    </div>
    <dl class="explorers-kv">
      <dt>hash</dt>
      <dd class="font-mono text-[13px] break-all">{{ transaction.hash }}</dd>
      <dt>block</dt>
      <dd class="font-mono text-[13px]">
        <NuxtLink v-if="transaction.blockNumber > 0" :to="blockPath(answer.chain, transaction.blockNumber)" class="hover:text-primary">{{ transaction.blockNumber }}</NuxtLink>
        <span v-else>0 <span class="text-dimmed">· pending, no block yet</span></span>
        <span v-if="transaction.timestamp" class="text-dimmed"> · {{ dateTime(transaction.timestamp) }}</span>
      </dd>
      <dt>from</dt>
      <dd class="font-mono text-[13px] break-all">
        <NuxtLink :to="addressPath(answer.chain, transaction.from)" class="hover:text-primary">{{ transaction.from }}</NuxtLink>
      </dd>
      <dt>to</dt>
      <dd class="font-mono text-[13px] break-all">
        <span v-if="transaction.to === null">null <span class="text-dimmed">· {{ transaction.createdContract ? "a contract creation" : "no recipient" }}</span></span>
        <span v-else-if="transaction.to === ''" class="text-dimmed">empty · a data upload, no recipient</span>
        <NuxtLink v-else :to="addressPath(answer.chain, transaction.to)" class="hover:text-primary">{{ transaction.to }}</NuxtLink>
      </dd>
      <template v-if="transaction.createdContract">
        <dt>created contract</dt>
        <dd class="font-mono text-[13px] break-all">
          <NuxtLink :to="addressPath(answer.chain, transaction.createdContract)" class="hover:text-primary">{{ transaction.createdContract }}</NuxtLink>
        </dd>
      </template>
      <dt>value</dt>
      <dd class="font-mono text-[13px]">
        <span class="text-highlighted">{{ trimDecimals(transaction.valueFormatted, 8) }} {{ symbol }}</span>
        <span class="text-dimmed"> · "{{ groupDigits(transaction.value) }}"</span>
      </dd>
      <dt>fee</dt>
      <dd class="font-mono text-[13px]">
        <span v-if="feeFormatted" class="text-highlighted">{{ feeFormatted }} {{ symbol }}</span>
        <span v-if="transaction.fee" class="text-dimmed"> · "{{ groupDigits(transaction.fee) }}"</span>
        <span v-else class="text-dimmed">absent</span>
        <span v-if="transaction.gasUsed" class="text-dimmed"> · gas used {{ groupDigits(transaction.gasUsed) }}</span>
        <span v-if="gasPriceText" class="text-dimmed"> · gas price {{ gasPriceText }}</span>
      </dd>
      <dt>method</dt>
      <dd class="font-mono text-[13px]">
        {{ transaction.functionName ?? transaction.methodId ?? "absent" }}
        <span class="text-dimmed"> · isContractInteraction {{ transaction.isContractInteraction }}</span>
      </dd>
      <dt>token transfers</dt>
      <dd class="font-mono text-[13px]">
        <span v-if="!transaction.tokenTransfers.length" class="text-dimmed">none</span>
        <span
          v-for="transfer in transaction.tokenTransfers"
          :key="transfer.contract + transfer.from + transfer.to + transfer.value"
          class="block"
        >
          <span class="text-highlighted">{{ trimDecimals(transfer.valueFormatted, 6) }}</span>
          <NuxtLink :to="addressPath(answer.chain, transfer.contract)" class="ms-1 hover:text-primary">{{ transfer.symbol }}</NuxtLink>
          <span class="text-dimmed"> · </span>
          <NuxtLink :to="addressPath(answer.chain, transfer.from)" class="hover:text-primary">{{ shortHash(transfer.from, 6, 4) }}</NuxtLink>
          <span class="text-dimmed"> → </span>
          <NuxtLink :to="addressPath(answer.chain, transfer.to)" class="hover:text-primary">{{ shortHash(transfer.to, 6, 4) }}</NuxtLink>
        </span>
      </dd>
      <template v-if="transaction.opReturn?.length">
        <dt>OP_RETURN</dt>
        <dd class="font-mono text-[13px]">
          <span v-for="payload in transaction.opReturn" :key="payload.hex" class="block break-all">
            <span v-if="payload.text">{{ payload.text }} <span class="text-dimmed">· {{ payload.hex }}</span></span>
            <span v-else>{{ payload.hex }} <span class="text-dimmed">· binary, no text reading</span></span>
          </span>
        </dd>
      </template>
      <dt>elsewhere</dt>
      <dd class="font-mono text-[13px]">
        <a v-if="external" :href="external" target="_blank" rel="noopener nofollow" class="inline-flex items-center gap-1 hover:text-primary">
          {{ externalHost(answer.chain) }} <UIcon name="i-lucide-arrow-up-right" class="size-3.5" />
        </a>
        <span v-else class="text-dimmed">no canonical explorer link for this chain</span>
      </dd>
    </dl>
  </div>
</template>
