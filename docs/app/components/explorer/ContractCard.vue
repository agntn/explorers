<script setup lang="ts">
import type { ContractAnswer } from "../../utils/wire";
import { addressPath, txPath } from "../../utils/entities";
import { dateTime, groupDigits, shortHash } from "../../utils/format";
import { providerLabel } from "../../utils/providers";

defineProps<{ answer: ContractAnswer }>();
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
      <UIcon name="i-lucide-file-code" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ answer.contract.name ?? "unnamed contract" }}</span>
      <span class="explorers-state" :class="answer.contract.isVerified ? 'explorers-state-ok' : ''">{{
        answer.contract.isVerified ? "verified" : "unverified"
      }}</span>
      <span v-if="answer.contract.isProxy" class="explorers-state explorers-state-warn">proxy</span>
      <span v-if="answer.contract.isToken" class="explorers-state">{{ answer.contract.tokenStandard ?? "token" }}</span>
      <span class="ms-auto font-mono text-[11px] text-dimmed">
        {{ providerLabel(answer.provider) }} · fetched {{ dateTime(answer.fetchedAt) }}
      </span>
    </div>
    <dl class="explorers-kv">
      <dt>compiler</dt>
      <dd class="font-mono text-[13px]">{{ answer.contract.compilerVersion ?? "absent" }}</dd>
      <dt>implementation</dt>
      <dd class="font-mono text-[13px]">
        <NuxtLink
          v-if="answer.contract.implementationAddress"
          :to="addressPath(answer.chain, answer.contract.implementationAddress)"
          class="hover:text-primary"
          >{{ answer.contract.implementationAddress }}</NuxtLink
        >
        <span v-else>absent</span>
      </dd>
      <dt>creator</dt>
      <dd class="font-mono text-[13px]">
        <NuxtLink v-if="answer.contract.creator" :to="addressPath(answer.chain, answer.contract.creator)" class="hover:text-primary">{{ answer.contract.creator }}</NuxtLink>
        <span v-else>absent</span>
      </dd>
      <dt>creation tx</dt>
      <dd class="font-mono text-[13px]">
        <NuxtLink v-if="answer.contract.creationTxHash" :to="txPath(answer.chain, answer.contract.creationTxHash)" class="hover:text-primary">{{ shortHash(answer.contract.creationTxHash, 14, 10) }}</NuxtLink>
        <span v-else>absent</span>
      </dd>
      <dt>abi</dt>
      <dd class="font-mono text-[13px]">
        {{ answer.contract.abiEntries === null ? "absent" : `${answer.contract.abiEntries} entries` }}
      </dd>
      <dt>sourceCode</dt>
      <dd class="font-mono text-[13px]">
        {{ answer.contract.sourceLength === null ? "absent" : `${groupDigits(String(answer.contract.sourceLength))} characters; the library returns it, this page doesn't` }}
      </dd>
    </dl>
  </div>
</template>
