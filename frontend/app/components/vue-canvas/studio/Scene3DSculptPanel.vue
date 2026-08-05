<script setup lang="ts">
// Sculpt mode's Geometry-section replacement: brush palette, Size/Strength,
// Symmetry, in-panel Remesh, Apply/Exit — spec §6's exact list.
//
// Gap 3 fix (Sculpt-and-Merge spec §6, "stays live and untouched"): this used
// to swap out the WHOLE Build/Motion inspector column. It now renders as a
// SIBLING of the Geometry StudioSection inside Scene3DStudioSurface.vue's
// Build tab (see the `v-if="sculpting && selectedMesh"` / `v-else-if` pair
// around its usage site) — Material, Transform, Motion and the Save/Export
// footer stay mounted and live the whole time. That is also why this
// component's own button row is a plain (non-sticky) row now: the sticky
// bottom-of-column treatment belongs to the studio's REAL Save/Export footer,
// which sits below this in the same scrolling column and is no longer
// unmounted while sculpting.
//
// Task 13 gives Apply and Exit the identical action (commit the session's
// working buffer to the doc once, then leave sculpt mode) — see the surface's
// `commitAndExitSculpt`. Two buttons rather than one because that is the
// label a sculpting tool's users expect.
import { computed } from 'vue'
import { Minus, Plus, Loader2 } from 'lucide-vue-next'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import { REMESH_RESOLUTION_MAX } from '~/lib/scene3d/toMesh'
import type { BrushKind } from '~/lib/scene3d/sculpt/brushes'
import type { SymmetryMode } from '~/lib/scene3d/sculpt/symmetry'

const brush = defineModel<BrushKind>('brush', { required: true })
const size = defineModel<number>('size', { required: true })
const strength = defineModel<number>('strength', { required: true })
// The segmented control's model is a plain string; StudioSegmented
// capitalizes each option label from its raw value, so 'none'/'mirror'/
// 'radial' render as "None"/"Mirror"/"Radial" with no translation layer
// needed.
const symmetry = defineModel<SymmetryMode>('symmetry', { required: true })
// Radial-only, but always defined by the parent (defaults live in
// Scene3DStudioSurface.vue) — these two only affect anything while `symmetry`
// is 'radial', per expandStamp's contract (symmetry.ts).
const symmetryAxis = defineModel<0 | 1 | 2>('symmetryAxis', { required: true })
const symmetryCount = defineModel<number>('symmetryCount', { required: true })
// Gap 4: in-panel Remesh. Resolution is the only piece the panel itself
// drives (defineModel); vertex count/KB are read-only readouts the surface
// derives from the LIVE session buffer (`sculptSession.toMeshData()`), not
// from `doc.objects`' stale pre-sculpt copy — see the surface's
// `remeshSculptSession` for why that distinction matters.
const remeshResolution = defineModel<number>('remeshResolution', { required: true })

// True while commitAndExitSculpt's await is in flight (encodeMesh, the mesh
// cache warm-up) OR an in-panel Remesh is running — guards against a fast
// double-click on Apply/Exit/Remesh invoking two of these concurrently. The
// surface ORs both busy flags together before passing `committing` down, so
// this component only needs the one prop.
const props = defineProps<{
  committing?: boolean
  remeshVertexCount: number
  // Named `remeshKb` (not `remeshKB`) on purpose — Vue's kebab-case→camelCase
  // attribute matching only capitalizes the letter AFTER each hyphen
  // (`remesh-kb` → `remeshKb`), so a prop literally named `remeshKB` would
  // silently fail to bind from a kebab-case template attribute.
  remeshKb: string
  remeshBusy?: boolean
  remeshError?: string
}>()

defineEmits<{ apply: []; exit: []; remesh: [] }>()

const BRUSHES: BrushKind[] = ['draw', 'smooth', 'inflate', 'flatten', 'grab', 'pinch', 'crease']
const SYMMETRY_OPTIONS = ['none', 'mirror', 'radial']
const AXIS_LABELS: readonly ['x', 'y', 'z'] = ['x', 'y', 'z']
const AXIS_OPTIONS: string[] = [...AXIS_LABELS]

