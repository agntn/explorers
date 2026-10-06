<script setup lang="ts">
import type { DetailAnswer } from "../../utils/wire";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, formatUnits, groupDigits, shortHash, trimDecimals } from "../../utils/format";
import {
  chainIcon,
  chainInfo,
  chainLabel,
  isEvm,
  nativeDecimals,
  providerLabel,
} from "../../utils/providers";

const props = defineProps<{ answer: DetailAnswer }>();

const transaction = computed(() => props.answer.transaction);
const symbol = computed(() => chainInfo(props.answer.chain)?.symbol ?? "");
const external = computed(() => externalUrl("tx", props.answer.chain, transaction.value.hash));
const decimals = computed(() => nativeDecimals(props.answer.chain));

const feeFormatted = computed(() =>
  transaction.value.fee
    ? trimDecimals(formatUnits(transaction.value.fee, decimals.value), 8)
    : null,
);

/** Gas price in gwei on EVM chains; other chains keep the smallest unit. */
const gasPriceText = computed(() => {
  const price = transaction.value.gasPrice;
  if (!price) return null;
  return isEvm(props.answer.chain)
    ? `${trimDecimals(formatUnits(price, 9), 4)} gwei`
    : groupDigits(price);
});

/** Longest body shown inline; a 4 kB hex blob is a wall, not a reading. */
const BODY_CHARS = 280;

/** One row per inscription: the body as far as it fits, then what it is and how big. */
const inscriptions = computed(() =>
  (transaction.value.inscriptions ?? []).map((inscription, index) => {
    const chars = Array.from(inscription.text ?? inscription.hex ?? "");
    const kind = [inscription.contentType ?? "no content type", inscription.contentEncoding]
      .filter(Boolean)
      .join(", ");
    const binary = inscription.text === undefined && inscription.hex ? ", binary" : "";
    return {
      key: `${inscription.input}-${index}`,
      input: inscription.input,
      body: chars.length > BODY_CHARS ? `${chars.slice(0, BODY_CHARS).join("")}…` : chars.join(""),
      meta: `${kind}, ${groupDigits(String(inscription.size))} bytes${binary}`,
      tooBig: inscription.hex === undefined && inscription.size > 0,
    };
  }),
);

const { copied, copy } = useCopied();
</script>

