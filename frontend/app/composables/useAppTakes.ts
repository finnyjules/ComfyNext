import { ref, computed } from 'vue'
import { type Take, makeTakeId, MAX_TAKES } from '~/composables/useTakes'

/**
 * Per-app takes: the same non-destructive "try → compare → pick" loop the node
 * canvas uses, adapted for the single-purpose Apps (Product Shot, Face Swap,
 * Auto Subtitle, Karaoke Maker). Each App owns one instance (call it once in
 * setup). Re-running a generation appends a take instead of overwriting the
 * previous result, so users can flip between runs.
 *
 * App results are already resolved URLs (not raw ComfyUI output payloads), so
 * the caller passes URLs directly. State is in-memory for the app-tab session,
 * matching the node takes model.
 */
export interface AppTakeInput {
  images?: string[]
  audios?: string[]
  videos?: string[]
  text?: string
  animated?: boolean
  promptId?: string | null
  /** Stable identity to dedupe a re-emitted identical result. Defaults to the URLs. */
  sig?: string
  params?: Record<string, any>
}

export function useAppTakes() {
  const takes = ref<Take[]>([])
  const activeTakeId = ref<string | null>(null)

  const activeTake = computed<Take | null>(() =>
    takes.value.find((t) => t.id === activeTakeId.value) ?? null,
  )

  function addTake(input: AppTakeInput): Take {
    const sig = input.sig
      ?? input.images?.join('|')
      ?? input.audios?.join('|')
      ?? input.videos?.join('|')
      ?? input.text
      ?? ''
    const take: Take = {
      id: makeTakeId(),
      createdAt: Date.now(),
      promptId: input.promptId ?? null,
      images: input.images,
      audios: input.audios,
      videos: input.videos,
      text: input.text,
      animated: input.animated,
      sig,
      params: input.params,
    }
    const dupe = sig ? takes.value.findIndex((t) => t.sig && t.sig === sig) : -1
    if (dupe >= 0) {
      // Identical result re-emitted — refresh in place, preserve pin/label/id.
      const next = takes.value.slice()
      next[dupe] = { ...take, id: next[dupe]!.id, pinned: next[dupe]!.pinned, label: next[dupe]!.label }
      takes.value = next
      activeTakeId.value = next[dupe]!.id
    } else {
      const next = [...takes.value, take]
      while (next.length > MAX_TAKES) {
        const oldest = next.findIndex((t) => !t.pinned)
        if (oldest < 0) break
        next.splice(oldest, 1)
      }
      takes.value = next
      activeTakeId.value = take.id
    }
    return take
  }

  function selectTake(id: string) {
    if (takes.value.some((t) => t.id === id)) activeTakeId.value = id
  }

  function pinTake(id: string) {
    const t = takes.value.find((x) => x.id === id)
    if (t) t.pinned = !t.pinned
  }

  function discardTake(id: string) {
    const idx = takes.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    takes.value.splice(idx, 1)
    if (activeTakeId.value === id) {
      activeTakeId.value = takes.value[takes.value.length - 1]?.id ?? null
    }
  }

  function reset() {
    takes.value = []
    activeTakeId.value = null
  }

  return { takes, activeTakeId, activeTake, addTake, selectTake, pinTake, discardTake, reset }
}
