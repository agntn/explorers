<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { shortHash, trimDecimals } from "../../utils/format";
import { providerInfo } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample }>();

const info = computed(() => providerInfo(props.sample.provider));
const fileName = computed(() => `${props.sample.chain}.ts`);
const keyNote = computed(() =>
  info.value && info.value.envVars.length > 0
    ? `${info.value.envVars[0]} in the environment`
    : "keyless, nothing to configure",
);
const first = computed(() => props.sample.history[0]);
</script>

<template>
  <div class="explorers-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <span class="font-mono text-[10px] font-bold text-primary">TS</span>
      <span class="text-sm text-default">
        <Transition name="explorers-roll" mode="out-in">
          <span :key="fileName">{{ fileName }}</span>
        </Transition>
      </span>
    </div>
    <pre
      class="explorers-rotating"
    ><code><span class="tok-kw">import</span> { create, resolveAddresses, resolveProvider } <span class="tok-kw">from</span> <span class="tok-str">"@agntn/explorers"</span>;

<span class="tok-cm">// <Transition name="explorers-roll" mode="out-in"><span :key="sample.provider" class="explorers-roll-slot">{{ sample.provider }}</span></Transition>: <Transition name="explorers-roll" mode="out-in"><span :key="keyNote" class="explorers-roll-slot">{{ keyNote }}</span></Transition></span>
<span class="tok-kw">const</span> name = <span class="tok-fn">resolveProvider</span>(<span class="tok-kw">undefined</span>, <span class="tok-str">"<Transition name="explorers-roll" mode="out-in"><span :key="sample.chain" class="explorers-roll-slot">{{ sample.chain }}</span></Transition>"</span>);
<span class="tok-kw">const</span> provider = <span class="tok-kw">await</span> <span class="tok-fn">create</span>(name);

<span class="tok-kw">const</span> [address] = <span class="tok-kw">await</span> <span class="tok-fn">resolveAddresses</span>(<span class="tok-str">"<Transition name="explorers-roll" mode="out-in"><span :key="sample.input" class="explorers-roll-slot">{{ sample.input }}</span></Transition>"</span>, <span class="tok-str">"{{ sample.chain }}"</span>);
<span class="tok-kw">const</span> balance = <span class="tok-kw">await</span> provider.<span class="tok-fn">getBalance</span>(address, <span class="tok-str">"{{ sample.chain }}"</span>);
<span class="tok-kw">const</span> history = <span class="tok-kw">await</span> provider.<span class="tok-fn">getTxHistory</span>(address, <span class="tok-str">"{{ sample.chain }}"</span>, { limit: <span class="tok-const">5</span> });

balance.balanceFormatted;  <span class="tok-cm">// "<Transition name="explorers-roll" mode="out-in"><span :key="sample.balance.balance" class="explorers-roll-slot">{{ trimDecimals(sample.balance.balanceFormatted, 8) }}</span></Transition>" {{ sample.balance.symbol }}, exact, a string</span>
history[0]?.hash;          <span class="tok-cm">// "<Transition name="explorers-roll" mode="out-in"><span :key="first?.hash ?? 'none'" class="explorers-roll-slot">{{ first ? shortHash(first.hash, 12, 6) : "" }}</span></Transition>", same Transaction shape from <Transition name="explorers-roll" mode="out-in"><span :key="sample.provider" class="explorers-roll-slot">{{ info?.label ?? sample.provider }}</span></Transition></span></code></pre>
  </div>
</template>
