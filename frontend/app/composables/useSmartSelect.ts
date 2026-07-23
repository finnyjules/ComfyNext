/**
 * Smart-select state machine: accumulated SAM point prompts + the busy/queue/
 * fallback rules around the segment call. Framework-light on purpose (explicit
 * vue imports, injected segment fn, no DOM) so it unit-tests in node — all
 * canvas/overlay plumbing stays in CompositorModal.vue.
 *
 * Rules:
 *  - refine() during a flight queues exactly ONE trailing re-run (latest points).
 *  - a failed refine sets failed=true and clears maskUrls — the caller falls
 *    back to using the raw scribble as the selection (hard spec requirement).
 *  - reset() invalidates any in-flight response (session counter).
 *  - the segment-everything API output doesn't depend on the prompt points —
 *    only on the image — so candidates are cached per image: refine() with
 *    the same image after a success returns immediately without calling
 *    deps.segment again (picking which candidates matter is client-side, per
 *    point, and happens on every points change independent of this cache).
 */
import { ref } from 'vue'
import type { SamPoint } from '~/lib/compositor/smartSelect'

export interface SmartSelectDeps {
  segment: (image: string, points: SamPoint[]) => Promise<string[]>
}

export function useSmartSelect(deps: SmartSelectDeps) {
  const points = ref<SamPoint[]>([])
  const busy = ref(false)
  const maskUrls = ref<string[] | null>(null)
  const failed = ref(false)
  let queued: string | null = null // image for the queued trailing re-run
  let session = 0
  let lastImage: string | null = null // image the cached maskUrls came from

  function addPoints(pts: SamPoint[]) {
    points.value = [...points.value, ...pts]
  }

  function reset() {
    session++
    points.value = []
    maskUrls.value = null
    failed.value = false
    busy.value = false
    queued = null
    lastImage = null
  }

  async function refine(image: string): Promise<void> {
    if (lastImage === image && maskUrls.value?.length) return
    if (busy.value) { queued = image; return }
    if (!points.value.length) return
    const mySession = session
    busy.value = true
    try {
      const masks = await deps.segment(image, points.value)
      if (mySession !== session) return
      maskUrls.value = masks
      failed.value = false
      lastImage = image
    } catch {
      if (mySession !== session) return
      maskUrls.value = null
      failed.value = true
    } finally {
      if (mySession === session) {
        busy.value = false
        const next = queued
        queued = null
        if (next) void refine(next)
      }
    }
  }

  return { points, busy, maskUrls, failed, addPoints, refine, reset }
}
