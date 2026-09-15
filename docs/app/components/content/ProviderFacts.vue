<script setup lang="ts">
import { CAPABILITY_LABELS, chainLabel, providerInfo } from "../../utils/providers";
import { cellBorders, hostPath } from "../../utils/format";

const props = defineProps<{ provider: string }>();

const info = computed(() => providerInfo(props.provider));

const facts = computed(() => {
  const provider = info.value;
  if (!provider) {
    return [];
  }
  return [
    { label: "provider", value: `create("${provider.key}")`, mono: true },
    { label: "auth", value: provider.auth, mono: true },
    {
      label: "chains",
      value: provider.chains.map(chainLabel).join(", "),
      mono: false,
    },
    {
      label: "capabilities",
      value:
        provider.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(", ") ||
        "none",
      mono: false,
    },
    {
      label: "endpoint",
      value: provider.defaultURL ? hostPath(provider.defaultURL) : "none",
      mono: true,
    },
    { label: "default chain", value: provider.defaultChain, mono: true },
  ];
});
</script>

<template>
  <dl
    class="explorers-frame not-prose my-6 grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3"
  >
    <div
      v-for="(fact, index) in facts"
      :key="fact.label"
      class="border-muted px-4 py-3.5"
      :class="cellBorders(index, 3)"
    >
      <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">
        {{ fact.label }}
      </dt>
      <dd class="mt-1 text-sm text-highlighted" :class="{ 'font-mono text-[13px] break-all': fact.mono }">
        {{ fact.value }}
      </dd>
    </div>
  </dl>
</template>
