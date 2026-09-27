<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  CAPABILITIES,
  CHAINS,
  PROVIDERS,
  type Capability,
  type ChainInfo,
  type ProviderInfo,
} from "../../utils/providers";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

interface Row extends ChainInfo {
  readonly serving: readonly ProviderInfo[];
  readonly providerCount: number;
  readonly covered: readonly Capability[];
  readonly coveredCount: number;
}

/** Which providers serve a chain, and which operations any of them cover; the snapshot never changes. */
const rows: Row[] = CHAINS.map((chain) => {
  const serving = PROVIDERS.filter((provider) => provider.chains.includes(chain.key));
  const covered = CAPABILITIES.filter((capability) =>
    serving.some((provider) => provider.capabilities.includes(capability)),
  );
  return {
    ...chain,
    serving,
    providerCount: serving.length,
    covered,
    coveredCount: covered.length,
  };
});

const sorting = ref<{ id: string; desc: boolean }[]>([]);

const roster = useTemplateRef<HTMLElement>("roster");
useRosterFlip(
  () => roster.value,
  () => sorting.value,
);

const columns: TableColumn<Row>[] = [
  { accessorKey: "name", header: "Chain", sortingFn: "text", meta: { class: { th: "w-[12.5rem]" } } },
  /* Narrow, the row reads name and count first, then the providers, then the operations. */
  {
    accessorKey: "providerCount",
    header: "Providers",
    meta: {
      class: {
        th: "w-[11rem]",
        td: "@max-[52rem]/roster:order-2 @max-[52rem]/roster:justify-self-start!",
      },
    },
  },
  {
    accessorKey: "covered",
    header: "Operations",
    enableSorting: false,
    meta: { class: { td: "@max-[52rem]/roster:order-3" } },
  },
  {
    accessorKey: "coveredCount",
    header: "Covered",
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
  <section ref="roster" class="roster not-prose my-6" aria-label="Chains">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">chains</span>
      <span :class="ROSTER_CLASS.meta">{{ CHAINS.length }} chains · {{ order }}</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <UTable
      v-model:sorting="sorting"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.key"
      :ui="ROSTER_TABLE_UI"
    >
      <template #name-header="{ column }"><RosterSort :column="column" label="Chain" /></template>
      <template #providerCount-header="{ column }"
        ><RosterSort :column="column" label="Providers"
      /></template>
      <template #coveredCount-header="{ column }"><RosterSort :column="column" label="Covered" /></template>
      <template #name-cell="{ row }">
        <span :class="[ROSTER_CLASS.name, 'items-baseline hover:text-highlighted']">
          <UIcon
            :name="row.original.icon"
            class="relative top-0.5 size-3.5 flex-none"
            aria-hidden="true"
          />
          <span>{{ row.original.name }}</span>
          <span :class="[ROSTER_CLASS.id, 'flex-none']">{{ row.original.key }}</span>
        </span>
      </template>
      <template #providerCount-cell="{ row }">
        <span class="chain-providers">
          <NuxtLink
            v-for="provider in row.original.serving"
            :key="provider.key"
            :to="provider.to"
            class="chain-provider"
            >{{ provider.key }}</NuxtLink
          >
        </span>
      </template>
      <template #covered-cell="{ row }">
        <CapabilityCells
          :served="row.original.covered"
          :subject="`${row.original.name} by any provider`"
        />
      </template>
      <template #coveredCount-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><span
            class="whitespace-nowrap"
            ><span :class="row.original.coveredCount > 0 ? 'text-(--console-accent)' : 'text-muted'">{{
              row.original.coveredCount
            }}</span>
            of {{ CAPABILITIES.length }}</span
          ></span
        >
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>read from builtins and @agntn/chains / no network</span>
      <span :class="ROSTER_CLASS.meta">normalizeChain("btc") → bitcoin</span>
    </footer>
  </section>
</template>

<style scoped>
.chain-providers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chain-provider {
  padding: 0 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-text-muted);
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.chain-provider:hover {
  color: var(--console-accent);
}
.chain-provider:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
</style>
