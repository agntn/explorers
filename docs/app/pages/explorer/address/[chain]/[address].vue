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
import { shortHash } from "../../../../utils/format";
import { chainInfo, chainLabel, providersFor } from "../../../../utils/providers";

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
  <ExplorerShell eyebrow="explorer · address" :title="chainLabel(chain)" accent="address" :chain="chain" compact>
    <template #status>
      <p class="explorers-enter explorers-enter-2 mx-auto mt-4 max-w-2xl font-mono text-sm break-all text-muted">
        {{ address }}
      </p>
    </template>

    <div v-if="!known" class="explorers-frame rounded-xl px-5 py-6 text-sm text-muted">
      That isn't a chain this package serves, or not an address the worker accepts. Chains are listed on
      <NuxtLink to="/chains" class="text-primary hover:underline">Chains</NuxtLink>; an address is at most 128
      characters of letters, digits, dots, dashes, underscores and colons.
    </div>

    <div v-else class="space-y-5">
      <ExplorerState :loading="balance.loading.value" :error="balance.error.value" label="Reading the balance…" />
      <ExplorerAddressOverview v-if="balance.answer.value" :answer="balance.answer.value" />

      <p v-if="chain === 'arweave'" class="flex items-start gap-2 text-sm text-dimmed">
        <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0 text-primary" />
        <span
          >Arweave addresses and transaction ids share a shape. If this is a transaction id, open it as
          <NuxtLink :to="txPath(chain, address)" class="text-primary hover:underline">a transaction</NuxtLink>.</span
        >
      </p>

      <div class="explorers-frame overflow-hidden rounded-xl">
        <nav aria-label="Address data" class="flex flex-wrap gap-1 border-b border-muted px-3 py-2">
          <button
            v-for="row in tabs"
            :key="row.key"
            type="button"
            class="explorers-explorer-link"
            :class="{ 'explorers-explorer-link-active': tab === row.key }"
            @click="pickTab(row.key)"
          >
            <UIcon :name="row.icon" class="size-3.5" />
            {{ row.label }}
          </button>
        </nav>

        <template v-if="tab === 'transactions'">
          <div v-if="history.loading.value || history.error.value" class="p-3">
            <ExplorerState :loading="history.loading.value" :error="history.error.value" label="Reading the transaction history…" />
          </div>
          <template v-else-if="history.answer.value">
            <ExplorerAnswerMeta
              :summary="`${history.answer.value.items.length} transactions on page ${history.answer.value.page}`"
              :provider="history.answer.value.provider"
              :fetched-at="history.answer.value.fetchedAt"
            />
            <ExplorerTransactionsList :chain="chain" :items="history.answer.value.items" :address="resolved" />
            <ExplorerPager :page="page" :count="history.answer.value.items.length" :limit="history.answer.value.limit" :loading="history.loading.value" @change="pickPage" />
          </template>
        </template>

        <template v-else-if="tab === 'utxos'">
          <div v-if="utxos.loading.value || utxos.error.value" class="p-3">
            <ExplorerState :loading="utxos.loading.value" :error="utxos.error.value" label="Reading the unspent outputs…" />
          </div>
          <template v-else-if="utxos.answer.value">
            <ExplorerAnswerMeta
              :summary="`${utxos.answer.value.total} unspent outputs`"
              :provider="utxos.answer.value.provider"
              :fetched-at="utxos.answer.value.fetchedAt"
            />
            <ExplorerUtxosList :chain="chain" :items="utxos.answer.value.items" :total="utxos.answer.value.total" />
          </template>
        </template>

        <template v-else-if="tab === 'tokens'">
          <div v-if="tokens.loading.value || tokens.error.value" class="p-3">
            <ExplorerState :loading="tokens.loading.value" :error="tokens.error.value" label="Reading the token holdings…" />
          </div>
          <template v-else-if="tokens.answer.value">
            <ExplorerAnswerMeta
              :summary="`${tokens.answer.value.total} holdings with a balance`"
              :provider="tokens.answer.value.provider"
              :fetched-at="tokens.answer.value.fetchedAt"
            />
            <ExplorerTokensTable :chain="chain" :items="tokens.answer.value.items" :total="tokens.answer.value.total" />
          </template>
        </template>

        <template v-else-if="tab === 'transfers'">
          <div v-if="transfers.loading.value || transfers.error.value" class="p-3">
            <ExplorerState :loading="transfers.loading.value" :error="transfers.error.value" label="Reading the token transfers…" />
          </div>
          <template v-else-if="transfers.answer.value">
            <ExplorerAnswerMeta
              :summary="`${transfers.answer.value.items.length} transfers on page ${transfers.answer.value.page}`"
              :provider="transfers.answer.value.provider"
              :fetched-at="transfers.answer.value.fetchedAt"
            />
            <ExplorerTransfersList :chain="chain" :items="transfers.answer.value.items" :address="resolved" />
            <ExplorerPager :page="page" :count="transfers.answer.value.items.length" :limit="transfers.answer.value.limit" :loading="transfers.loading.value" @change="pickPage" />
          </template>
        </template>

        <template v-else-if="tab === 'contract'">
          <div v-if="contract.loading.value || contract.error.value" class="p-3">
            <ExplorerState :loading="contract.loading.value" :error="contract.error.value" label="Reading the contract metadata…" />
          </div>
          <ExplorerContractCard v-else-if="contract.answer.value" :answer="contract.answer.value" />
        </template>
      </div>
    </div>
  </ExplorerShell>
</template>
