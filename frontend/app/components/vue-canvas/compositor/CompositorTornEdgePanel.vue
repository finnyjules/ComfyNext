<!-- frontend/app/components/vue-canvas/compositor/CompositorTornEdgePanel.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_TORN_EDGE, TORN_EDGE_STYLES, type TornEdgeSpec } from '~/lib/compositor/tornEdge'

const props = defineProps<{ value?: TornEdgeSpec }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<TornEdgeSpec>): void
  (e: 'toggle', on: boolean): void
}>()

const on = computed(() => !!props.value)
const v = computed<TornEdgeSpec>(() => props.value ?? DEFAULT_TORN_EDGE)
const set = (patch: Partial<TornEdgeSpec>) => emit('update', patch)
const reseed = () => emit('update', { seed: Math.floor(Math.abs(Math.sin(v.value.seed + 1) * 99999)) + 1 })
</script>

<template>
  <div class="space-y-2">
    <label class="flex items-center justify-between text-xs">
      <span>Torn edge</span>
      <input type="checkbox" :checked="on" @change="emit('toggle', ($event.target as HTMLInputElement).checked)">
    </label>

    <template v-if="on">
      <label class="block text-xs">Edge style
        <select class="w-full" :value="v.style" @change="set({ style: ($event.target as HTMLSelectElement).value as TornEdgeSpec['style'] })">
          <option v-for="st in TORN_EDGE_STYLES" :key="st" :value="st">{{ st }}</option>
        </select>
      </label>

      <label class="block text-xs">Tear depth
        <input type="range" min="0" max="70" step="1" :value="v.amount" @input="set({ amount: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Roughness
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.roughness * 100)" @input="set({ roughness: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="block text-xs">Grain
        <input type="range" min="0" max="18" step="1" :value="v.grain" @input="set({ grain: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Grain texture
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.grainTexture * 100)" @input="set({ grainTexture: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="block text-xs">Lip width
        <input type="range" min="0" max="20" step="1" :value="v.lipWidth" @input="set({ lipWidth: +($event.target as HTMLInputElement).value })">
      </label>
      <label class="block text-xs">Lip width var
        <input type="range" min="0" max="100" step="1" :value="Math.round(v.lipVariation * 100)" @input="set({ lipVariation: +($event.target as HTMLInputElement).value / 100 })">
      </label>
      <label class="flex items-center justify-between text-xs">Lip color
        <input type="color" :value="v.lipColor" @input="set({ lipColor: ($event.target as HTMLInputElement).value })">
      </label>

      <button type="button" class="text-xs underline" @click="reseed">New tear</button>
    </template>
  </div>
</template>
