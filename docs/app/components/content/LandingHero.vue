<script setup lang="ts">
import { version } from "../../../../package.json";
import { CHAINS, PROVIDERS } from "../../utils/providers";

const INSTALL = "pnpm add @agntn/explorers";

const keyless = PROVIDERS.filter((provider) => provider.envVars.length === 0).length;
const evm = CHAINS.filter((chain) => chain.type === "evm").length;

/** Chains some provider reads without a key, or with an optional one: nothing to configure there. */
const open = CHAINS.filter((chain) =>
  PROVIDERS.some(
    (provider) =>
      provider.chains.includes(chain.key) &&
      provider.capabilities.includes("balances") &&
      (provider.envVars.length === 0 || provider.optionalKey === true),
  ),
).length;

const { copied, copy } = useCopied();
</script>

<template>
  <header class="explorers-hero hero-page">
    <div class="hero-zone">
      <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
      <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
      <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
      <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

      <p class="console-id">
        <span class="console-id-tag">ID</span>
        <span>@agntn/explorers</span>
        <span class="console-id-sep" aria-hidden="true">/</span>
        <span>v{{ version }}</span>
      </p>

      <h1 class="hero-title">Nineteen explorers. <span>One shape.</span></h1>
      <p class="hero-lead">
        Etherscan, Blockscout, Mempool, Solscan, Koios, dcrdata and the rest behind one TypeScript
        contract. Balances, transactions, unspent outputs, tokens, contracts, gas and blocks as
        exact strings, and a provider picked for you from the keys you have. Library, CLI, MCP, Pi
        and OMP all read through the same code.
      </p>

      <dl class="hero-metrics">
        <div>
          <dt>Providers</dt>
          <dd>{{ PROVIDERS.length }}</dd>
          <dd class="hero-metric-sub">{{ keyless }} keyless</dd>
        </div>
        <div>
          <dt>Chains</dt>
          <dd>{{ CHAINS.length }}</dd>
          <dd class="hero-metric-sub">{{ evm }} EVM</dd>
        </div>
        <div>
          <dt>No key</dt>
          <dd class="hero-metric-accent">{{ open }} <span>chains</span></dd>
          <dd class="hero-metric-sub">read a balance</dd>
        </div>
      </dl>

      <div class="console-actions">
        <UButton
          to="/guide"
          color="primary"
          variant="solid"
          trailing-icon="i-lucide-arrow-right"
          label="Get started"
        />
        <UButton
          to="https://github.com/agntn/explorers"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          label="Star on GitHub"
        />
      </div>
      <div class="console-install">
        <span class="console-install-tag">Install</span>
        <code><span class="console-install-prompt">$</span> {{ INSTALL }}</code>
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'install' ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied === 'install' ? 'Copied' : 'Copy install command'"
          @click="copy('install', INSTALL)"
        />
      </div>
    </div>

    <!-- The search is the real explorer, not a picture of one: a lookup opens its page. -->
    <div class="hero-instrument hero-instrument-keep">
      <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
        <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
        <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
        <path class="hero-circuit-seg" d="M96 38V48" />
        <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
      </svg>
      <span class="hero-circuit-tag" aria-hidden="true">look up</span>
      <ExplorerSearch chain="ethereum" examples />
    </div>
  </header>
</template>
