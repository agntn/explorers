<script setup lang="ts">
import type { BalanceAnswer } from "../../utils/wire";
import { useClipboard } from "@vueuse/core";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, groupDigits, trimDecimals } from "../../utils/format";
import { CHAINS, chainIcon, chainLabel, isEvm, providerLabel } from "../../utils/providers";

const props = defineProps<{ answer: BalanceAnswer }>();

const balance = computed(() => props.answer.balance);
const external = computed(() => externalUrl("address", props.answer.chain, balance.value.address));

/** The same address on the other chains of the same family; an EVM address is valid on every EVM chain. */
const siblings = computed(() =>
  isEvm(props.answer.chain)
    ? CHAINS.filter((chain) => chain.type === "evm" && chain.key !== props.answer.chain)
    : [],
);

const { copy: copyAddress, copied } = useClipboard({
  source: computed(() => balance.value.address),
  copiedDuring: 1200,
});
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
      <UIcon :name="chainIcon(answer.chain)" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ chainLabel(answer.chain) }}</span>
      <span class="font-mono text-[11px] text-dimmed">
        via {{ providerLabel(answer.provider) }}
        {{ answer.input !== balance.address ? ` · ${answer.input}` : "" }}
      </span>
      <span class="ms-auto font-mono text-[11px] text-dimmed">fetched {{ dateTime(answer.fetchedAt) }}</span>
    </div>
    <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div class="border-muted px-4 py-5 lg:border-r">
        <p class="explorers-eyebrow">balance</p>
        <p class="explorers-amount mt-2 text-highlighted">
          {{ trimDecimals(balance.balanceFormatted, 8) }}
          <span class="text-primary">{{ balance.symbol }}</span>
        </p>
        <p class="mt-2 font-mono text-[11px] text-dimmed">
          "{{ groupDigits(balance.balance) }}" in the smallest unit, exact
        </p>
        <p v-if="balance.unconfirmed !== undefined && balance.unconfirmed !== '0'" class="mt-2 font-mono text-[11px] text-dimmed">
          unconfirmed {{ balance.unconfirmed.startsWith("-") ? "" : "+" }}{{ groupDigits(balance.unconfirmed) }} · in the mempool, not in the balance
        </p>
        <div v-if="balance.funded !== undefined" class="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">funded</p>
            <p class="mt-1 font-mono text-[13px] text-highlighted">{{ groupDigits(balance.funded) }}</p>
          </div>
          <div>
            <p class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">spent</p>
            <p class="mt-1 font-mono text-[13px] text-highlighted">{{ groupDigits(balance.spent ?? "0") }}</p>
          </div>
        </div>
      </div>
      <dl class="explorers-kv border-t border-muted lg:border-t-0">
        <dt>address</dt>
        <dd class="font-mono text-[13px]">
          <span class="break-all">{{ balance.address }}</span>
          <button
            type="button"
            class="explorers-copy ms-1 align-middle"
            :aria-label="copied ? 'Copied' : 'Copy address'"
            :data-copied="copied"
            @click="copyAddress()"
          >
            <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" />
          </button>
        </dd>
        <dt>blockNumber</dt>
        <dd class="font-mono text-[13px]">
          <NuxtLink
            v-if="balance.blockNumber !== null"
            :to="blockPath(answer.chain, balance.blockNumber)"
            class="hover:text-primary"
            >{{ balance.blockNumber }}</NuxtLink
          >
          <span v-else>null <span class="text-dimmed">· the explorer named no block</span></span>
        </dd>
        <dt>blockHash</dt>
        <dd class="font-mono text-[13px] break-all">{{ balance.blockHash ?? "null" }}</dd>
        <dt>fetchedAt</dt>
        <dd class="font-mono text-[13px]">{{ balance.fetchedAt }}</dd>
        <dt>elsewhere</dt>
        <dd class="font-mono text-[13px]">
          <a
            v-if="external"
            :href="external"
            target="_blank"
            rel="noopener nofollow"
            class="inline-flex items-center gap-1 hover:text-primary"
            >{{ externalHost(answer.chain) }} <UIcon name="i-lucide-arrow-up-right" class="size-3.5" /></a
          >
          <span v-else class="text-dimmed">no canonical explorer link for this chain</span>
        </dd>
      </dl>
    </div>
    <div v-if="siblings.length" class="flex flex-wrap items-center gap-1.5 border-t border-muted px-4 py-3">
      <span class="me-1 font-mono text-[11px] text-dimmed">same address on</span>
      <NuxtLink
        v-for="chain in siblings"
        :key="chain.key"
        :to="addressPath(chain.key, balance.address)"
        class="explorers-chip explorers-chip-small hover:text-highlighted"
      >
        <UIcon :name="chain.icon" class="size-3" /> {{ chain.name }}
      </NuxtLink>
    </div>
  </div>
</template>
