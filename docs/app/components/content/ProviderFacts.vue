<script setup lang="ts">
import { hostPath } from "../../utils/format";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_METHODS,
  PROVIDERS,
  chainIcon,
  chainLabel,
  providerInfo,
} from "../../utils/providers";

const props = defineProps<{ provider: string }>();

const info = computed(() => providerInfo(props.provider));
const position = computed(() => PROVIDERS.findIndex((entry) => entry.key === props.provider) + 1);

/** One cell per operation of the `Provider` contract, in the order the registry lists the flags. */
const operations = computed(() =>
  CAPABILITIES.map((capability) => ({
    capability,
    label: CAPABILITY_LABELS[capability],
    method: CAPABILITY_METHODS[capability],
    served: info.value?.capabilities.includes(capability) ?? false,
  })),
);
const served = computed(() => operations.value.filter((operation) => operation.served).length);

/** `none`, `optional` or `key`: the auth column in a word, the variables in the tooltip. */
const authWord = computed(() => {
  const provider = info.value;
  if (!provider || provider.envVars.length === 0) return "none";
  return provider.optionalKey ? "optional" : "key";
});
</script>

<template>
  <section v-if="info" class="tool-console console-wide not-prose my-6" aria-label="Provider record">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">ID</span>{{ info.key
        }}<span v-if="position > 0" class="console-file"
          >{{ String(position).padStart(2, "0") }} / {{ PROVIDERS.length }}</span
        ></span
      >
      <span class="console-meta">{{
        info.envVars.length === 0 ? "keyless" : info.envVars.join(" · ")
      }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true"><span class="console-cursor" /></div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="info.key" :icon="info.icon" />
        <div class="console-name">
          <span class="console-label">Provider</span>
          <h3>{{ info.label }}</h3>
          <ul class="provider-chains" aria-label="Chains">
            <li v-for="chain in info.chains" :key="chain">
              <UTooltip :text="chainLabel(chain)">
                <span class="provider-chain"
                  ><UIcon :name="chainIcon(chain)" aria-hidden="true" />{{ chain }}</span
                >
              </UTooltip>
            </li>
          </ul>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Chains</dt>
            <dd>{{ info.chains.length }}</dd>
          </div>
          <div>
            <dt>Auth</dt>
            <dd>
              <UTooltip v-if="info.envVars.length > 0" :text="info.auth">
                <span>{{ authWord }}</span>
              </UTooltip>
              <template v-else>{{ authWord }}</template>
            </dd>
          </div>
          <div>
            <dt>Operations</dt>
            <dd :class="served > 0 ? 'console-accent' : 'provider-none'">
              {{ served }} of {{ CAPABILITIES.length }}
            </dd>
          </div>
        </dl>
        <div class="console-gauge" :aria-label="`${served} of ${CAPABILITIES.length} operations served`">
          <span class="console-ticks" aria-hidden="true">
            <span
              v-for="(operation, index) in operations"
              :key="operation.capability"
              :class="operation.served ? 'console-tick-open' : 'console-tick-closed'"
              :style="{ animationDelay: `${index * 12}ms` }"
            />
          </span>
          <span class="console-gauge-read">served {{ served }} / {{ CAPABILITIES.length }}</span>
        </div>
      </div>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Operations <span aria-hidden="true">[ Provider contract ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ul class="provider-ops">
        <li
          v-for="operation in operations"
          :key="operation.capability"
          :class="{ 'provider-op-served': operation.served }"
        >
          <span class="provider-op-label">{{ operation.label }}</span>
          <code class="provider-op-method">{{ operation.method }}</code>
          <span class="provider-op-node" aria-hidden="true" />
          <span class="sr-only">{{ operation.served ? "served" : "absent" }}</span>
        </li>
      </ul>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Access <span aria-hidden="true">[ library · docs worker ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="provider-access">
        <dd class="console-lead">
          <span class="console-tag">Create</span>
          <code class="provider-code"
            ><span class="tok-fn">create</span>(<span class="tok-str">"{{ info.key }}"</span>)</code
          >
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd class="console-lead">
          <span class="console-tag">Import</span>
          <code class="provider-code"
            ><span class="tok-str">@agntn/explorers/providers/{{ info.key }}</span></code
          >
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd class="console-lead">
          <span class="console-tag">Host</span>
          <code class="provider-code">{{
            info.defaultURL ? hostPath(info.defaultURL) : "none"
          }}</code>
          <span class="console-leader" aria-hidden="true" />
        </dd>
        <dd class="console-lead">
          <span class="console-tag">Status</span>
          <NuxtLink to="/explorer/providers"
            >providers<span class="provider-dim"> on the docs worker</span></NuxtLink
          >
          <span class="console-leader" aria-hidden="true" />
        </dd>
      </dl>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/providers"><span aria-hidden="true">→ </span>All providers</NuxtLink>
        </li>
      </ul>
      <span class="console-meta">default chain {{ info.defaultChain }}</span>
    </footer>
  </section>
</template>

<style scoped>
.provider-chains {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.provider-chain {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-text-highlighted);
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.provider-chain > :first-child {
  width: 12px;
  height: 12px;
  color: var(--ui-text-muted);
}
.provider-none {
  color: var(--ui-text-muted);
}
.provider-ops {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.provider-ops > li {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 10px;
  align-items: center;
  padding: 7px 10px;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.provider-op-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.provider-op-method {
  grid-column: 1;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--ui-text-dimmed) 55%, transparent);
}
.provider-op-node {
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 7px;
  height: 7px;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.provider-op-served .provider-op-method {
  color: var(--ui-text-highlighted);
  text-decoration: none;
}
.provider-op-served .provider-op-label {
  color: var(--ui-text-muted);
}
.provider-op-served .provider-op-node {
  background: var(--console-accent);
  box-shadow: none;
}
.provider-code {
  font: inherit;
  color: var(--ui-text-highlighted);
}
.provider-dim {
  color: var(--ui-text-dimmed);
}
.console-lead > a:hover .provider-dim {
  color: inherit;
}
.provider-access {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  gap: 0 28px;
  margin: 0;
}
.provider-access > .console-lead {
  margin: 0 0 8px;
  flex-wrap: nowrap;
  min-width: 0;
}
.provider-access .provider-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
@media (width < 640px) {
  .provider-access .console-leader {
    display: none;
  }
}
</style>
