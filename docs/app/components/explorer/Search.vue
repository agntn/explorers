<script setup lang="ts">
import { classify, entityPath, isIdentifier } from "../../utils/entities";
import { CHAINS, chainIcon } from "../../utils/providers";

const props = withDefaults(
  defineProps<{
    /** The chain the page is on; the select starts there. */
    chain?: string;
    /** Compact rows on entity pages, the tall box on the hub and the landing. */
    compact?: boolean;
    /** Show the example chips under the box. */
    examples?: boolean;
  }>(),
  { chain: "ethereum", compact: false, examples: false },
);

const router = useRouter();

const chain = ref(props.chain);
const query = ref("");
const problem = ref("");

watch(
  () => props.chain,
  (value) => {
    chain.value = value;
  },
);

const kind = computed(() => (query.value.trim() ? classify(query.value, chain.value) : null));

const EXAMPLES = [
  { label: "vitalik.eth", chain: "ethereum", id: "vitalik.eth" },
  { label: "genesis wallet", chain: "bitcoin", id: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
  { label: "UNI token", chain: "ethereum", id: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  { label: "block 18000000", chain: "ethereum", id: "18000000" },
  { label: "Arweave wallet", chain: "arweave", id: "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw" },
  { label: "block 1994692", chain: "arweave", id: "1994692" },
  { label: "Decred block 1000", chain: "decred", id: "1000" },
] as const;

function submit() {
  const value = query.value.trim();
  if (!value) {
    problem.value = "Type something first: an address, an ENS name, a transaction hash or a block number.";
    return;
  }
  if (!isIdentifier(value)) {
    problem.value = "Letters, digits, dots, dashes, underscores and colons only, up to 128 characters.";
    return;
  }
  problem.value = "";
  void router.push(entityPath(classify(value, chain.value), chain.value, value));
}

function pick(example: (typeof EXAMPLES)[number]) {
  void router.push(entityPath(classify(example.id, example.chain), example.chain, example.id));
}
</script>

<template>
  <form
    class="explorers-frame overflow-hidden rounded-xl text-left"
    role="search"
    @submit.prevent="submit"
  >
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-center"
      :class="compact ? 'p-3' : 'p-4'"
    >
      <select v-model="chain" class="explorers-field sm:w-44" aria-label="Chain">
        <option v-for="row in CHAINS" :key="row.key" :value="row.key">{{ row.name }}</option>
      </select>
      <label class="sr-only" for="explorer-search">Address, ENS name, transaction hash or block number</label>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <UIcon :name="chainIcon(chain)" class="size-4 shrink-0 text-primary" />
        <input
          id="explorer-search"
          v-model="query"
          class="explorers-field font-mono"
          placeholder="address, name.eth, tx hash or block"
          spellcheck="false"
          autocomplete="off"
          maxlength="128"
        />
      </div>
      <button type="submit" class="explorers-btn explorers-primary-fill">
        <UIcon name="i-lucide-search" class="size-4" />
        {{ kind === "tx" ? "Open transaction" : kind === "block" ? "Open block" : "Open address" }}
      </button>
    </div>
    <p v-if="problem" class="border-t border-muted px-4 py-2.5 text-sm" :style="{ color: 'var(--explorers-del)' }">
      {{ problem }}
    </p>
    <div v-if="examples" class="flex flex-wrap items-center gap-1.5 border-t border-muted px-4 py-3">
      <span class="me-1 font-mono text-[11px] text-dimmed">try</span>
      <button
        v-for="example in EXAMPLES"
        :key="example.label"
        type="button"
        class="explorers-copy"
        @click="pick(example)"
      >
        <UIcon :name="chainIcon(example.chain)" class="size-3.5" />
        {{ example.label }}
      </button>
    </div>
  </form>
</template>
