<script setup lang="ts">
import { CAPABILITIES, CAPABILITY_LABELS, PROVIDERS } from "../../utils/providers";
</script>

<template>
  <div class="explorers-frame not-prose my-6 overflow-hidden rounded-xl">
    <div class="explorers-table-wrap">
      <table class="explorers-table explorers-table-tight">
        <thead>
          <tr>
            <th>provider</th>
            <th>auth</th>
            <th>chains</th>
            <th v-for="capability in CAPABILITIES" :key="capability" class="explorers-th-up text-center">
              <span>{{ CAPABILITY_LABELS[capability] }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="provider in PROVIDERS" :key="provider.key">
            <td>
              <NuxtLink
                :to="provider.to"
                class="inline-flex items-center gap-2 text-sm text-highlighted hover:text-primary"
              >
                <UIcon :name="provider.icon" class="size-4 text-muted" />
                {{ provider.label }}
                <span class="font-mono text-[11px] text-dimmed">"{{ provider.key }}"</span>
              </NuxtLink>
            </td>
            <td>
              <span class="explorers-chip explorers-chip-small" :title="provider.auth">{{
                provider.envVars.length === 0 ? "none" : provider.optionalKey ? "optional" : "key"
              }}</span>
            </td>
            <td class="font-mono text-xs text-muted">{{ provider.chains.length }}</td>
            <td
              v-for="capability in CAPABILITIES"
              :key="capability"
              class="text-center font-mono text-xs"
            >
              <UIcon
                v-if="provider.capabilities.includes(capability)"
                name="i-lucide-check"
                class="size-4 text-primary"
                :aria-label="`${CAPABILITY_LABELS[capability]} available`"
              />
              <span v-else class="text-dimmed">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
