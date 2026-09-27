<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { shortHash, trimDecimals } from "../../utils/format";
import { PROVIDERS, providerInfo } from "../../utils/providers";
import { tokens } from "../../utils/tokens";

const props = defineProps<{ sample: ExplorerSample }>();

const { copied, copy } = useCopied();

const info = computed(() => providerInfo(props.sample.provider));
const keyNote = computed(() =>
  info.value && info.value.envVars.length > 0
    ? `${info.value.envVars[0]} in the environment`
    : "keyless, nothing to configure",
);

/** Every sample gets the same nine lines, so the file keeps one height while the chain changes. */
const lines = computed(() => {
  const { chain, input, provider, balance } = props.sample;
  const first = props.sample.history[0];
  return [
    'import { create, resolveAddresses, resolveProvider } from "@agntn/explorers";',
    "",
    `// ${provider}: ${keyNote.value}`,
    `const provider = await create(resolveProvider(undefined, "${chain}"));`,
    `const [address] = await resolveAddresses("${input}", "${chain}");`,
    `const balance = await provider.getBalance(address, "${chain}");`,
    `const history = await provider.getTxHistory(address, "${chain}", { limit: 5 });`,
    "",
    `// "${trimDecimals(balance.balanceFormatted, 8)}" ${balance.symbol}, then ${first ? shortHash(first.hash, 10, 6) : "no rows"} first`,
  ];
});
</script>
<template>
  <section class="tool-console landing-file" aria-label="The same calls on every provider">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title file-name"
        ><span class="console-tag">File</span
        ><Transition name="explorers-roll" mode="out-in"
          ><span :key="sample.chain" class="explorers-roll-slot"
            >{{ sample.chain }}.ts</span
          ></Transition
        ></span
      >
      <span class="console-meta">same calls · {{ PROVIDERS.length }} providers</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.chain" class="console-cursor" />
    </div>

    <div class="file-body">
      <p class="console-label console-rule-title">
        <span>Read <span aria-hidden="true">[ whichever provider answers ]</span></span>
        <span class="console-mark" aria-hidden="true" />
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'file' ? 'i-lucide-check' : 'i-lucide-copy'"
          :label="copied === 'file' ? 'copied' : 'copy'"
          :aria-label="copied === 'file' ? 'Copied' : 'Copy the file'"
          @click="copy('file', lines.join('\n'))"
        />
      </p>
      <!-- prettier-ignore -->
      <pre class="console-snippet console-lines file-lines"><code><span v-for="(line, index) in lines" :key="index"><span v-for="(token, part) in tokens(line)" :key="part" :class="token.cls">{{ token.text }}</span></span></code></pre>
    </div>

    <footer class="console-footer console-footer-plain">
      <NuxtLink :to="info?.to ?? '/providers'" class="file-link"
        ><span aria-hidden="true">→ </span>{{ info?.label ?? sample.provider
        }}<span> · @agntn/explorers/providers/{{ sample.provider }}</span></NuxtLink
      >
      <span class="console-meta">lazy import</span>
    </footer>
  </section>
</template>

<style scoped>
.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-name :deep(.explorers-roll-slot) {
  display: inline;
}
.file-body {
  padding: 14px 20px 16px;
}
.file-body > .console-rule-title {
  margin-bottom: 10px;
}
/* One line per code line whatever the chain: long addresses end in an ellipsis, copy hands out the whole line. */
.file-lines > code > span {
  overflow: hidden;
  padding-left: calc(2.25em + 1em);
  text-indent: 0;
  text-overflow: ellipsis;
  white-space: pre;
}
.file-lines > code > span::before {
  margin-left: calc(-2.25em - 1em);
}
.file-lines > code > span :deep(*) {
  white-space: pre;
  overflow-wrap: normal;
}
.file-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.file-link > span:last-child {
  color: var(--ui-text-dimmed);
}
.file-link:hover {
  color: var(--console-accent);
}
.file-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 640px) {
  .file-body > .console-rule-title > .console-mark {
    display: none;
  }
}
@media (width < 400px) {
  .file-body {
    padding-inline: 14px;
  }
  .file-body > .console-rule-title > span:first-child > span {
    display: none;
  }
}
</style>
