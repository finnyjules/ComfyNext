<!-- frontend/app/components/vue-canvas/compositor/CompositorFeatherPanel.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_FEATHER, type FeatherSpec } from '~/lib/compositor/feather'

const props = defineProps<{ value?: FeatherSpec }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<FeatherSpec>): void
  (e: 'toggle', on: boolean): void
}>()

const on = computed(() => !!props.value)
const v = computed<FeatherSpec>(() => props.value ?? DEFAULT_FEATHER)
const set = (patch: Partial<FeatherSpec>) => emit('update', patch)
// Slider works in whole percent-of-canvas-width; store as a 0..0.5 fraction.
const amountPct = computed(() => Math.round(v.value.amount * 100))
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <div class="panel-label">Feather</div>
      <button type="button" class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
        @click="emit('toggle', !on)">{{ on ? 'Remove' : 'Add' }}</button>
    </div>

    <template v-if="on">
      <div class="space-y-2">
        <div>
          <div class="flex items-center justify-between panel-sublabel mb-1"><span>Amount</span><span class="tabular-nums normal-case">{{ amountPct }}</span></div>
          <input type="range" min="0" max="40" step="1" :value="amountPct" class="w-full accent-white cursor-pointer"
            @input="set({ amount: +($event.target as HTMLInputElement).value / 100 })">
        </div>

        <div>
          <div class="panel-sublabel mb-1">Falloff</div>
          <div class="flex gap-1">
            <button type="button"
              class="flex-1 text-[11px] px-2 py-1 rounded border"
              :class="v.curve === 'linear' ? 'border-[#3b82f6] text-white bg-[#3b82f6]/10' : 'border-[#2a2a2a] text-white/60 hover:text-white/90'"
              @click="set({ curve: 'linear' })">Linear</button>
            <button type="button"
              class="flex-1 text-[11px] px-2 py-1 rounded border"
              :class="v.curve === 'smooth' ? 'border-[#3b82f6] text-white bg-[#3b82f6]/10' : 'border-[#2a2a2a] text-white/60 hover:text-white/90'"
              @click="set({ curve: 'smooth' })">Smooth</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
