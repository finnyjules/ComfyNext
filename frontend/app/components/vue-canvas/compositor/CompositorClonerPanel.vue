<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_CLONER, type Cloner } from '~/composables/useCloner'

const props = defineProps<{ cloner: Cloner | undefined }>()
const emit = defineEmits<{ update: [value: Cloner] }>()

const c = computed<Cloner>(() => ({ ...DEFAULT_CLONER, ...(props.cloner ?? {}) }))

function up(patch: Partial<Cloner>) {
  emit('update', { ...c.value, ...patch })
}
const num = (e: Event) => Number((e.target as HTMLInputElement).value)
// Total instances for the live count chip (excludes the original? no — includes it).
const total = computed(() => {
  const v = c.value
  if (!v.enabled) return 1
  if (v.mode === 'radial') return Math.max(1, Math.floor(v.count))
  const nx = Math.max(1, Math.floor(v.countX))
  const ny = Math.max(1, Math.floor(v.countY))
  return (v.mirrorX ? 2 * nx - 1 : nx) * (v.mirrorY ? 2 * ny - 1 : ny)
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Cloner</div>
      <div class="flex items-center gap-2">
        <span v-if="c.enabled" class="text-[10px] text-white/35 tabular-nums">{{ total }}×</span>
        <!-- enable switch -->
        <button
          class="relative w-8 h-[18px] rounded-full transition-colors cursor-pointer"
          :class="c.enabled ? 'bg-white/80' : 'bg-white/15'"
          :title="c.enabled ? 'Disable cloner' : 'Enable cloner'"
          @click="up({ enabled: !c.enabled })"
        >
          <span class="absolute top-[2px] size-[14px] rounded-full bg-neutral-900 transition-all"
            :class="c.enabled ? 'left-[16px]' : 'left-[2px]'" />
        </button>
      </div>
    </div>

    <template v-if="c.enabled">
      <!-- Mode -->
      <div class="flex items-center gap-1 p-0.5 rounded-md bg-white/[0.05] mb-3">
        <button
          v-for="m in (['linear','radial'] as const)" :key="m"
          class="flex-1 h-7 rounded text-[11px] capitalize cursor-pointer transition-colors"
          :class="c.mode === m ? 'bg-white text-neutral-900 font-medium' : 'text-white/70 hover:bg-white/10'"
          @click="up({ mode: m })"
        >{{ m }}</button>
      </div>

      <!-- Linear / grid -->
      <template v-if="c.mode === 'linear'">
        <div class="grid grid-cols-2 gap-3 mb-3">
          <label class="block">
            <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 block mb-1">Count X</span>
            <input type="number" min="1" max="64" step="1" :value="c.countX"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @input="up({ countX: Math.max(1, Math.round(num($event))) })" />
          </label>
          <label class="block">
            <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 block mb-1">Count Y</span>
            <input type="number" min="1" max="64" step="1" :value="c.countY"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @input="up({ countY: Math.max(1, Math.round(num($event))) })" />
          </label>
        </div>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Spacing X</span><span class="tabular-nums normal-case">{{ c.spacingX.toFixed(2) }}</span>
          </div>
          <input type="range" min="-1" max="1" step="0.01" :value="c.spacingX"
            class="w-full accent-white cursor-pointer" @input="up({ spacingX: num($event) })" />
        </div>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Spacing Y</span><span class="tabular-nums normal-case">{{ c.spacingY.toFixed(2) }}</span>
          </div>
          <input type="range" min="-1" max="1" step="0.01" :value="c.spacingY"
            class="w-full accent-white cursor-pointer" @input="up({ spacingY: num($event) })" />
        </div>
        <!-- Mirror: also clone in the opposite direction (original stays centered) -->
        <div class="mb-1">
          <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">Mirror</div>
          <div class="flex items-center gap-1">
            <button
              class="flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors"
              :class="c.mirrorX ? 'bg-white text-neutral-900 font-medium' : 'bg-white/[0.05] text-white/70 hover:bg-white/10'"
              :title="c.mirrorX ? 'Stop mirroring on X' : 'Also clone in the -X direction'"
              @click="up({ mirrorX: !c.mirrorX })"
            >X</button>
            <button
              class="flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors"
              :class="c.mirrorY ? 'bg-white text-neutral-900 font-medium' : 'bg-white/[0.05] text-white/70 hover:bg-white/10'"
              :title="c.mirrorY ? 'Stop mirroring on Y' : 'Also clone in the -Y direction'"
              @click="up({ mirrorY: !c.mirrorY })"
            >Y</button>
          </div>
        </div>
        <!-- Stagger: brick-style offset of alternating rows/cols (fraction of spacing) -->
        <div class="mt-3">
          <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-2">Stagger</div>
          <div class="mb-3">
            <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
              <span>X (rows)</span><span class="tabular-nums normal-case">{{ c.staggerX.toFixed(2) }}</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" :value="c.staggerX"
              class="w-full accent-white cursor-pointer" @input="up({ staggerX: num($event) })" />
          </div>
          <div>
            <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
              <span>Y (cols)</span><span class="tabular-nums normal-case">{{ c.staggerY.toFixed(2) }}</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" :value="c.staggerY"
              class="w-full accent-white cursor-pointer" @input="up({ staggerY: num($event) })" />
          </div>
        </div>
      </template>

      <!-- Radial -->
      <template v-else>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <label class="block">
            <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 block mb-1">Count</span>
            <input type="number" min="1" max="128" step="1" :value="c.count"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @input="up({ count: Math.max(1, Math.round(num($event))) })" />
          </label>
          <label class="block">
            <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 block mb-1">Radius</span>
            <input type="number" min="0" max="2" step="0.01" :value="c.radius"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @input="up({ radius: Math.max(0, num($event)) })" />
          </label>
        </div>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Start angle</span><span class="tabular-nums normal-case">{{ Math.round(c.startAngle) }}°</span>
          </div>
          <input type="range" min="-180" max="180" step="1" :value="c.startAngle"
            class="w-full accent-white cursor-pointer" @input="up({ startAngle: num($event) })" />
        </div>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Sweep</span><span class="tabular-nums normal-case">{{ Math.round(c.sweepAngle) }}°</span>
          </div>
          <input type="range" min="0" max="360" step="1" :value="c.sweepAngle"
            class="w-full accent-white cursor-pointer" @input="up({ sweepAngle: num($event) })" />
        </div>
        <label class="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer select-none mb-1">
          <input type="checkbox" :checked="c.faceCenter" @change="up({ faceCenter: (($event.target as HTMLInputElement).checked) })" />
          Face center
        </label>
      </template>

      <!-- Falloff (shared) -->
      <div class="mt-3 pt-3 border-t border-white/[0.07]">
        <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-2">Falloff</div>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Rotation</span><span class="tabular-nums normal-case">{{ Math.round(c.stepRotation) }}°</span>
          </div>
          <input type="range" min="-90" max="90" step="1" :value="c.stepRotation"
            class="w-full accent-white cursor-pointer" @input="up({ stepRotation: num($event) })" />
        </div>
        <!-- Nudge: progressive drift per clone (linear/grid only) -->
        <template v-if="c.mode === 'linear'">
          <div class="mb-3">
            <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
              <span>Nudge X</span><span class="tabular-nums normal-case">{{ c.nudgeX.toFixed(2) }}</span>
            </div>
            <input type="range" min="-0.5" max="0.5" step="0.01" :value="c.nudgeX"
              class="w-full accent-white cursor-pointer" @input="up({ nudgeX: num($event) })" />
          </div>
          <div class="mb-3">
            <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
              <span>Nudge Y</span><span class="tabular-nums normal-case">{{ c.nudgeY.toFixed(2) }}</span>
            </div>
            <input type="range" min="-0.5" max="0.5" step="0.01" :value="c.nudgeY"
              class="w-full accent-white cursor-pointer" @input="up({ nudgeY: num($event) })" />
          </div>
        </template>
        <div class="mb-3">
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Scale</span><span class="tabular-nums normal-case">{{ c.stepScale.toFixed(2) }}×</span>
          </div>
          <input type="range" min="0.5" max="1.5" step="0.01" :value="c.stepScale"
            class="w-full accent-white cursor-pointer" @input="up({ stepScale: num($event) })" />
        </div>
        <div>
          <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
            <span>Opacity</span><span class="tabular-nums normal-case">{{ c.stepOpacity.toFixed(2) }}×</span>
          </div>
          <input type="range" min="0.3" max="1" step="0.01" :value="c.stepOpacity"
            class="w-full accent-white cursor-pointer" @input="up({ stepOpacity: num($event) })" />
        </div>
      </div>
    </template>
  </div>
</template>
