<script setup lang="ts">
import type {
  BalanceAnswer,
  ContractAnswer,
  HistoryAnswer,
  TokensAnswer,
  TransfersAnswer,
  UtxosAnswer,
} from "../../../../utils/wire";
import { isIdentifier, txPath } from "../../../../utils/entities";
import { dateTime, shortHash } from "../../../../utils/format";
import { chainInfo, chainLabel, providerLabel, providersFor } from "../../../../utils/providers";

definePageMeta({ layout: "default" });

const route = useRoute();
const router = useRouter();

const chain = computed(() => String(route.params.chain ?? ""));
const address = computed(() => String(route.params.address ?? ""));
const known = computed(() => chainInfo(chain.value) !== undefined && isIdentifier(address.value));

const title = computed(() => `${shortHash(address.value, 10, 6)} on ${chainLabel(chain.value)}`);
const description = computed(
  () =>
    `Balance, transactions, unspent outputs, token holdings and transfers of ${address.value} on ${chainLabel(chain.value)}. Read live through @agntn/explorers.`,
);

useSeo({
  title: title.value,
  description: description.value,
  type: "article",
  breadcrumbs: [
    { title: "Explorer", path: "/explorer" },
    { title: chainLabel(chain.value), path: `/explorer/address/${chain.value}/${address.value}` },
  ],
});

/** Entity pages are live reads of somebody else's data; nothing here is worth indexing. */
useSeoMeta({ robots: "noindex, follow" });

type Tab = "transactions" | "utxos" | "tokens" | "transfers" | "contract";

const TABS: ReadonlyArray<{
  key: Tab;
  label: string;
  icon: string;
  capability: "txHistory" | "utxos" | "tokenBalances" | "tokenTransfers" | "contractInfo";
  /** Whether the tab pages through its list. */
  paged: boolean;
}> = [
  { key: "transactions", label: "Transactions", icon: "i-lucide-list", capability: "txHistory", paged: true },
  { key: "utxos", label: "Unspent outputs", icon: "i-lucide-wallet", capability: "utxos", paged: false },
  { key: "tokens", label: "Tokens", icon: "i-lucide-database", capability: "tokenBalances", paged: false },
  { key: "transfers", label: "Token transfers", icon: "i-lucide-arrow-left-right", capability: "tokenTransfers", paged: true },
  { key: "contract", label: "Contract", icon: "i-lucide-file-code", capability: "contractInfo", paged: false },
];

/** Only the tabs some provider can serve on this chain; the others would be a 422 every time. */
const tabs = computed(() => TABS.filter((tab) => providersFor(chain.value, tab.capability).length > 0));

const tab = ref<Tab>("transactions");
const page = ref(1);

const balance = useAnswer<BalanceAnswer>("/api/balance");
const history = useAnswer<HistoryAnswer>("/api/tx");
const utxos = useAnswer<UtxosAnswer>("/api/utxos");
const tokens = useAnswer<TokensAnswer>("/api/tokens");
const transfers = useAnswer<TransfersAnswer>("/api/transfers");
const contract = useAnswer<ContractAnswer>("/api/contract");

const base = computed(() => ({ chain: chain.value, address: address.value }));

/** Each tab's panel remembers the query it answered, so switching back is free and a new page is a new read. */
function loadTab() {
  switch (tab.value) {
    case "transactions":
      return history.load({ ...base.value, page: page.value });
    case "utxos":
      return utxos.load(base.value);
    case "tokens":
      return tokens.load(base.value);
    case "transfers":
      return transfers.load({ ...base.value, page: page.value });
    default:
      return contract.load(base.value);
  }
}

function syncQuery() {
  const query: Record<string, string> = {};
  if (tab.value !== "transactions") query.tab = tab.value;
  if (page.value > 1) query.page = String(page.value);
  void router.replace({ query });
}

function pickTab(next: Tab) {
  if (tab.value === next) return;
  tab.value = next;
  page.value = 1;
  syncQuery();
  void loadTab();
}

