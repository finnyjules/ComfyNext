<script setup lang="ts">
/**
 * ProjectFollowerOverlay — full-canvas scrim shown when this window is a
 * FOLLOWER for the given project (another window holds editing leadership).
 * The view underneath keeps mirroring the leader's saves; the button asks the
 * leader to flush + hand over so THIS window becomes the editor.
 *
 * Renders nothing while the role is 'claiming' (normal loads must not flash
 * the scrim) or 'leader'/untracked.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ projectUuid: string }>()

const leadership = useProjectLeadership()

const visible = computed(() => leadership.roles[props.projectUuid] === 'follower')

// Takeover in flight: disable the button until the role flips to 'leader'
// (the overlay then disappears via `visible`). Safety valve: if we're somehow
// still a follower after 3s (leader hung past the engine's flush cap and the
// handoff fizzled), re-enable so the user can retry.
const takingOver = ref(false)
let retryTimer: ReturnType<typeof setTimeout> | null = null

function requestTakeover() {
  if (takingOver.value) return
  takingOver.value = true
  leadership.takeover(props.projectUuid)
  retryTimer = setTimeout(() => {
    retryTimer = null
    takingOver.value = false
  }, 3000)
}

watch(visible, (v) => {
  if (!v) {
    takingOver.value = false
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  }
})
onBeforeUnmount(() => { if (retryTimer) clearTimeout(retryTimer) })
</script>

<template>
  <!-- Canvas overlays normally need a pointer-events-none root so they don't
       eat wire drags — this one is DELIBERATELY the opposite: swallowing every
       pointer event is the mechanism that makes a follower window read-only.
       Solid interactive layer over the canvas area only (the app tab bar stays
       reachable, so the user can still switch tabs). -->
  <div
    v-if="visible"
    class="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
  >
    <div class="w-[360px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl p-4">
      <div class="text-sm font-semibold text-white mb-1">
        Being edited in another window
      </div>
      <div class="text-[11px] text-white/50 mb-3">
        This view updates as the other window saves. Take over to edit here.
      </div>
      <div class="flex items-center justify-end">
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
          :class="takingOver
            ? 'bg-action/50 cursor-default'
            : 'bg-action hover:bg-palette-blue/80 cursor-pointer'"
          :disabled="takingOver"
          @click="requestTakeover"
        >{{ takingOver ? 'Taking over…' : 'Edit here instead' }}</button>
      </div>
    </div>
  </div>
</template>
