<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { CAPABILITIES, PROVIDERS, type ProviderInfo } from "../../utils/providers";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

interface Row extends ProviderInfo {
  readonly chainCount: number;
  readonly served: number;
  readonly authWord: string;
}

const rows: Row[] = PROVIDERS.map((provider) => ({
  ...provider,
  chainCount: provider.chains.length,
  served: provider.capabilities.length,
  authWord: provider.envVars.length === 0 ? "none" : provider.optionalKey ? "optional" : "key",
}));

/** Empty until a header is clicked: the rows then keep the registry order `resolveProvider()` walks. */
const sorting = ref<{ id: string; desc: boolean }[]>([]);

const roster = useTemplateRef<HTMLElement>("roster");
useRosterFlip(
  () => roster.value,
  () => sorting.value,
);

const columns: TableColumn<Row>[] = [
  {
    accessorKey: "label",
    header: "Provider",
    sortingFn: "text",
    meta: { class: { th: "w-[10.5rem]" } },
  },
  /* Narrow, the row reads name and count first, then auth and chains, then the operations. */
  {
    accessorKey: "authWord",
    header: "Auth",
    sortingFn: "text",
    meta: {
      class: {
        th: "w-[6rem]",
        td: "@max-[52rem]/roster:order-2 @max-[52rem]/roster:justify-self-start!",
      },
    },
  },
  {
    accessorKey: "chainCount",
    header: "Chains",
    meta: {
      class: {
        th: "w-[5.5rem]",
        td: "@max-[52rem]/roster:order-2 @max-[52rem]/roster:col-span-1! @max-[52rem]/roster:justify-self-end",
      },
    },
  },
  {
    accessorKey: "capabilities",
    header: "Operations",
    enableSorting: false,
    meta: { class: { td: "@max-[52rem]/roster:order-3" } },
  },
  {
    accessorKey: "served",
    header: "Served",
    meta: {
      class: {
        th: "w-[6.5rem]",
        td: "@max-[52rem]/roster:order-1 @max-[52rem]/roster:col-span-1! @max-[52rem]/roster:justify-self-end",
      },
    },
  },
];

const order = computed(() => {
  const [first] = sorting.value;
  if (first === undefined) return "registry order";
  const label = columns.find(
    (column) => "accessorKey" in column && column.accessorKey === first.id,
  )?.header;
  return `by ${String(label).toLowerCase()} ${first.desc ? "descending" : "ascending"}`;
});
</script>

<template>
  <section ref="roster" class="roster not-prose my-6" aria-label="Providers">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">listProviders()</span>
      <span :class="ROSTER_CLASS.meta">{{ PROVIDERS.length }} providers · {{ order }}</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <UTable
      v-model:sorting="sorting"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.key"
      :ui="ROSTER_TABLE_UI"
    >
      <template #label-header="{ column }"><RosterSort :column="column" label="Provider" /></template>
      <template #authWord-header="{ column }"><RosterSort :column="column" label="Auth" /></template>
      <template #chainCount-header="{ column }"><RosterSort :column="column" label="Chains" /></template>
      <template #served-header="{ column }"><RosterSort :column="column" label="Served" /></template>
      <template #label-cell="{ row }">
        <NuxtLink :to="row.original.to" :class="[ROSTER_CLASS.name, 'items-baseline']">
          <UIcon
            :name="row.original.icon"
            class="relative top-0.5 size-3.5 flex-none"
            aria-hidden="true"
          />
          <span>{{ row.original.label }}</span>
        </NuxtLink>
      </template>
      <template #authWord-cell="{ row }">
        <UTooltip v-if="row.original.envVars.length > 0" :text="row.original.auth">
          <span class="text-muted">{{ row.original.authWord }}</span>
        </UTooltip>
        <span v-else class="text-dimmed">none</span>
      </template>
      <template #chainCount-cell="{ row }">
        <span class="text-muted tabular-nums"
          >{{ row.original.chainCount }}
          <span class="text-dimmed">{{ row.original.chainCount === 1 ? "chain" : "chains" }}</span></span
        >
      </template>
      <template #capabilities-cell="{ row }">
        <CapabilityCells :served="row.original.capabilities" :subject="row.original.label" />
      </template>
      <template #served-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><span
            class="whitespace-nowrap"
            ><span :class="row.original.served > 0 ? 'text-(--console-accent)' : 'text-muted'">{{
              row.original.served
            }}</span>
            of {{ CAPABILITIES.length }}</span
          ></span
        >
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>read from builtins / no network</span>
      <span :class="ROSTER_CLASS.meta">create("&lt;key&gt;") loads one</span>
    </footer>
  </section>
</template>