<template>
  <section class="tool-console console-wide not-prose" aria-label="Transaction">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>getTxDetail(<span class="entity-str"
          >"{{ shortHash(transaction.hash, 8, 6) }}"</span
        >, <span class="entity-str">"{{ answer.chain }}"</span>)</span
      >
      <span class="console-meta">via {{ providerLabel(answer.provider) }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="transaction.hash" class="console-cursor" />
    </div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="transaction.hash" :icon="chainIcon(answer.chain)" />
        <div class="console-name">
          <span class="console-label"
            >Transaction / <span class="console-label-key">{{ answer.chain }}</span></span
          >
          <p class="explorers-subject-id">
            <span>{{ transaction.hash }}</span>
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copied === 'hash' ? 'i-lucide-check' : 'i-lucide-copy'"
              :aria-label="copied === 'hash' ? 'Copied' : 'Copy hash'"
              @click="copy('hash', transaction.hash)"
            />
          </p>
          <p class="explorers-tags">
            <ExplorerStatus :status="transaction.status" />
            <UBadge
              v-if="transaction.isContractInteraction"
              color="neutral"
              variant="outline"
              label="contract call"
            />
            <UBadge
              v-if="transaction.createdContract"
              color="neutral"
              variant="outline"
              label="deployment"
            />
            <UBadge
              v-if="transaction.opReturn?.length"
              color="neutral"
              variant="outline"
              label="OP_RETURN"
            />
            <UBadge
              v-if="inscriptions.length"
              color="neutral"
              variant="outline"
              label="inscription"
            />
          </p>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Value</dt>
            <dd class="console-accent tx-nowrap">
              {{ trimDecimals(transaction.valueFormatted, 8) }} {{ symbol }}
            </dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd class="tx-nowrap">
              <template v-if="feeFormatted">{{ feeFormatted }} {{ symbol }}</template>
              <span v-else class="explorers-dim">absent</span>
            </dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd>
              <NuxtLink
                v-if="transaction.blockNumber > 0"
                :to="blockPath(answer.chain, transaction.blockNumber)"
                class="tx-link"
                >{{ transaction.blockNumber }}</NuxtLink
              >
              <span v-else class="explorers-dim">pending</span>
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd class="tx-nowrap">
              <template v-if="transaction.timestamp">{{
                dateTime(transaction.timestamp)
              }}</template>
              <span v-else class="explorers-dim">not given</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Parties <span aria-hidden="true">[ from · to ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div>
          <dt>From</dt>
          <dd>
            <span v-if="transaction.from === ''" class="explorers-dim"
              >empty · the explorer names no sender</span
            >
            <NuxtLink v-else :to="addressPath(answer.chain, transaction.from)">{{
              transaction.from
            }}</NuxtLink>
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>
            <span v-if="transaction.to === null"
              >null
              <span class="explorers-dim"
                >· {{ transaction.createdContract ? "a contract creation" : "no recipient" }}</span
              ></span
            >
            <span v-else-if="transaction.to === ''" class="explorers-dim"
              >empty · a data upload, no recipient</span
            >
            <NuxtLink v-else :to="addressPath(answer.chain, transaction.to)">{{
              transaction.to
            }}</NuxtLink>
          </dd>
        </div>
        <div v-if="transaction.createdContract">
          <dt>Created</dt>
          <dd>
            <NuxtLink :to="addressPath(answer.chain, transaction.createdContract)">{{
              transaction.createdContract
            }}</NuxtLink>
          </dd>
        </div>
      </dl>
    </div>

    <div class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Execution <span aria-hidden="true">[ as the explorer reports it ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div>
          <dt>Value raw</dt>
          <dd>"{{ groupDigits(transaction.value) }}"</dd>
        </div>
        <div v-if="transaction.fee">
          <dt>Fee raw</dt>
          <dd>"{{ groupDigits(transaction.fee) }}"</dd>
        </div>
        <div v-if="transaction.gasUsed || gasPriceText">
          <dt>Gas</dt>
          <dd>
            <template v-if="transaction.gasUsed"
              >{{ groupDigits(transaction.gasUsed) }} used</template
            >
            <span v-if="transaction.gasUsed && gasPriceText" class="explorers-dim"> · </span>
            <template v-if="gasPriceText">{{ gasPriceText }}</template>
          </dd>
        </div>
        <div>
          <dt>Method</dt>
          <!-- A decoded function name comes from a verified ABI anyone can publish: interpolated. -->
          <dd>
            {{ transaction.functionName ?? transaction.methodId ?? "absent" }}
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="transaction.tokenTransfers.length" class="explorers-band">
      <p class="console-label console-rule-title">
        <span
          >Token transfers
          <span aria-hidden="true">[ {{ transaction.tokenTransfers.length }} ]</span></span
        >
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ul class="explorers-rows tx-transfers">
        <li
          v-for="transfer in transaction.tokenTransfers"
          :key="transfer.contract + transfer.from + transfer.to + transfer.value"
        >
          <span class="list-amount">
            <span class="explorers-value">{{ trimDecimals(transfer.valueFormatted, 6) }}</span>
            <NuxtLink
              :to="addressPath(answer.chain, transfer.contract)"
              class="list-link list-token"
              >{{ transfer.symbol }}</NuxtLink
            >
          </span>
          <span class="list-route">
            <ExplorerHash
              :value="transfer.from"
              :to="addressPath(answer.chain, transfer.from)"
              :head="6"
              :tail="4"
            />
            <span class="list-dir">→</span>
            <ExplorerHash
              :value="transfer.to"
              :to="addressPath(answer.chain, transfer.to)"
              :head="6"
              :tail="4"
            />
          </span>
        </li>
      </ul>
    </div>

    <div v-if="transaction.opReturn?.length" class="explorers-band">
      <p class="console-label console-rule-title">
        <span>OP_RETURN <span aria-hidden="true">[ hex, and text when printable ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div v-for="(payload, index) in transaction.opReturn" :key="payload.hex">
          <dt>Push {{ index + 1 }}</dt>
          <dd>
            <template v-if="payload.text"
              >{{ payload.text }} <span class="explorers-dim">· {{ payload.hex }}</span></template
            >
            <template v-else
              >{{ payload.hex }}
              <span class="explorers-dim">· binary, no text reading</span></template
            >
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="inscriptions.length" class="explorers-band">
      <p class="console-label console-rule-title">
        <span>Inscriptions <span aria-hidden="true">[ read off the witness, no indexer ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="explorers-facts">
        <div v-for="row in inscriptions" :key="row.key">
          <dt>Input {{ row.input }}</dt>
          <dd>
            <template v-if="row.tooBig"
              ><span class="explorers-dim"
                >{{ row.meta }}, too big for this page. The witness still has every byte.</span
              ></template
            >
            <template v-else
              >{{ row.body }} <span class="explorers-dim">· {{ row.meta }}</span></template
            >
          </dd>
        </div>
      </dl>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/explorer"><span aria-hidden="true">→ </span>Explorer</NuxtLink>
        </li>
        <li v-if="external">
          <a :href="external" target="_blank" rel="noopener nofollow"
            ><span aria-hidden="true">↗ </span>{{ externalHost(answer.chain) }}</a
          >
        </li>
      </ul>
      <span class="console-meta"
        >{{ chainLabel(answer.chain) }} · fetched {{ dateTime(answer.fetchedAt) }}</span
      >
    </footer>
  </section>
</template>

<style scoped>
.tx-nowrap {
  white-space: nowrap;
}
.tx-link {
  color: var(--ui-text-highlighted);
}
.tx-link:hover {
  color: var(--console-accent);
}
.tx-transfers {
  margin-inline: -20px;
}
.tx-transfers > li {
  grid-template-columns: 14rem minmax(0, 1fr);
}
@media (width < 640px) {
  .tx-transfers {
    margin-inline: -14px;
  }
  .tx-transfers > li {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