function pickPage(next: number) {
  page.value = next;
  syncQuery();
  void loadTab();
}

/** What the bar calls for the tab that is open; the method name is the one the library exposes. */
const CALLS: Record<Tab, string> = {
  transactions: "getTxHistory",
  utxos: "getUtxos",
  tokens: "getTokenBalances",
  transfers: "getTokenTransfers",
  contract: "getContractInfo",
};

/** The open tab's answer, its state and the line the bar carries about it. */
const panel = computed(() => {
  switch (tab.value) {
    case "transactions":
      return {
        state: history,
        label: "Reading the transaction history",
        meta: history.answer.value
          ? `${history.answer.value.items.length} on page ${history.answer.value.page}`
          : "",
      };
    case "utxos":
      return {
        state: utxos,
        label: "Reading the unspent outputs",
        meta: utxos.answer.value ? `${utxos.answer.value.total} unspent` : "",
      };
    case "tokens":
      return {
        state: tokens,
        label: "Reading the token holdings",
        meta: tokens.answer.value ? `${tokens.answer.value.total} with a balance` : "",
      };
    case "transfers":
      return {
        state: transfers,
        label: "Reading the token transfers",
        meta: transfers.answer.value
          ? `${transfers.answer.value.items.length} on page ${transfers.answer.value.page}`
          : "",
      };
    default:
      return { state: contract, label: "Reading the contract metadata", meta: "" };
  }
});

const panelAnswer = computed(
  () => panel.value.state.answer.value as { provider: string; fetchedAt: string } | undefined,
);

/** The address as the explorer spells it after ENS resolution, for muting its side of each row. */
const resolved = computed(
  () => balance.answer.value?.balance.address ?? history.answer.value?.address ?? address.value,
);

/** Everything starts over for a new address: the answers, the tab and the page the query names. */
function read() {
  for (const panel of [balance, history, utxos, tokens, transfers, contract]) panel.reset();
  tab.value = "transactions";
  page.value = 1;
  if (!known.value) return;
  const wanted = route.query.tab;
  if (typeof wanted === "string" && tabs.value.some((row) => row.key === wanted)) {
    tab.value = wanted as Tab;
  }
  const wantedPage = Number(route.query.page);
  if (Number.isInteger(wantedPage) && wantedPage > 1 && wantedPage <= 100) {
    page.value = wantedPage;
  }
  void balance.load(base.value);
  void loadTab();
}

onMounted(read);
/** The search box stays on this page, so another address on the same chain has to read again. */
watch([chain, address], read);
</script>

