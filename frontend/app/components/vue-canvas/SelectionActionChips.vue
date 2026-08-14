<!-- frontend/app/components/vue-canvas/SelectionActionChips.vue -->
<script setup lang="ts">
// Selection-driven action sampler (IA spec §3): the top takes-input actions
// for this media type, branching off the artifact via sailor:applyEffect
// (branch: true = new deliverable; never re-points the producing chain).
// "All actions…" deep-links the Actions panel to this domain. Chips use a
// quiet dark look — these are generic escalators, not pastel reviewer-fix chips.
import { ref, onMounted } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { ACTION_CATALOG, CHIPS_BY_DOMAIN, type ActionDomain } from '~/data/action-catalog'
import { getGeneratorIcon } from '~/data/generator-icons'
import { parseBadgeUsd } from '~/lib/costEstimate'
import { formatCostBadge } from '~/lib/pricing'
import { hostedModeEnabled } from '~/lib/hostedMode'
import { fetchObjectInfo } from '~/composables/useVueNodes'

const props = defineProps<{ nodeId: string; domain: ActionDomain; output: string }>()

const chips = CHIPS_BY_DOMAIN[props.domain] ?? []

// Truthful $ hints from the same price_badge the nodes themselves show —
// no hand-maintained price list to drift. objectInfo is cached; this await
// resolves instantly after the canvas's first fetch.
const hints = ref<Record<string, string>>({})
const hostedPricing = hostedModeEnabled(useRuntimeConfig().public)
onMounted(async () => {
  const info = await fetchObjectInfo()
  const out: Record<string, string> = {}
  for (const chip of chips) {
    const cost = parseBadgeUsd(info?.[chip.nodeType]?.price_badge?.expr)
    if (cost) out[chip.nodeType] = formatCostBadge(cost.usd, cost.approximate, hostedPricing)
  }
  hints.value = out
})

function fire(nodeType: string) {
  window.dispatchEvent(new CustomEvent('sailor:applyEffect', {
    detail: { nodeId: props.nodeId, nodeType, output: props.output, branch: true, focus: true },
  }))
}
function openAllActions() {
  window.dispatchEvent(new CustomEvent('sailor:openActions', { detail: { domain: props.domain } }))
}
</script>

<template>
  <div class="nopan nodrag sel-chips flex items-center gap-1 px-1.5 py-1 border-t border-white/5 bg-black/60">
    <button
      v-for="chip in chips"
      :key="chip.nodeType"
      class="sel-chip"
      :title="ACTION_CATALOG[chip.nodeType]?.useCase"
      @click.stop="fire(chip.nodeType)"
    >
      <component :is="getGeneratorIcon(chip.nodeType)" class="size-2.5" />
      {{ chip.chipLabel }}
      <span v-if="hints[chip.nodeType]" class="text-white/35">{{ hints[chip.nodeType] }}</span>
    </button>
    <span class="flex-1" />
    <button class="sel-chip" title="All actions…" @click.stop="openAllActions()">
      <MoreHorizontal class="size-2.5" />
    </button>
  </div>
</template>

<style scoped>
.sel-chips { animation: sel-in 0.18s ease-out; }
@keyframes sel-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.sel-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 10px;
  color: rgb(255 255 255 / 0.7);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.sel-chip:hover { color: #fff; background-color: rgb(255 255 255 / 0.1); }
</style>
