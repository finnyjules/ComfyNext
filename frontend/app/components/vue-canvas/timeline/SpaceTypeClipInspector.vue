<script setup lang="ts">
import { computed } from 'vue'
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import type { SpaceTypeState } from '~/lib/spacetype/state'
import { spaceTypeClipIsStale } from '~/composables/timelineSpaceTypeClip'

const props = defineProps<{
  clip: SpaceTypeClip
  /** Current state of the originating node, or null when it is gone. */
  nodeState: SpaceTypeState | null
}>()

const emit = defineEmits<{ (e: 'sync', clipId: string): void }>()

/** Only offered when the origin node still exists AND has drifted. No origin,
 *  or a deleted node, renders nothing — that is a normal snapshot clip, not an
 *  error, and must never surface a warning. */
const canSync = computed(() => spaceTypeClipIsStale(props.clip, props.nodeState))

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openSpaceTypeClip', { detail: { clipId: props.clip.id } }))
}
</script>

<template>
  <div class="space-y-2">
    <button
      type="button"
      class="w-full rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/15 transition-colors"
      @click="openEditor"
    >
      Edit in studio →
    </button>
    <div v-if="canSync" class="space-y-1.5">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Source</div>
      <button
        type="button"
        class="w-full text-left text-[10px] text-white/70 hover:text-white transition-colors"
        @click="emit('sync', clip.id)"
      >
        Sync from node — origin state has changed ↺
      </button>
    </div>
  </div>
</template>