<template>
  <ExplorerShell section="address" :title="chainLabel(chain)" accent="address" :chain="chain">
    <template #status>
      <p class="entity-id">{{ address }}</p>
    </template>

    <p v-if="!known" class="explorers-error">
      <span class="console-tag">Input</span
      ><span
        >That isn't a chain this package serves, or not an address the worker accepts. Chains are
        listed on <NuxtLink to="/chains" class="entity-link">Chains</NuxtLink>; an address is at
        most 128 characters of letters, digits, dots, dashes, underscores and colons.</span
      >
    </p>

    <div v-else class="entity-stack">
      <ExplorerState
        :loading="balance.loading.value"
        :error="balance.error.value"
        label="Reading the balance"
      />
      <ExplorerAddressOverview v-if="balance.answer.value" :answer="balance.answer.value" />

      <p v-if="chain === 'arweave'" class="explorers-note">
        <UIcon name="i-lucide-info" class="size-3.5" aria-hidden="true" />
        <span
          >Arweave addresses and transaction ids share a shape. If this is a transaction id, open it
          as <NuxtLink :to="txPath(chain, address)" class="entity-link">a transaction</NuxtLink>.</span
        >
      </p>

      <section class="tool-console console-wide" aria-label="Address data">
        <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
        <span class="console-cross console-cross-br" aria-hidden="true">+</span>

        <header class="console-bar">
          <span class="console-title"
            ><span class="console-tag">List</span>{{ CALLS[tab] }}(address,
            <span class="entity-str">"{{ chain }}"</span>)</span
          >
          <span class="console-meta">{{
            panelAnswer
              ? [panel.meta, `via ${providerLabel(panelAnswer.provider)}`].filter(Boolean).join(" · ")
              : ""
          }}</span>
          <span class="console-mark" aria-hidden="true" />
        </header>
        <div class="console-ruler" aria-hidden="true">
          <span
            :key="`${tab}-${page}`"
            class="console-cursor"
            :class="{ 'console-cursor-busy': panel.state.loading.value }"
          />
        </div>

        <div class="explorers-band">
          <div class="console-chips entity-tabs" role="group" aria-label="Address data">
            <button
              v-for="row in tabs"
              :key="row.key"
              type="button"
              :aria-pressed="tab === row.key"
              @click="pickTab(row.key)"
            >
              <UIcon :name="row.icon" class="size-3" aria-hidden="true" />
              {{ row.label }}
            </button>
          </div>
        </div>

        <div
          v-if="panel.state.loading.value || panel.state.error.value"
          class="explorers-band"
        >
          <ExplorerState
            :loading="panel.state.loading.value"
            :error="panel.state.error.value"
            :label="panel.label"
          />
        </div>

        <div v-else class="entity-list">
          <ExplorerTransactionsList
            v-if="tab === 'transactions' && history.answer.value"
            :chain="chain"
            :items="history.answer.value.items"
            :address="resolved"
          />
          <ExplorerUtxosList
            v-else-if="tab === 'utxos' && utxos.answer.value"
            :chain="chain"
            :items="utxos.answer.value.items"
            :total="utxos.answer.value.total"
          />
          <ExplorerTokensTable
            v-else-if="tab === 'tokens' && tokens.answer.value"
            :chain="chain"
            :items="tokens.answer.value.items"
            :total="tokens.answer.value.total"
          />
          <ExplorerTransfersList
            v-else-if="tab === 'transfers' && transfers.answer.value"
            :chain="chain"
            :items="transfers.answer.value.items"
            :address="resolved"
          />
          <ExplorerContractCard
            v-else-if="tab === 'contract' && contract.answer.value"
            :answer="contract.answer.value"
          />
        </div>

        <footer class="console-footer console-footer-plain">
          <template v-if="tab === 'transactions' && history.answer.value">
            <span v-if="!history.answer.value.paged"
              >{{ providerLabel(history.answer.value.provider) }} pages by cursor, which the library
              keeps to itself, so this is the newest {{ history.answer.value.limit }}.</span
            >
            <span v-else class="console-meta">{{ history.answer.value.limit }} a page</span>
            <ExplorerPager
              v-if="history.answer.value.paged"
              :page="page"
              :count="history.answer.value.items.length"
              :limit="history.answer.value.limit"
              :loading="history.loading.value"
              @change="pickPage"
            />
          </template>
          <template v-else-if="tab === 'transfers' && transfers.answer.value">
            <span v-if="!transfers.answer.value.paged"
              >{{ providerLabel(transfers.answer.value.provider) }} pages by cursor, which the
              library keeps to itself, so this is the newest {{ transfers.answer.value.limit }}.</span
            >
            <span v-else class="console-meta">{{ transfers.answer.value.limit }} a page</span>
            <ExplorerPager
              v-if="transfers.answer.value.paged"
              :page="page"
              :count="transfers.answer.value.items.length"
              :limit="transfers.answer.value.limit"
              :loading="transfers.loading.value"
              @change="pickPage"
            />
          </template>
          <template v-else>
            <span>{{ panelAnswer ? `fetched ${dateTime(panelAnswer.fetchedAt)}` : "live read through the docs worker" }}</span>
          </template>
        </footer>
      </section>
    </div>
  </ExplorerShell>
</template>