// StudioSegmented needs a plain string model; SymmetrySpec needs 0|1|2. This
// is the one narrow spot that translates between them.
const axisLabel = computed<string>({
  get: () => AXIS_LABELS[symmetryAxis.value],
  set: (v) => { symmetryAxis.value = AXIS_LABELS.indexOf(v as typeof AXIS_LABELS[number]) as 0 | 1 | 2 },
})

const MIN_RADIAL_COUNT = 2
const MAX_RADIAL_COUNT = 16
function stepCount(delta: number) {
  symmetryCount.value = Math.min(MAX_RADIAL_COUNT, Math.max(MIN_RADIAL_COUNT, symmetryCount.value + delta))
}

// Apply/Exit and Remesh are mutually exclusive: neither may run while the
// other is in flight (a commit mid-remesh would race the buffer swap; a
// remesh mid-commit would re-point the engine override out from under an
// encode already reading the old one).
const busy = computed(() => !!props.committing || !!props.remeshBusy)
</script>

<template>
  <StudioSection title="Brush">
    <StudioSegmented v-model="brush" :options="BRUSHES" />
    <StudioSlider v-model="size" label="Size" :min="0.02" :max="1" :step="0.01" />
    <StudioSlider v-model="strength" label="Strength" :min="0.05" :max="1" :step="0.05" />
    <p class="text-[11px] leading-snug text-white/45">Hold Alt to carve inward</p>
  </StudioSection>

  <StudioSection title="Symmetry">
    <StudioSegmented v-model="symmetry" :options="SYMMETRY_OPTIONS" />
    <div v-if="symmetry === 'radial'" class="flex items-center gap-3 pt-1">
      <div class="flex items-center gap-1 text-[11px] text-white/50">
        <span>Count</span>
        <button
          type="button" class="rounded border border-white/10 p-0.5 hover:bg-white/10 disabled:opacity-30"
          :disabled="symmetryCount <= MIN_RADIAL_COUNT" @click="stepCount(-1)"
        ><Minus :size="11" /></button>
        <span class="w-5 text-center tabular-nums text-white/80">{{ symmetryCount }}</span>
        <button
          type="button" class="rounded border border-white/10 p-0.5 hover:bg-white/10 disabled:opacity-30"
          :disabled="symmetryCount >= MAX_RADIAL_COUNT" @click="stepCount(1)"
        ><Plus :size="11" /></button>
      </div>
      <div class="flex flex-1 items-center gap-1 text-[11px] text-white/50">
        <span>Axis</span>
        <StudioSegmented v-model="axisLabel" :options="AXIS_OPTIONS" />
      </div>
    </div>
  </StudioSection>

  <!-- Remesh (Gap 4, spec §6): same resolution-slider / vertex-count-readout /
       button shape as the inspector's own mesh Geometry block, just driven by
       the session's LIVE working buffer instead of the doc's stale pre-sculpt
       copy. The hint spells out the undo cost up front (hazard 2 — the old
       undo ring cannot survive a remesh; a fresh SculptSession is built with
       an empty one) rather than letting it surprise the user on the next
       Cmd+Z. -->
  <StudioSection title="Remesh">
    <StudioSlider v-model="remeshResolution" label="Resolution" :min="16" :max="REMESH_RESOLUTION_MAX" :step="1" />
    <p class="text-[11px] text-white/45">{{ remeshVertexCount.toLocaleString('en-US') }} vertices · {{ remeshKb }} KB</p>
    <p class="text-[11px] leading-snug text-white/45">Rebuilds the sculpted surface at a new density and clears this sculpt's undo history.</p>
    <StudioButton :disabled="busy" @click="$emit('remesh')">
      <span class="flex items-center gap-1.5">
        <Loader2 v-if="remeshBusy" class="h-3.5 w-3.5 animate-spin" />
        {{ remeshBusy ? 'Remeshing…' : 'Remesh' }}
      </span>
    </StudioButton>
    <p v-if="remeshError" class="text-[11px] leading-snug text-red-400/90">{{ remeshError }}</p>
  </StudioSection>

  <div class="flex items-center justify-end gap-2 pt-1">
    <StudioButton variant="secondary" :disabled="busy" @click="$emit('exit')">Exit</StudioButton>
    <StudioButton variant="primary" :disabled="busy" @click="$emit('apply')">Apply</StudioButton>
  </div>
</template>
