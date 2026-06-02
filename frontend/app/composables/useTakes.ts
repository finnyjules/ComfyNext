/**
 * Takes — the non-destructive variation loop (Phase 1 prototype).
 *
 * See docs/plans/2026-06-02-creative-studio-project-takes-design.md.
 *
 * A "take" is one result of one node run. Today a node's output is overwritten
 * on every `executed` event (latest-only). With takes enabled, each run is
 * APPENDED instead, so users can keep, compare and switch between results — the
 * try -> compare -> pick loop that makes it feel like a studio.
 *
 * Design choice for the prototype: takes are ADDITIVE. We keep mirroring the
 * active take onto the legacy `data.images / audios / text / animated` fields,
 * so every existing consumer (node body, downstream nodes, Frame, Timeline,
 * export) keeps working with ZERO changes. The full design centralizes this via
 * a single `resolveActiveTake` read site; the prototype favors the projection
 * approach to keep the default path untouched and the blast radius tiny.
 *
 * Everything here is pure except the flag composable, so it's straightforward
 * to unit-test once the frontend gains a test runner.
 */

export interface Take {
  id: string
  createdAt: number
  promptId: string | null
  label?: string
  pinned?: boolean
  images?: string[]
  audios?: string[]
  text?: string
  animated?: boolean
  /** Stable identity of the underlying output (filenames, ignoring cache-buster). */
  sig?: string
  /** Provenance — what produced it (seed/prompt/model). Filled in over time. */
  params?: Record<string, any>
}

/** Node-data fields the takes system reads/writes. Mixed into the node's data. */
export interface TakeBearingData {
  takes?: Take[]
  activeTakeId?: string | null
  images?: string[]
  audios?: string[]
  text?: string
  animated?: boolean
}

let _takeSeq = 0
export function makeTakeId(): string {
  _takeSeq += 1
  // Date.now is fine here (browser, not a workflow script).
  return `take_${Date.now().toString(36)}_${_takeSeq}`
}

/**
 * Stable signature of an `executed` output payload — the set of output
 * filenames, independent of the cache-buster query. Used to tell a genuinely
 * new result (a re-roll) apart from a live-preview node re-firing `executed`
 * with the same file.
 */
export function outputSignature(output: any): string {
  const parts: string[] = []
  const files = [
    ...(Array.isArray(output?.images) ? output.images : []),
    ...(Array.isArray(output?.audio) ? output.audio : []),
  ]
  for (const f of files) {
    if (f && typeof f === 'object') parts.push(`${f.subfolder || ''}/${f.type || ''}/${f.filename || ''}`)
  }
  if (Array.isArray(output?.text) && output.text.length) {
    parts.push('text:' + output.text.map((t: any) => String(t)).join('|').slice(0, 64))
  }
  return parts.join(';')
}

/** Build a Take from a bridge `executed` output payload + a URL builder. */
export function buildTake(
  promptId: string | null,
  output: any,
  toUrl: (f: any) => string,
  params?: Record<string, any>,
): Take {
  const take: Take = {
    id: makeTakeId(),
    createdAt: Date.now(),
    promptId,
    sig: outputSignature(output),
  }
  if (Array.isArray(output?.images) && output.images.length) {
    take.images = output.images.map(toUrl)
    take.animated = output?.animated?.[0] === true
  }
  if (Array.isArray(output?.audio) && output.audio.length) {
    take.audios = output.audio.map(toUrl)
  }
  if (Array.isArray(output?.text) && output.text.length) {
    take.text = output.text.map((t: any) => String(t)).join('\n\n')
  }
  if (params) take.params = params
  return take
}

/**
 * Project a take's outputs onto the legacy node-data fields so existing
 * consumers need no changes. Returns a NEW data object (caller assigns it).
 */
export function projectTake<T extends TakeBearingData>(data: T, take: Take | null): T {
  return {
    ...data,
    images: take?.images,
    audios: take?.audios,
    text: take?.text,
    animated: take?.animated,
    activeTakeId: take?.id ?? null,
  }
}

/** Upper bound on retained takes per node (drops oldest UNPINNED past this). */
export const MAX_TAKES = 30

/** True if a take actually carries a result worth keeping. */
export function takeHasContent(t: Take): boolean {
  return !!(t.images?.length || t.audios?.length || (t.text && t.text.length))
}

/**
 * Append a take to node data and make it active, mirroring it onto the legacy
 * fields. If ANY existing take shares this one's signature (a live-preview node
 * re-firing for the same file — even one the user has scrolled back to),
 * REPLACE that take in place instead of piling up dupes. Genuine re-rolls get a
 * fresh filename → fresh signature → a new take. Caps growth at MAX_TAKES by
 * dropping the oldest unpinned take. Pure: returns the next data object.
 */
export function appendTake<T extends TakeBearingData>(data: T, take: Take): T {
  const prev = data.takes ?? []
  const dupeIdx = take.sig ? prev.findIndex((t) => t.sig && t.sig === take.sig) : -1
  let takes: Take[]
  if (dupeIdx >= 0) {
    // Same output re-emitted — refresh it in place, preserving pin/label.
    takes = prev.slice()
    takes[dupeIdx] = { ...take, pinned: prev[dupeIdx]!.pinned, label: prev[dupeIdx]!.label }
  } else {
    takes = [...prev, take]
    while (takes.length > MAX_TAKES) {
      const oldestUnpinned = takes.findIndex((t) => !t.pinned)
      if (oldestUnpinned < 0) break // everything is pinned — keep them all
      takes.splice(oldestUnpinned, 1)
    }
  }
  return { ...projectTake(data, take), takes }
}

/** Resolve the currently-active take from node data. */
export function resolveActiveTake(data: TakeBearingData | undefined | null): Take | null {
  if (!data?.takes?.length) return null
  const id = data.activeTakeId
  return data.takes.find((t) => t.id === id) ?? data.takes[data.takes.length - 1] ?? null
}

// --- Feature flag (mirrors useVueNodesEnabled) -----------------------------

const STORAGE_KEY = 'comfynext:Comfy.Takes.Enabled'
const takesEnabled = ref(false)
let listenerRegistered = false

export function useTakesEnabled() {
  function load() {
    if (import.meta.server) return
    takesEnabled.value = localStorage.getItem(STORAGE_KEY) === 'true'
  }

  if (import.meta.client && !listenerRegistered) {
    listenerRegistered = true
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) load()
    })
    window.addEventListener('comfynext:setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === STORAGE_KEY) load()
    }) as EventListener)
    load()
  }

  return { takesEnabled, reloadSetting: load }
}
