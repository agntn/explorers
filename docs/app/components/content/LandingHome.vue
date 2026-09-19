<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import { cellBorders } from "../../utils/format";
import { CAPABILITIES, CHAINS, PROVIDERS } from "../../utils/providers";

const { samples, tick, paused, current, step } = useLandingExplorer();

const stats = [
  { value: String(PROVIDERS.length), label: "providers" },
  { value: String(CHAINS.length), label: "chains" },
  { value: String(CAPABILITIES.length), label: "operations" },
  { value: "10", label: "agent tools" },
] as const;

const { copy: copyInstall, copied } = useClipboard({ source: "pnpm add @agntn/explorers", copiedDuring: 1200 });

/** The provider grid highlights whichever provider the panels are reading through. */
const activeProvider = computed(() => current.value.provider);
</script>

<template>
  <div class="explorers-landing not-prose">
    <header
      class="explorers-hero mx-auto w-full max-w-[var(--ui-container)] px-8 pt-24 pb-20 text-center sm:px-12 lg:px-16"
    >
      <h1
        class="explorers-enter mx-auto max-w-3xl text-4xl leading-[1.08] font-medium tracking-tight text-highlighted sm:text-5xl lg:text-[3.75rem]"
      >
        Fifteen explorers. <span class="text-primary whitespace-nowrap">One shape.</span>
      </h1>
      <p
        class="explorers-enter explorers-enter-2 mx-auto mt-6 max-w-xl text-base leading-7 text-muted"
      >
        Etherscan, Blockscout, Mempool, Solscan, Koios, dcrdata and nine more behind one
        TypeScript contract. Balances, transactions, unspent outputs, tokens, contracts, gas and
        blocks on 25 chains, amounts as exact strings, and a provider picked for you from the keys
        you have. Library, CLI, MCP server, Pi and OMP, all reading through the same code, so
        nobody has to remember what Insight is.
      </p>
      <div
        class="explorers-enter explorers-enter-3 mt-8 flex flex-wrap items-center justify-center gap-2"
      >
        <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
          Get started
        </UButton>
        <UButton
          to="https://github.com/agntn/explorers"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
        >
          Star on GitHub
        </UButton>
      </div>
      <button
        type="button"
        class="explorers-enter explorers-enter-4 explorers-install mt-5"
        :aria-label="copied ? 'Copied' : 'Copy install command'"
        @click="copyInstall()"
      >
        <span class="text-dimmed">$</span>
        <span>pnpm add @agntn/explorers</span>
        <UIcon
          :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          class="size-3.5 text-dimmed"
        />
      </button>

      <div class="explorers-enter explorers-enter-4 mx-auto mt-10 max-w-5xl">
        <p class="explorers-eyebrow mb-3 justify-center">or look something up</p>
        <ExplorerSearch chain="ethereum" examples />
      </div>

      <div
        class="explorers-enter explorers-enter-4 mx-auto mt-16 hidden max-w-6xl md:block"
        @mouseenter="paused = true"
        @mouseleave="paused = false"
      >
        <LandingFlow :sample="current" :tick="tick" />
      </div>
    </header>

    <dl class="explorers-section grid grid-cols-2 sm:grid-cols-4">
      <div
        v-for="(stat, i) in stats"
        :key="stat.label"
        class="border-default px-6 py-7 text-center"
        :class="{ 'border-t sm:border-t-0': i >= 2, 'border-l': i % 2 === 1, 'sm:border-l': i > 0 }"
      >
        <dd class="font-mono text-2xl text-highlighted">{{ stat.value }}</dd>
        <dt class="mt-1 font-mono text-[11px] tracking-[0.12em] text-dimmed uppercase">
          {{ stat.label }}
        </dt>
      </div>
    </dl>

    <LandingFeature
      eyebrow="Balances"
      title="An address in, one Balance out"
      to="/explorer"
      link="Open the explorer"
      :checks="[
        'balance is a string in the chain\'s smallest unit; balanceFormatted is the same number for humans',
        'fetchedAt on every read, blockNumber and blockHash when the explorer says which block it meant, null when it doesn\'t',
        'UTXO explorers add funded and spent totals and keep the mempool delta in unconfirmed; the rest leave them out rather than send zero',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">getBalance(address, chain)</code>
      returns the same shape whether the answer came from Etherscan, Mempool or an Arweave
      gateway. ENS names resolve first, so
      <code class="font-mono text-[13px] text-highlighted">vitalik.eth</code> is as good as the
      hex. This panel walks through {{ samples.length }} addresses on three chains. Each one starts
      as a recorded sample and gets swapped for the worker's live answer the moment it lands.
      <template #visual>
        <LandingBalance :sample="current" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Transactions"
      title="History and detail, same Transaction"
      to="/guide/transactions"
      link="Transactions"
      :checks="[
        'hash, from, to, value, fee, status and the token transfers inside, on every chain that has them',
        'to is null whenever there is no recipient, createdContract names a deployment, never an empty string pretending to be an address',
        'OP_RETURN payloads on Bitcoin, Litecoin and Pepecoin come as hex, plus text when the bytes are printable',
      ]"
      reverse
    >
      <code class="font-mono text-[13px] text-highlighted">getTxHistory</code> pages through an
      address, <code class="font-mono text-[13px] text-highlighted">getTxDetail</code> reads one
      hash, and both hand back the same
      <code class="font-mono text-[13px] text-highlighted">Transaction</code>. The explorer's own
      answer rides along in <code class="font-mono text-[13px] text-highlighted">raw</code> for the
      day you need a field nobody normalized. That day comes, usually on Bitcoin.
      <template #visual>
        <LandingHistory :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Provider selection"
      title="Keys first, keyless next, Blockscout last"
      to="/guide/selection"
      link="How a provider is picked"
      :checks="[
        'resolveProvider() ranks configured keys, then keyless providers, then anything else that serves the chain',
        'withProvider() retries once on the next candidate after a RateLimitError or a PlanRestrictedError',
        'An explicit --provider stays strict: a wrong chain is an UnsupportedChainError, not a silent switch',
      ]"
    >
      Set <code class="font-mono text-[13px] text-highlighted">ETHERSCAN_API_KEY</code> and
      Ethereum reads go through Etherscan. Unset it and they go through Blockscout. Nothing else in
      your code changes. The ranking never loads a provider module, so listing candidates is free
      and the one that answers is the only one that gets imported.
      <template #visual>
        <LandingSelection :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Providers"
      title="Fifteen backends, honest about what they serve"
      to="/providers"
      link="All providers"
      :checks="[
        'capabilities is one flag set on every provider, and an optional method is absent when its flag is false',
        'Aptos stays registered with no capabilities rather than hiding a fullnode RPC behind an explorer name',
        'Your own backend is one class extending Provider plus an entry with its chains and a loader',
      ]"
      reverse
    >
      Etherscan wants an API key and a chain id, Koios wants the address in a POST body, the
      Arweave gateway answers half its questions over GraphQL. Each provider keeps that to itself
      and maps its answers onto the shared types. A capability a backend can't serve is missing,
      not stubbed with convincing nonsense.
      <template #visual>
        <div
          class="explorers-frame grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3 lg:grid-cols-4"
        >
          <NuxtLink
            v-for="(provider, i) in PROVIDERS"
            :key="provider.key"
            :to="provider.to"
            class="group flex flex-col gap-3 border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted"
            :class="[cellBorders(i, 3, 4), { 'explorers-cell-active': provider.key === activeProvider }]"
          >
            <UIcon
              :name="provider.icon"
              class="size-5 text-muted transition-colors duration-500 group-hover:text-primary"
              :class="{ 'text-primary': provider.key === activeProvider }"
            />
            <span>
              <span class="block text-sm font-medium text-highlighted">{{ provider.label }}</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed"
                >{{ provider.chains.length }} chains ·
                {{ provider.envVars.length === 0 ? "keyless" : "key" }}</span
              >
            </span>
          </NuxtLink>
          <NuxtLink
            to="/guide/custom"
            class="group flex flex-col gap-3 border-t border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted sm:border-l lg:border-l"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-5 text-muted transition-colors duration-500 group-hover:text-primary"
            />
            <span>
              <span class="block text-sm font-medium text-highlighted">Yours</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed">extends Provider</span>
            </span>
          </NuxtLink>
        </div>
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Agents"
      title="Ten tools, three hosts"
      to="/guide/agents"
      link="MCP, Pi and OMP"
      :checks="[
        'explorers_balance takes one address or up to twenty, and resolves ENS names before it reads',
        'Every tool is read-only and says so in its annotations; nothing here signs or sends',
        'Over MCP, raw records, ABIs and source stay out of the answer until a call asks for them',
        'A provider that can\'t serve an operation answers with UnsupportedOperationError, not an empty list',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">explorers mcp</code> serves the tools
      over stdio, the Pi and OMP extensions render them in the terminal. All three go through the
      same <code class="font-mono text-[13px] text-highlighted">withProvider()</code> as the CLI,
      so selection, keys and the one retry behave the same wherever the call starts. Your context
      window gets the normalized object and nothing else.
      <template #visual>
        <LandingToolCall :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="One interface"
      title="Same calls, every provider"
      to="/guide"
      link="Getting started"
      :checks="[
        'getBalance and getTxHistory on every provider; the other seven only where they are real',
        'ExplorerError, HTTPError, AuthError, RateLimitError, PlanRestrictedError, NotFoundError and three more',
        'API keys are stripped from every URL before an error message exists',
      ]"
      reverse
    >
      <code class="font-mono text-[13px] text-highlighted">Provider</code> is the abstract base
      with two required reads and seven optional ones. Concrete classes implement the mappers and
      the explorer calls, nothing else leaks upward. A sub path import like
      <code class="font-mono text-[13px] text-highlighted">@agntn/explorers/providers/mempool</code>
      gives you one backend without the other fourteen in your bundle.
      <template #visual>
        <LandingRotatingCode :sample="current" />
      </template>
    </LandingFeature>

    <section class="explorers-section">
      <div
        class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 text-center sm:px-12 lg:px-16"
      >
        <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-3xl">
          Start with one command
        </h2>
        <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Pre-1.0, so pin exact versions. Everything here reads, nothing signs, sends or holds a
          key for you. Keep your explorer keys in the environment and out of your code.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
          <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
            Read the guide
          </UButton>
          <UButton to="/explorer" color="neutral" variant="outline"> Open the explorer </UButton>
        </div>
      </div>
    </section>
  </div>
</template>
