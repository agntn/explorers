<script setup lang="ts">
import type { BlockAnswer } from "../../utils/wire";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, formatUnits, groupDigits, trimDecimals } from "../../utils/format";
import { chainIcon, chainLabel, isEvm, providerLabel } from "../../utils/providers";

const props = defineProps<{ answer: BlockAnswer }>();

const block = computed(() => props.answer.block);
const external = computed(() => externalUrl("block", props.answer.chain, String(block.value.number)));
const hasGas = computed(() => block.value.gasLimit !== "0");
/** On the Bitcoin family the two gas fields carry size and weight, as `src/providers/mempool.ts` and `src/providers/blockstream.ts` map them. */
const evm = computed(() => isEvm(props.answer.chain));
/** Gas used as a share of the limit, from the two strings without a float on the raw values. */
const utilization = computed(() => {
  if (!hasGas.value || !/^\d+$/u.test(block.value.gasUsed) || !/^\d+$/u.test(block.value.gasLimit)) {
    return null;
  }
  const used = BigInt(block.value.gasUsed);
  const limit = BigInt(block.value.gasLimit);
  return limit > 0n ? Number((used * 10000n) / limit) / 100 : null;
});
const baseFeeText = computed(() => {
  const fee = block.value.baseFee;
  if (!fee) return null;
  return isEvm(props.answer.chain) ? `${trimDecimals(formatUnits(fee, 9), 4)} gwei` : groupDigits(fee);
});
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
      <UIcon :name="chainIcon(answer.chain)" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ chainLabel(answer.chain) }} block {{ block.number }}</span>
      <span class="font-mono text-[11px] text-dimmed">{{ dateTime(block.timestamp) }}</span>
      <span class="ms-auto flex items-center gap-1">
        <NuxtLink v-if="block.number > 0" :to="blockPath(answer.chain, block.number - 1)" class="explorers-copy" aria-label="Previous block">
          <UIcon name="i-solar-alt-arrow-left-linear" class="size-3.5" /> {{ block.number - 1 }}
        </NuxtLink>
        <NuxtLink :to="blockPath(answer.chain, block.number + 1)" class="explorers-copy" aria-label="Next block">
          {{ block.number + 1 }} <UIcon name="i-solar-alt-arrow-right-linear" class="size-3.5" />
        </NuxtLink>
      </span>
    </div>
    <dl class="grid grid-cols-2 border-b border-muted sm:grid-cols-4">
      <div class="border-muted px-4 py-3.5">
        <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">transactions</dt>
        <dd class="mt-1 font-mono text-lg text-highlighted">{{ block.txCount }}</dd>
      </div>
      <div class="border-l border-muted px-4 py-3.5">
        <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">{{ evm ? "gas used" : "size" }}</dt>
        <dd class="mt-1 font-mono text-lg text-highlighted">{{ hasGas ? groupDigits(block.gasUsed) : "n/a" }}</dd>
        <div v-if="utilization !== null" class="mt-2 h-1 overflow-hidden rounded-full bg-accented">
          <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.min(100, utilization)}%` }" />
        </div>
        <p v-if="utilization !== null" class="mt-1 font-mono text-[10px] text-dimmed">{{ utilization }}% of the {{ evm ? "limit" : "weight cap" }}</p>
      </div>
      <div class="border-t border-muted px-4 py-3.5 sm:border-t-0 sm:border-l">
        <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">{{ evm ? "gas limit" : "weight" }}</dt>
        <dd class="mt-1 font-mono text-lg text-highlighted">{{ hasGas ? groupDigits(block.gasLimit) : "n/a" }}</dd>
      </div>
      <div class="border-t border-l border-muted px-4 py-3.5 sm:border-t-0">
        <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">base fee</dt>
        <dd class="mt-1 font-mono text-lg text-highlighted">{{ baseFeeText ?? "none" }}</dd>
      </div>
    </dl>
    <dl class="explorers-kv">
      <dt>hash</dt>
      <dd class="font-mono text-[13px] break-all">{{ block.hash }}</dd>
      <dt>parentHash</dt>
      <dd class="font-mono text-[13px] break-all">
        <NuxtLink v-if="block.number > 0" :to="blockPath(answer.chain, block.number - 1)" class="hover:text-primary">{{ block.parentHash }}</NuxtLink>
        <span v-else>{{ block.parentHash }}</span>
      </dd>
      <dt>timestamp</dt>
      <dd class="font-mono text-[13px]">{{ block.timestamp }}</dd>
      <dt>miner</dt>
      <dd class="font-mono text-[13px] break-all">
        <NuxtLink v-if="block.miner" :to="addressPath(answer.chain, block.miner)" class="hover:text-primary">{{ block.miner }}</NuxtLink>
        <span v-else class="text-dimmed">empty · the explorer names no producer</span>
      </dd>
      <dt>provider</dt>
      <dd class="font-mono text-[13px]">{{ providerLabel(answer.provider) }} <span class="text-dimmed">· fetched {{ dateTime(answer.fetchedAt) }}</span></dd>
      <dt>elsewhere</dt>
      <dd class="font-mono text-[13px]">
        <a v-if="external" :href="external" target="_blank" rel="noopener nofollow" class="inline-flex items-center gap-1 hover:text-primary">
          {{ externalHost(answer.chain) }} <UIcon name="i-solar-arrow-right-up-linear" class="size-3.5" />
        </a>
        <span v-else class="text-dimmed">no canonical explorer link for this chain</span>
      </dd>
    </dl>
  </div>
</template>
