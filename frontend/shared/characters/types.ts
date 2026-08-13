/**
 * THE character model. One character = a set of STATES (Higgsfield: one asset
 * per state — Cal-clean / Cal-wet / Cal-bloody), each with its own composite
 * sheet that is the identity asset every generator consumes. Imported by both
 * the Nitro server (registry) and the app (store) — no more hand-copied mirrors.
 */
export type PanelSlot = 'body-front' | 'body-back' | 'portrait' | 'face-neutral' | 'face-smile'

export interface CharacterPanel { slot: PanelSlot; filename: string }

export type CharacterStateStatus = 'draft' | 'testing' | 'locked'

export interface StressResult { passes: number; total: number; at: string }

export interface CharacterState {
  /** Stable id. 'default' is an ordinary stored id — client-side addressing uses null for "the default". */
  id: string
  label: string
  /** State look descriptor ("soaked navy jacket, wet hair") — feeds sheet prompts AND the shot's cast clause. */
  descriptor: string
  /** Legacy free-form ref pool (uploads, LoRA training fodder, pre-sheet fallback). */
  refImages: string[]
  coverIndex: number
  /** The 5 Higgsfield source shots, kept for per-panel reroll. */
  panels: CharacterPanel[]
  /** Composite sheet filename in the input dir — THE identity asset once generated. */
  sheetImage: string | null
  status: CharacterStateStatus
  stressResult: StressResult | null
  updatedAt: string
}

export interface CharacterRecord {
  name: string
  slug: string
  states: CharacterState[]
  loraName: string | null
  trigger: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

/** 'default' | '' | undefined → null. The ONLY place the sentinel is understood. */
export function normalizeStateId(id: string | null | undefined): string | null {
  return id && id !== 'default' ? id : null
}

export function defaultState<T extends Pick<CharacterRecord, 'states'>>(record: T): T['states'][number] {
  return record.states.find(s => s.id === 'default') ?? record.states[0]!
}

export function pickState<T extends Pick<CharacterRecord, 'states'>>(
  record: T, stateId: string | null,
): T['states'][number] | undefined {
  const byId = stateId ? record.states.find(s => s.id === stateId) : undefined
  return byId ?? record.states.find(s => s.id === 'default') ?? record.states[0]
}

/** Ref filenames cover-first, so `slice(0, 1)` is the cover the user picked. */
export function coverFirstRefs(state?: Pick<CharacterState, 'refImages' | 'coverIndex'>): string[] {
  const refs = state?.refImages ?? []
  if (refs.length <= 1) return [...refs]
  const ci = Math.min(Math.max(state?.coverIndex ?? 0, 0), refs.length - 1)
  return [refs[ci]!, ...refs.slice(0, ci), ...refs.slice(ci + 1)]
}

export function panelFilename(state: Pick<CharacterState, 'panels'>, slot: PanelSlot): string | null {
  return state.panels.find(p => p.slot === slot)?.filename ?? null
}

/**
 * The consumption list, identity-asset-first: once a composite sheet exists it
 * leads (so CAST_REF_CAP=1 sends the sheet); before that, cover-first refs.
 */
export function identityRefs(state?: CharacterState): string[] {
  if (!state) return []
  const rest = coverFirstRefs(state)
  return state.sheetImage ? [state.sheetImage, ...rest] : rest
}

export function emptyState(id: string, label: string): CharacterState {
  return {
    id, label, descriptor: '', refImages: [], coverIndex: 0,
    panels: [], sheetImage: null, status: 'draft', stressResult: null,
    updatedAt: '',
  }
}
