<script setup lang="ts">
import { tokens } from "../../utils/tokens";

const { copied, copy } = useCopied();

const INSTALL = "pnpm add @agntn/explorers";

interface Line {
  /** A shell line gets the prompt; everything else is TypeScript and goes through the tokenizer. */
  readonly shell?: boolean;
  readonly text: string;
}

/** Keyless on purpose: without ETHERSCAN_API_KEY the read goes to Blockscout, so this runs as pasted. */
const LINES: readonly Line[] = [
  { shell: true, text: INSTALL },
  { text: "" },
  { text: 'import { create, resolveProvider } from "@agntn/explorers";' },
  { text: "" },
  { text: 'const provider = await create(resolveProvider(undefined, "ethereum"));' },
  { text: 'const balance = await provider.getBalance("0xd8dA…6045", "ethereum");' },
  { text: "balance.balanceFormatted;  // a string, exact" },
];

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** What the copy button hands out: the lines with the whole address, the shell one with its prompt. */
const SNIPPET = LINES.map((line) =>
  line.shell ? `$ ${line.text}` : line.text.replace("0xd8dA…6045", ADDRESS),
).join("\n");

const NOTES = [
  { tag: "Pin", text: "Pre-1.0, so pin exact versions." },
  { tag: "Keys", text: "Explorer keys live in the environment, never in your code." },
  { tag: "Read", text: "Everything here reads. Nothing signs, sends or holds a wallet." },
] as const;
</script>

<template>
  <div class="tool-console console-wide landing-start">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header class="console-bar">
      <span class="console-title"><span class="console-tag">Start</span>{{ INSTALL }}</span>
      <span class="console-meta">Node.js 24 or newer</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true" />

    <div class="start-body">
      <div class="start-copy">
        <h2 class="start-title">Start with one command</h2>
        <p class="start-lead">
          One install gives you the library, the <code>explorers</code> CLI and the MCP server. Ask
          for a provider, or let the keys you have pick one, and read.
        </p>
        <ul class="start-notes">
          <li v-for="note in NOTES" :key="note.tag">
            <span class="console-tag">{{ note.tag }}</span>
            <span>{{ note.text }}</span>
          </li>
        </ul>
        <div class="console-actions start-actions">
          <NuxtLink to="/guide" class="console-action console-action-primary">
            <span class="console-action-label">Read the guide</span>
            <span class="console-action-cell" aria-hidden="true"
              ><UIcon name="i-lucide-arrow-right" class="size-4"
            /></span>
          </NuxtLink>
          <NuxtLink to="/explorer" class="console-action">
            <span class="console-action-cell" aria-hidden="true"
              ><UIcon name="i-lucide-scan-search" class="size-4"
            /></span>
            <span class="console-action-label">Open the explorer</span>
          </NuxtLink>
        </div>
      </div>

      <div class="start-file">
        <p class="console-label console-rule-title">
          <span>First balance <span aria-hidden="true">[ index.ts ]</span></span>
          <span class="console-mark" aria-hidden="true" />
          <button
            type="button"
            class="console-button"
            :aria-label="copied === 'start' ? 'Copied' : 'Copy the first balance'"
            :data-copied="copied === 'start'"
            @click="copy('start', SNIPPET)"
          >
            <UIcon
              :name="copied === 'start' ? 'i-lucide-check' : 'i-lucide-copy'"
              class="size-3"
              aria-hidden="true"
            />
            {{ copied === "start" ? "copied" : "copy" }}
          </button>
        </p>
        <!-- prettier-ignore -->
        <pre
          class="console-snippet console-lines"
        ><code><span v-for="(line, index) in LINES" :key="index"><template v-if="line.shell"><span class="start-prompt">$ </span>{{ line.text }}</template><span v-for="(token, part) in line.shell ? [] : tokens(line.text)" v-else :key="part" :class="token.cls">{{ token.text }}</span></span></code></pre>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <span>MIT license / read-only</span>
      <NuxtLink to="/providers" class="start-link"
        ><span aria-hidden="true">→ </span>every provider</NuxtLink
      >
    </footer>
  </div>
</template>

<style scoped>
/* The copy on the left in the page's reading face, the first lookup on the right as a file. */
.start-body {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 28px 40px;
  padding: 28px;
  border-top: 1px solid var(--console-line);
}
.start-copy,
.start-file {
  min-width: 0;
}
.start-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 500;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ui-text-highlighted);
}
.start-lead {
  margin: 12px 0 0;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
  color: var(--ui-text-muted);
}
.start-lead code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ui-text-highlighted);
}
/* Three notes, each a boxed tag and one sentence, the way the dossiers print their leads. */
.start-notes {
  display: grid;
  gap: 10px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}
.start-notes > li {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
}
.start-notes .console-tag {
  margin: 0;
  text-align: center;
}
.start-notes > li > span:last-child {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text);
}
.start-actions {
  justify-content: flex-start;
  margin-top: 24px;
}
.start-file > .console-rule-title {
  margin: 0 0 12px;
}
.start-file > .console-snippet {
  overflow-wrap: break-word;
}
.start-prompt {
  color: var(--ui-text-dimmed);
}
.start-link {
  margin-left: auto;
  color: var(--ui-text-highlighted);
  text-transform: none;
  letter-spacing: 0.04em;
}
.start-link:hover {
  color: var(--console-accent);
}
.start-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 56rem) {
  .start-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (width < 640px) {
  .start-body {
    padding: 20px 16px;
  }
  .start-file > .console-rule-title > .console-mark,
  .start-file > .console-rule-title > span:first-child > span {
    display: none;
  }
}
</style>
