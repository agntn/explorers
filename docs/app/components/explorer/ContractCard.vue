<script setup lang="ts">
import type { ContractAnswer } from "../../utils/wire";
import { addressPath, txPath } from "../../utils/entities";
import { groupDigits } from "../../utils/format";

defineProps<{ answer: ContractAnswer }>();
</script>

<template>
  <div class="explorers-band">
    <p class="console-label console-rule-title">
      <!-- The name comes from whoever verified the contract: interpolated, never markup. -->
      <span
        ><span class="console-label-key">{{ answer.contract.name ?? "unnamed contract" }}</span>
        <span aria-hidden="true">[ getContractInfo ]</span></span
      >
      <span class="console-mark" aria-hidden="true" />
    </p>
    <p class="explorers-tags contract-tags">
      <span class="explorers-state" :class="{ 'explorers-state-warn': answer.contract.isVerified }">{{
        answer.contract.isVerified ? "verified" : "unverified"
      }}</span>
      <span v-if="answer.contract.isProxy" class="explorers-state explorers-state-warn">proxy</span>
      <span v-if="answer.contract.isToken" class="explorers-state">{{
        answer.contract.tokenStandard ?? "token"
      }}</span>
    </p>
    <dl class="explorers-facts">
      <div>
        <dt>Compiler</dt>
        <dd>{{ answer.contract.compilerVersion ?? "absent" }}</dd>
      </div>
      <div>
        <dt>Implementation</dt>
        <dd>
          <NuxtLink
            v-if="answer.contract.implementationAddress"
            :to="addressPath(answer.chain, answer.contract.implementationAddress)"
            >{{ answer.contract.implementationAddress }}</NuxtLink
          >
          <span v-else class="explorers-dim">absent</span>
        </dd>
      </div>
      <div>
        <dt>Creator</dt>
        <dd>
          <NuxtLink
            v-if="answer.contract.creator"
            :to="addressPath(answer.chain, answer.contract.creator)"
            >{{ answer.contract.creator }}</NuxtLink
          >
          <span v-else class="explorers-dim">absent</span>
        </dd>
      </div>
      <div>
        <dt>Creation tx</dt>
        <dd>
          <NuxtLink
            v-if="answer.contract.creationTxHash"
            :to="txPath(answer.chain, answer.contract.creationTxHash)"
            >{{ answer.contract.creationTxHash }}</NuxtLink
          >
          <span v-else class="explorers-dim">absent</span>
        </dd>
      </div>
      <div>
        <dt>ABI</dt>
        <dd>
          {{ answer.contract.abiEntries === null ? "absent" : `${answer.contract.abiEntries} entries` }}
        </dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>
          <template v-if="answer.contract.sourceLength === null">absent</template>
          <template v-else
            >{{ groupDigits(String(answer.contract.sourceLength)) }} characters
            <span class="explorers-dim">· the library returns it, this page doesn't</span></template
          >
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.contract-tags {
  margin: 0 0 8px;
}
</style>
