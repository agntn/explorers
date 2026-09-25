<script setup lang="ts">
import type { ExplorerSample } from "../../utils/landing-fixtures";
import { clip, shortHash, trimDecimals } from "../../utils/format";
import { PROVIDERS, chainLabel, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: ExplorerSample; tick: number }>();

const W = 1200;
const H = 420;
const CALL = { x: 24, y: 130, w: 340, h: 160 };
const RESULT = { x: 870, y: 20, w: 306, h: 380 };

/** One row per provider, 1 apart, sized to fill the box less 6 at each edge; the stack is centred in what rounding leaves over. */
const EDGE = 6;
const GAP = 1;
const ROW_H = Math.floor((H - 2 * EDGE - (PROVIDERS.length - 1) * GAP) / PROVIDERS.length);
const TOP = Math.floor((H - PROVIDERS.length * (ROW_H + GAP) + GAP) / 2);
const NODE = { x: 510, w: 200, h: ROW_H };
/** Baseline that centres the 13px provider label in a row. */
const TEXT_Y = Math.round(ROW_H / 2 + 4.5);

/** Every registered provider, in registry order; the ones that serve the sample's chain are wired, the chosen one lit. */
const nodes = computed(() =>
  PROVIDERS.map((provider, index) => ({
    ...provider,
    y: TOP + index * (NODE.h + GAP),
    serves: provider.chains.includes(props.sample.chain),
    active: provider.key === props.sample.provider,
  })),
);

function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const trunkPaths = computed(() =>
  nodes.value
    .filter((node) => node.serves)
    .map((node) => ({
      d: curvePath(CALL.x + CALL.w, CALL.y + CALL.h / 2, NODE.x, node.y + NODE.h / 2),
      active: node.active,
    })),
);

const branchPaths = computed(() =>
  nodes.value
    .filter((node) => node.serves)
    .map((node) => ({
      d: curvePath(NODE.x + NODE.w, node.y + NODE.h / 2, RESULT.x, RESULT.y + RESULT.h / 2),
      active: node.active,
    })),
);

const fields = computed(() => {
  const balance = props.sample.balance;
  return [
    { label: "balance", value: balance.balance },
    { label: "balanceFormatted", value: `${trimDecimals(balance.balanceFormatted, 8)} ${balance.symbol}` },
    { label: "chain", value: balance.chain },
    { label: "address", value: shortHash(balance.address, 10, 6) },
    { label: "blockNumber", value: balance.blockNumber === null ? "null" : String(balance.blockNumber) },
    { label: "fetchedAt", value: balance.fetchedAt.slice(0, 19).replace("T", " ") },
  ];
});

/** Space Mono is about 0.62 em wide per glyph; shrink the input until it fits the box. */
const inputFontSize = computed(() =>
  Math.min(22, Math.floor((CALL.w - 36) / (props.sample.input.length * 0.62))),
);
</script>

<template>
  <svg
    :viewBox="`0 0 ${W} ${H}`"
    class="explorers-flow"
    role="img"
    aria-label="One getBalance call is routed to a provider that serves the chain and comes back as one Balance shape"
  >
    <g class="explorers-flow-wires">
      <path
        v-for="(path, index) in trunkPaths"
        :key="`t${index}`"
        :d="path.d"
        :class="{ 'explorers-flow-wire-dim': !path.active }"
      />
      <path
        v-for="(path, index) in branchPaths"
        :key="`b${index}`"
        :d="path.d"
        :class="{ 'explorers-flow-wire-dim': !path.active }"
      />
    </g>
    <g :key="tick" class="explorers-flow-pulses">
      <template v-for="(path, index) in trunkPaths" :key="`pt${index}`">
        <path v-if="path.active" :d="path.d" class="explorers-flow-pulse" />
      </template>
      <template v-for="(path, index) in branchPaths" :key="`pb${index}`">
        <path
          v-if="path.active"
          :d="path.d"
          class="explorers-flow-pulse explorers-flow-pulse-late"
        />
      </template>
    </g>

    <g class="explorers-flow-node">
      <rect :x="CALL.x" :y="CALL.y" :width="CALL.w" :height="CALL.h" rx="10" />
      <text :x="CALL.x + 18" :y="CALL.y + 30" class="explorers-flow-label">
        getBalance(address, chain)
      </text>
      <text
        :x="CALL.x + 18"
        :y="CALL.y + 72"
        class="explorers-flow-domain explorers-flow-accent"
        :style="{ fontSize: `${inputFontSize}px` }"
      >
        <tspan :key="sample.input" class="explorers-derive">{{ clip(sample.input, 30) }}</tspan>
      </text>
      <text :x="CALL.x + 18" :y="CALL.y + 104" class="explorers-flow-mono">
        resolveProvider(undefined, "{{ sample.chain }}")
      </text>
      <text :x="CALL.x + 18" :y="CALL.y + 130" class="explorers-flow-label">
        {{ chainLabel(sample.chain) }} · {{ sample.live ? "live" : "sample" }}
      </text>
    </g>

    <g
      v-for="node in nodes"
      :key="node.key"
      class="explorers-flow-node"
      :class="{ 'explorers-flow-dim': !node.active }"
      :opacity="node.serves ? 1 : 0.45"
    >
      <rect :x="NODE.x" :y="node.y" :width="NODE.w" :height="NODE.h" rx="6" />
      <text :x="NODE.x + 12" :y="node.y + TEXT_Y" class="explorers-flow-small">
        {{ providerLabel(node.key) }}
      </text>
      <text
        :x="NODE.x + NODE.w - 12"
        :y="node.y + TEXT_Y"
        text-anchor="end"
        class="explorers-flow-label"
      >
        {{ node.envVars.length === 0 ? "keyless" : "key" }}
      </text>
    </g>

    <g class="explorers-flow-node">
      <rect :x="RESULT.x" :y="RESULT.y" :width="RESULT.w" :height="RESULT.h" rx="10" />
      <text :x="RESULT.x + 18" :y="RESULT.y + 28" class="explorers-flow-label">Balance</text>
      <text
        :x="RESULT.x + RESULT.w - 18"
        :y="RESULT.y + 28"
        text-anchor="end"
        class="explorers-flow-mono"
      >
        via {{ sample.provider }}
      </text>
      <line
        :x1="RESULT.x + 1"
        :x2="RESULT.x + RESULT.w - 1"
        :y1="RESULT.y + 44"
        :y2="RESULT.y + 44"
        class="explorers-flow-rule"
      />
      <g
        v-for="(field, index) in fields"
        :key="`${sample.input}-${field.label}`"
        class="explorers-derive"
      >
        <text :x="RESULT.x + 18" :y="RESULT.y + 70 + index * 54" class="explorers-flow-label">
          {{ field.label }}
        </text>
        <text
          :x="RESULT.x + 18"
          :y="RESULT.y + 90 + index * 54"
          :class="field.label === 'balance' ? 'explorers-flow-mono' : 'explorers-flow-title'"
        >
          {{ clip(field.value, 30) }}
        </text>
      </g>
    </g>
  </svg>
</template>
