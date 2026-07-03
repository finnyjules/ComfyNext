<!-- frontend/app/components/vue-canvas/SelectionActionChips.vue -->
<script setup lang="ts">
// Selection-driven action sampler (IA spec §3): the top takes-input actions
// for this media type, branching off the artifact via comfynext:applyEffect
// (branch: true = new deliverable; never re-points the producing chain).
// "All actions…" deep-links the Actions panel to this domain. Chips use the
// quiet ns-chip look from NextStepsStrip — these are generic escalators, not
// pastel reviewer-fix chips.
import { MoreHorizontal } from 'lucide-vue-next'
import { ACTION_CATALOG, CHIPS_BY_DOMAIN, type ActionDomain } from '~/data/action-catalog'
import { getGeneratorIcon } from '~/data/generator-icons'

const props = defineProps<{ nodeId: string; domain: ActionDomain; output: string }>()

const chips = CHIPS_BY_DOMAIN[props.domain] ?? []

function fire(nodeType: string) {
  window.dispatchEvent(new CustomEvent('comfynext:applyEffect', {
    detail: { nodeId: props.nodeId, nodeType, output: props.output, branch: true, focus: true },
  }))
}
function openAllActions() {
  window.dispatchEvent(new CustomEvent('comfynext:openActions', { detail: { domain: props.domain } }))
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
