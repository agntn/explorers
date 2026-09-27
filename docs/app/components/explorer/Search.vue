<script setup lang="ts">
import { classify, entityPath, isIdentifier } from "../../utils/entities";
import { CHAINS, chainIcon, chainLabel } from "../../utils/providers";

const props = withDefaults(
  defineProps<{
    /** The chain the page is on; the select starts there. */
    chain?: string;
    /** Show the example chips under the input. */
    examples?: boolean;
  }>(),
  { chain: "ethereum", examples: false },
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

/** The chain list as select items, each with its glyph. */
const chainItems = CHAINS.map((row) => ({ label: row.name, value: row.key, icon: row.icon }));

const kind = computed(() => (query.value.trim() ? classify(query.value, chain.value) : null));
const KIND_WORDS = { address: "an address", tx: "a transaction", block: "a block" } as const;

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
    problem.value =
      "Type something first: an address, an ENS name, a transaction hash or a block number.";
    return;
  }
  if (!isIdentifier(value)) {
    problem.value =
      "Letters, digits, dots, dashes, underscores and colons only, up to 128 characters.";
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
  <form class="tool-console console-wide search not-prose" role="search" @submit.prevent="submit">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>classify(input,
        <span class="search-chain">"{{ chain }}"</span>)<span v-if="kind" class="search-kind">
          → {{ kind }}</span
        ></span
      >
      <span class="console-meta">{{ CHAINS.length }} chains</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true"><span class="console-cursor" /></div>

    <div class="explorers-band search-band">
      <div class="search-glyph" aria-hidden="true">
        <ConsoleReticle :key="chain" :icon="chainIcon(chain)" />
      </div>
      <div class="search-fields">
        <div class="console-readout">
          <dl class="console-readout-rows">
            <div>
              <dt><label for="explorer-chain">Chain</label></dt>
              <dd>
                <USelectMenu
                  id="explorer-chain"
                  v-model="chain"
                  :items="chainItems"
                  value-key="value"
                  :icon="chainIcon(chain)"
                  variant="none"
                  :search-input="{ placeholder: 'Filter chains' }"
                  class="w-full"
                />
              </dd>
            </div>
            <div>
              <dt><label for="explorer-search">Input</label></dt>
              <dd>
                <UInput
                  id="explorer-search"
                  v-model="query"
                  variant="none"
                  placeholder="address, name.eth, tx hash or block"
                  spellcheck="false"
                  autocomplete="off"
                  :maxlength="128"
                  class="w-full"
                />
              </dd>
            </div>
            <div>
              <dt>Reads as</dt>
              <dd :class="kind ? 'console-accent' : 'search-idle'">
                {{ kind ? `${KIND_WORDS[kind]} on ${chainLabel(chain)}` : "nothing typed yet" }}
              </dd>
            </div>
          </dl>
        </div>
        <p v-if="problem" class="explorers-error search-problem" role="alert">
          <span class="console-tag">Input</span>{{ problem }}
        </p>
        <div class="search-actions">
          <UButton
            type="submit"
            color="primary"
            variant="solid"
            trailing-icon="i-lucide-arrow-right"
            :label="
              kind === 'tx' ? 'Open transaction' : kind === 'block' ? 'Open block' : 'Open address'
            "
          />
          <div v-if="examples" class="search-examples" aria-label="Examples">
            <UButton
              v-for="example in EXAMPLES"
              :key="example.label"
              color="neutral"
              variant="soft"
              :icon="chainIcon(example.chain)"
              :label="example.label"
              @click="pick(example)"
            />
          </div>
        </div>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/explorer/gas"><span aria-hidden="true">→ </span>Gas</NuxtLink>
        </li>
        <li>
          <NuxtLink to="/explorer/providers"><span aria-hidden="true">→ </span>Providers</NuxtLink>
        </li>
        <li>
          <NuxtLink to="/guide/explorer"><span aria-hidden="true">→ </span>How it works</NuxtLink>
        </li>
      </ul>
      <span class="console-meta">read through the docs worker</span>
    </footer>
  </form>
</template>

<style scoped>
.search-chain {
  color: var(--shiki-token-string);
}
.search-kind {
  color: var(--console-accent);
}
.search-band {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.search-glyph {
  width: 84px;
}
.search-fields {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.search-fields .console-readout-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
.search-idle {
  color: var(--ui-text-dimmed);
}
.search-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.search-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (width < 640px) {
  .search-band {
    grid-template-columns: minmax(0, 1fr);
  }
  .search-glyph {
    display: none;
  }
  .search-fields .console-readout-rows > div {
    grid-template-columns: 5rem minmax(0, 1fr);
  }
}
</style>
