<script setup lang="ts">
import { PROVIDERS } from "../../utils/providers";

const { samples, paused, current, step } = useLandingExplorer();
</script>

<template>
  <div class="explorers-landing not-prose">
    <LandingHero />
    <LandingFeature

      title="An address in, one Balance out"
      to="/explorer"
      link="Open the explorer"
      :checks="[
        'balance is a string in the chain\'s smallest unit; balanceFormatted is the same number for humans',
        'fetchedAt on every read, blockNumber and blockHash when the explorer says which block it meant, null when it doesn\'t',
        'UTXO explorers add funded and spent totals and keep the mempool delta in unconfirmed; the rest leave them out rather than send zero',
      ]"
    >
      <code class="explorers-code">getBalance(address, chain)</code>
      returns the same shape whether the answer came from Etherscan, Mempool or an Arweave
      gateway. ENS names resolve first, so
      <code class="explorers-code">vitalik.eth</code> is as good as the
      hex. This panel walks through {{ samples.length }} addresses on three chains. Each one starts
      as a recorded sample and gets swapped for the worker's live answer the moment it lands.
      <template #visual>
        <LandingBalance :sample="current" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature

      title="History and detail, same Transaction"
      to="/guide/transactions"
      link="Transactions"
      :checks="[
        'hash, from, to, value, fee, status and the token transfers inside, on every chain that has them',
        'to is null without a recipient, createdContract names a deployment, and the one empty string is an Arweave data upload, never an address',
        'OP_RETURN payloads on Bitcoin, Litecoin and Pepecoin come as hex, plus text when the bytes are printable',
      ]"
      reverse
    >
      <code class="explorers-code">getTxHistory</code> pages through an
      address, <code class="explorers-code">getTxDetail</code> reads one
      hash, and both hand back the same
      <code class="explorers-code">Transaction</code>. The explorer's own
      answer rides along in <code class="explorers-code">raw</code> for the
      day you need a field nobody normalized. That day comes, usually on Bitcoin.
      <template #visual>
        <LandingHistory :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature

      title="Keys first, keyless next, Blockscout last"
      to="/guide/selection"
      link="How a provider is picked"
      :checks="[
        'resolveProvider() ranks configured keys, then keyless providers, then anything else that serves the chain',
        'withProvider() retries once on the next candidate after a rate or plan limit, no answer or a 5xx',
        'An explicit --provider stays strict: a wrong chain is an UnsupportedChainError, not a silent switch',
      ]"
    >
      Set <code class="explorers-code">ETHERSCAN_API_KEY</code> and
      Ethereum reads go through Etherscan. Unset it and they go through Blockscout. Nothing else in
      your code changes. The ranking never loads a provider module, so listing candidates is free
      and the one that answers is the only one that gets imported.
      <template #visual>
        <LandingSelection :sample="current" />
      </template>
    </LandingFeature>

    <section class="explorers-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <div class="max-w-2xl">
          <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-[1.75rem]">
            {{ PROVIDERS.length }} backends, honest about what they serve
          </h2>
          <p class="mt-4 text-sm leading-6 text-muted">
            Etherscan wants an API key and a chain id, Koios wants the address in a POST body, the
            Arweave gateway answers half its questions over GraphQL. Each provider keeps that to
            itself and maps its answers onto the shared types. An operation a backend can't serve
            is missing, not stubbed with convincing nonsense, and Aptos stays registered with none.
          </p>
          <p class="landing-entry">
            <span class="console-tag">Import</span>
            <code>@agntn/explorers/providers/&lt;key&gt;</code>
          </p>
        </div>
        <ProviderMatrix class="mt-10" />
      </div>
    </section>

    <LandingFeature

      title="Eleven tools, three hosts"
      to="/guide/agents"
      link="MCP, Pi and OMP"
      :checks="[
        'explorers_balance takes one address or up to twenty, and resolves ENS names before it reads',
        'Every tool is read-only and says so in its annotations; nothing here signs or sends',
        'Over MCP, raw records, ABIs and source stay out of the answer until a call asks for them',
        'A provider that can\'t serve an operation answers with UnsupportedOperationError, not an empty list',
      ]"
    >
      <code class="explorers-code">explorers mcp</code> serves the tools
      over stdio, the Pi and OMP extensions render them in the terminal. All three go through the
      same <code class="explorers-code">withProvider()</code> as the CLI,
      so selection, keys and the one retry behave the same wherever the call starts. Your context
      window gets the normalized object and nothing else.
      <template #visual>
        <LandingToolCall :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature

      title="Same calls, every provider"
      to="/guide"
      link="Getting started"
      :checks="[
        'getBalance and getTxHistory on every provider; the other eight only where they are real',
        'ExplorerError, HTTPError, AuthError, RateLimitError, PlanRestrictedError, NotFoundError and three more',
        'API keys are stripped from every URL before an error message exists',
      ]"
      reverse
    >
      <code class="explorers-code">Provider</code> is the abstract base
      with two required reads and eight optional ones. Concrete classes implement the mappers and
      the explorer calls, nothing else leaks upward. A sub path import like
      <code class="explorers-code">@agntn/explorers/providers/mempool</code>
      gives you one backend without the other eighteen in your bundle.
      <template #visual>
        <LandingRotatingCode :sample="current" />
      </template>
    </LandingFeature>

    <section class="explorers-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <LandingStart />
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-entry {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 20px 0 0;
  min-width: 0;
}
.landing-entry > .console-tag {
  flex: none;
  margin: 0;
}
.landing-entry > code {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
</style>
