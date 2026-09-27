<script setup lang="ts">
import type { BalanceAnswer } from "../../utils/wire";
import { addressPath, blockPath, externalHost, externalUrl } from "../../utils/entities";
import { dateTime, groupDigits, shortHash, trimDecimals } from "../../utils/format";
import { CHAINS, chainIcon, chainLabel, isEvm, providerLabel } from "../../utils/providers";

const props = defineProps<{ answer: BalanceAnswer }>();

const balance = computed(() => props.answer.balance);
const external = computed(() => externalUrl("address", props.answer.chain, balance.value.address));

/** The same address on the other chains of the same family; an EVM address is valid on every EVM chain. */
const siblings = computed(() =>
  isEvm(props.answer.chain)
    ? CHAINS.filter((chain) => chain.type === "evm" && chain.key !== props.answer.chain)
    : [],
);

const unconfirmed = computed(() => {
  const value = balance.value.unconfirmed;
  return value !== undefined && value !== "0" ? value : null;
});

const { copied, copy } = useCopied();
</script>

<template>
  <section class="tool-console console-wide not-prose" aria-label="Address">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>getBalance(<span class="overview-str"
          >"{{ shortHash(answer.input, 10, 6) }}"</span
        >, <span class="overview-str">"{{ answer.chain }}"</span>)</span
      >
      <span class="console-meta">via {{ providerLabel(answer.provider) }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="answer.fetchedAt" class="console-cursor" />
    </div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="balance.address" :icon="chainIcon(answer.chain)" />
        <div class="console-name">
          <span class="console-label"
            >Address / <span class="console-label-key">{{ answer.chain }}</span></span
          >
          <p class="overview-address">
            <span>{{ balance.address }}</span>
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copied === 'address' ? 'i-lucide-check' : 'i-lucide-copy'"
              :aria-label="copied === 'address' ? 'Copied' : 'Copy address'"
              @click="copy('address', balance.address)"
            />
          </p>
          <p class="console-about">
            <template v-if="answer.input !== balance.address"
              >{{ answer.input }} resolved to this address before the read. </template
            >The balance is a string in the smallest unit, exact; the amount beside it is the same
            number for people.
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
            <dt>Balance</dt>
            <dd class="console-accent overview-nowrap">
              {{ trimDecimals(balance.balanceFormatted, 8) }} {{ balance.symbol }}
            </dd>
          </div>
          <div>
            <dt>Raw</dt>
            <dd>
              <UTooltip :text="`&quot;${balance.balance}&quot; in the smallest unit`">
                <span class="overview-clip">{{ groupDigits(balance.balance) }}</span>
              </UTooltip>
            </dd>
          </div>
          <div v-if="balance.funded !== undefined">
            <dt>In / out</dt>
            <dd>
              <UTooltip
                :text="`funded ${groupDigits(balance.funded)} · spent ${groupDigits(balance.spent ?? '0')}`"
              >
                <span class="overview-clip"
                  >{{ groupDigits(balance.funded) }}
                  <span class="overview-dim">/</span>
                  {{ groupDigits(balance.spent ?? "0") }}</span
                >
              </UTooltip>
            </dd>
          </div>
          <div v-if="unconfirmed">
            <dt>Mempool</dt>
            <dd class="overview-clip">
              {{ unconfirmed.startsWith("-") ? "" : "+" }}{{ groupDigits(unconfirmed) }}
            </dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd>
              <NuxtLink
                v-if="balance.blockNumber !== null"
                :to="blockPath(answer.chain, balance.blockNumber)"
                class="overview-link"
                >{{ balance.blockNumber }}</NuxtLink
              >
              <span v-else class="overview-dim">not named</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Elsewhere <span aria-hidden="true">[ same address ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="overview-leads">
        <dd class="console-lead">
          <span class="console-tag">Explorer</span>
          <a v-if="external" :href="external" target="_blank" rel="noopener nofollow"
            >{{ externalHost(answer.chain) }}<span class="overview-dim"> ↗</span></a
          >
          <span v-else class="overview-dim"
            >no canonical explorer link for {{ chainLabel(answer.chain) }}</span
          >
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd v-if="siblings.length" class="overview-siblings">
          <span class="console-tag">Also on</span>
          <span class="overview-chips">
            <UButton
              v-for="chain in siblings"
              :key="chain.key"
              color="neutral"
              variant="soft"
              :icon="chain.icon"
              :label="chain.name"
              :to="addressPath(chain.key, balance.address)"
            />
          </span>
        </dd>
      </dl>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/explorer"><span aria-hidden="true">→ </span>Explorer</NuxtLink>
        </li>
        <li>
          <NuxtLink :to="`/providers/${answer.provider}`"
            ><span aria-hidden="true">→ </span>{{ providerLabel(answer.provider) }}</NuxtLink
          >
        </li>
      </ul>
      <span class="console-meta">fetched {{ dateTime(answer.fetchedAt) }}</span>
    </footer>
  </section>
</template>

<style scoped>
.overview-str {
  color: var(--shiki-token-string);
}
.overview-address {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 4px 0 6px;
  font-family: var(--font-mono);
  font-size: 17px;
  line-height: 1.45;
  color: var(--ui-text-highlighted);
}
.overview-address > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.overview-address > .explorers-control {
  flex: none;
}
.overview-nowrap {
  white-space: nowrap;
}
.overview-clip {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-link {
  color: var(--ui-text-highlighted);
}
.overview-link:hover {
  color: var(--console-accent);
}
.overview-dim {
  color: var(--ui-text-dimmed);
}
.overview-leads {
  display: grid;
  gap: 8px;
  margin: 0;
}
.overview-leads > dd {
  margin: 0;
}
.overview-siblings {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.overview-siblings > .console-tag {
  flex: none;
  justify-self: start;
  margin-top: 3px;
}
.overview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (width < 640px) {
  .overview-address {
    font-size: 14px;
  }
  .overview-siblings {
    display: grid;
    gap: 8px;
  }
  .overview-leads .console-leader {
    display: none;
  }
}
</style>
