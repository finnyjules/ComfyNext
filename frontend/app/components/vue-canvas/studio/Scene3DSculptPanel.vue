<script setup lang="ts">
// Sculpt mode's inspector: brush palette, Size/Strength, Symmetry, Apply/Exit.
// Swapped in for the WHOLE Build/Motion inspector column while a SculptSession
// is live (Scene3DStudioSurface.vue owns the session, the engine override, and
// the pointer loop — this component is display + control only, no Three.js).
//
// Task 13 gives Apply and Exit the identical action (commit the session's
// working buffer to the doc once, then leave sculpt mode) — see the surface's
// `commitAndExitSculpt`. Two buttons rather than one because that is the label
// a sculpting tool's users expect; a later task may split them if a "keep
// sculpting after committing" need ever shows up.
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import type { BrushKind } from '~/lib/scene3d/sculpt/brushes'

const brush = defineModel<BrushKind>('brush', { required: true })
const size = defineModel<number>('size', { required: true })
const strength = defineModel<number>('strength', { required: true })
// Phase 3 exposes Off/Mirror only — SymmetryMode also carries 'radial', wired
// up by a later task (see symmetry.ts's header comment). The segmented
// control's model is a plain string; StudioSegmented capitalizes each option
// label from its raw value, so 'none'/'mirror' render as "None"/"Mirror" with
// no translation layer needed.
const symmetry = defineModel<'none' | 'mirror'>('symmetry', { required: true })

// True while commitAndExitSculpt's await is in flight (encodeMesh, the mesh
// cache warm-up). Guards against a fast double-click on Apply/Exit invoking
// the commit twice concurrently — see this task's review finding 3.
defineProps<{ committing?: boolean }>()

defineEmits<{ apply: []; exit: [] }>()

const BRUSHES: BrushKind[] = ['draw', 'smooth', 'inflate', 'flatten']
const SYMMETRY_OPTIONS = ['none', 'mirror']
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <StudioSection title="Brush">
        <StudioSegmented v-model="brush" :options="BRUSHES" />
        <StudioSlider v-model="size" label="Size" :min="0.02" :max="1" :step="0.01" />
        <StudioSlider v-model="strength" label="Strength" :min="0.05" :max="1" :step="0.05" />
        <p class="text-[11px] leading-snug text-white/45">Hold Alt to carve inward</p>
      </StudioSection>

      <StudioSection title="Symmetry">
        <StudioSegmented v-model="symmetry" :options="SYMMETRY_OPTIONS" />
      </StudioSection>
    </div>

    <!-- Sticky footer, mirrors the studio's own Save/Export footer convention
         (border-top, pinned bottom, action-blue primary). -->
    <div class="sticky bottom-0 z-10 mt-auto flex items-center justify-end gap-2 border-t border-white/10 bg-[#0e0e10] pb-1 pt-2">
      <StudioButton variant="secondary" :disabled="committing" @click="$emit('exit')">Exit</StudioButton>
      <StudioButton variant="primary" :disabled="committing" @click="$emit('apply')">Apply</StudioButton>
    </div>
  </div>
</template>
