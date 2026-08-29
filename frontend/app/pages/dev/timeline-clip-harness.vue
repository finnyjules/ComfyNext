<script setup lang="ts">
// Dev/test-only surface — 404 in production builds (mirrors /timeline-harness).
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

// Playwright drives window.__clipHarness to prove the Timeline's clip-in-place
// editing feature (spec 1): editing a Space Type clip's state THROUGH THE REAL
// STORE reaches the rendered pixels, preserves the clip's trim, and detaches it
// from its origin node. Unlike /timeline-harness (which loads a static fixture
// straight into a PreviewRenderer), this harness holds the real useTimelineStore
// so the edit goes through updateSpaceTypeClipState — the actual code under test —
// and every render reads the store's CURRENT state. It deliberately uses the
// WebGL renderer: that is the only preview path that bakes a Space Type clip live
// from clip.state (the server path reads a pre-baked spacetype_frames list that
// the preview payload never carries, and would skip the clip). Not linked from
// any app UI.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import {
  createDefaultEditState,
  migrateEditState,
  type EditState,
  type SpaceTypeClip,
} from '~~/shared/timeline/types'
import type { SpaceTypeState } from '~~/shared/spacetype/state'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { createSpaceTypeClip } from '~/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '~/lib/spacetype/state'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'

const canvas = ref<HTMLCanvasElement | null>(null)
const status = ref('idle')
const store = useTimelineStore()
let renderer: WebGLPreviewRenderer | null = null

function findClip(clipId: string): SpaceTypeClip {
  const clip = store.state.value.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId)
  if (!clip || clip.kind !== 'spacetype') throw new Error(`no spacetype clip ${clipId}`)
  return clip as SpaceTypeClip
}

onMounted(() => {
  ;(window as any).__clipHarness = {
    /** Reset the store to a one-clip timeline (one Space Type clip on the video
     *  track, attached to a fake origin node so detach is observable). Returns
     *  the clip id. `text`/`state` overrides let a test seed a known starting
     *  point. */
    seed(overrides?: { text?: string; state?: Partial<SpaceTypeState> }): { clipId: string } {
      const seedState: SpaceTypeState = {
        ...defaultSpaceTypeState(),
        transparent: false,
        bgColor: '#0e0e10',
        ...(overrides?.state ?? {}),
      }
      seedState.params = { ...seedState.params, text: overrides?.text ?? 'HELLO' }

      const edit: EditState = createDefaultEditState()
      const track = edit.tracks.find((t) => t.kind === 'video')
      if (!track) throw new Error('default edit state has no video track')
      const clip = createSpaceTypeClip({ startFrame: 0, state: seedState, originNodeId: 'harness-node' })
      track.clips.push(clip)
      edit.total_frames = Math.max(edit.total_frames, clip.start_frame + clip.length)

      store.state.value = edit
      status.value = `seeded ${clip.id}`
      return { clipId: clip.id }
    },

    /** Render the store's CURRENT state at `frame`. One persistent renderer is
     *  reused across calls: load() disposes its sources but keeps the GL context
     *  alive (see WebGLPreviewRenderer.load), so re-rendering is cheap and a
     *  re-render of the SAME state is byte-stable. load() (not setState) is
     *  called every time because an in-place edit produces a NEW clip object —
     *  the old SpaceTypeSource captured the pre-edit clip and must be rebuilt to
     *  see the new state. Returns a PNG data URL. */
    async render(frame: number): Promise<string> {
      if (!canvas.value) throw new Error('canvas not mounted')
      renderer ??= new WebGLPreviewRenderer()
      // Detached deep copy so the renderer never aliases store state.
      const snapshot = migrateEditState(JSON.parse(JSON.stringify(store.state.value)))
      if (!snapshot) throw new Error('store state failed migration')
      await renderer.load(snapshot)
      await renderer.renderFrame(frame, canvas.value)
      status.value = `rendered frame ${frame}`
      return canvas.value.toDataURL('image/png')
    },

    /** Edit the clip's content through the REAL store method under test. `patch`
     *  is shallow-merged onto the current state; `patch.params` is merged onto
     *  the current params. This is the exact call SpaceTypeSurface makes when a
     *  clip is edited in place. */
    edit(clipId: string, patch: Partial<SpaceTypeState>): void {
      const clip = findClip(clipId)
      const next: SpaceTypeState = {
        ...clip.state,
        ...patch,
        params: { ...clip.state.params, ...(patch.params ?? {}) },
      }
      store.updateSpaceTypeClipState(clipId, next)
      status.value = `edited ${clipId}`
    },

    /** The clip's trim triple — must be untouched by a content edit. */
    trim(clipId: string): { start_frame: number; in_frame: number; length: number } {
      const c = findClip(clipId)
      return { start_frame: c.start_frame, in_frame: c.in_frame, length: c.length }
    },

    /** The clip's origin link, or null once detached. */
    origin(clipId: string): SpaceTypeClip['origin'] | null {
      return findClip(clipId).origin ?? null
    },

    /** The clip's current state (for assertions). */
    clipState(clipId: string): SpaceTypeState {
      return findClip(clipId).state
    },
  }
  status.value = 'ready'
})

onBeforeUnmount(() => {
  renderer?.dispose()
  renderer = null
  delete (window as any).__clipHarness
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="clip-harness-status">{{ status }}</div>
    <canvas ref="canvas" class="mt-2 border border-neutral-700" />
  </div>
</template>
