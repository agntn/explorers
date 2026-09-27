<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { ProvidersAnswer } from "../../utils/wire";
import { PROVIDERS, providerInfo, type ProviderInfo } from "../../utils/providers";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

const { loading, error, answer, load } = useAnswer<ProvidersAnswer>("/api/providers");
onMounted(() => void load({}));

const configured = computed(
  () => answer.value?.providers.filter((row) => row.configured).length ?? 0,
);

interface Row {
  key: string;
  info: ProviderInfo | undefined;
  label: string;
  state: string;
  configured: boolean;
}

/** Each row with its snapshot facts looked up once. */
const rows = computed<Row[]>(() =>
  (answer.value?.providers ?? []).map((row) => {
    const info = providerInfo(row.provider);
    return {
      key: row.provider,
      info,
      label: info?.label ?? row.provider,
      state: row.keyless ? "keyless" : row.configured ? "configured" : "no key",
      configured: row.configured,
    };
  }),
);

const columns: TableColumn<Row>[] = [
  { accessorKey: "label", header: "Provider", meta: { class: { th: "w-[11rem]" } } },
  /* Narrow, the row reads name and state first, then auth, then the operations. */
  {
    id: "auth",
    header: "Auth",
    meta: {
      class: {
        th: "w-[13rem]",
        td: "@max-[52rem]/roster:order-2 @max-[52rem]/roster:justify-self-start!",
      },
    },
  },
  {
    id: "operations",
    header: "Operations",
    meta: { class: { td: "@max-[52rem]/roster:order-3" } },
  },
  {
    accessorKey: "state",
    header: "On the worker",
    meta: {
      class: {
        th: "w-[8.5rem]",
        td: "@max-[52rem]/roster:order-1 @max-[52rem]/roster:col-span-1! @max-[52rem]/roster:justify-self-end",
      },
    },
  },
];
</script>

<template>
  <section class="roster not-prose" aria-label="Providers on the docs worker">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">explorers_providers()</span>
      <span :class="ROSTER_CLASS.meta">{{
        answer
          ? `@agntn/explorers ${answer.version} · ${configured} of ${PROVIDERS.length} can answer`
          : "asking the worker"
      }}</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <div v-if="loading || error" class="px-5 py-4">
      <ExplorerState
        :loading="loading"
        :error="error"
        label="Asking the worker which keys it holds"
      />
    </div>
    <UTable
      v-if="answer"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.key"
      :ui="ROSTER_TABLE_UI"
    >
      <template #label-cell="{ row }">
        <NuxtLink
          :to="`/providers/${row.original.key}`"
          :class="[ROSTER_CLASS.name, 'items-baseline']"
        >
          <UIcon
            :name="row.original.info?.icon ?? 'i-lucide-server'"
            class="relative top-0.5 size-3.5 flex-none"
            aria-hidden="true"
          />
          <span>{{ row.original.label }}</span>
        </NuxtLink>
      </template>
      <template #auth-cell="{ row }">
        <span class="text-muted [overflow-wrap:anywhere]">{{ row.original.info?.auth ?? "" }}</span>
      </template>
      <template #operations-cell="{ row }">
        <CapabilityCells
          :served="row.original.info?.capabilities ?? []"
          :subject="row.original.label"
        />
      </template>
      <template #state-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><UBadge
            :color="'neutral'"
            :variant="row.original.configured ? 'subtle' : 'outline'"
            :label="row.original.state"
        /></span>
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>configured means a read can start here; the key itself never leaves the worker</span>
      <span :class="ROSTER_CLASS.meta">no key here answers 503</span>
    </footer>
  </section>
</template>
