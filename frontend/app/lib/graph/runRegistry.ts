import { ref } from 'vue'

// Module-singleton run registry, keyed by ComfyUI prompt_id. Replaces
// single-active-run bookkeeping so N concurrent direct-mode runs (e.g. across
// tabs / worker instances) can be tracked and displayed independently.
//
// Plain module state (a Map), NOT Vue-reactive — consumers poll it or read
// the one reactive escape hatch below. This mirrors the module-singleton
// idiom used by useVueNodesEnabled.ts.

export interface RunEntry {
  promptId: string
  tabId: string
  live: boolean
  worker: number // 0 = main instance
  label?: string
  startedAt: number // Date.now() at registration
  status: 'queued' | 'running' | 'done' | 'error'
  canvasId: string | null
}

export interface GenOutputLike { [k: string]: any }

// Mutable per-run accumulators (executed nodes, outputs, credits, progress)
// that concurrent-run event handlers mutate in place. Kept in a SEPARATE map
// from RunEntry so entry-snapshot churn (registerRun/markRunning/finishRun
// all replace the RunEntry object) never touches these stable references.
export interface RunState {
  executedNodeIds: Set<string>
  outputs: GenOutputLike[]
  startCredits: number | null
  nodeProgress: { completed: number; total: number }
  runningNode: string | null
  // The run's OWN node catalog, captured at dispatch. Cost tally at
  // execution_complete prices against THIS (not the active tab's displayed
  // nodes) so a run completing while another canvas is shown still resolves
  // its executed-node ids against its own nodes. Empty for bridge/transient
  // runs → callers fall back to the live getNodes() (single-canvas anyway).
  estimateNodes: any[]
}

const runs = new Map<string, RunEntry>()

/**
 * Synchronous slot reservations: claims an in-flight slot for a worker BEFORE
 * its POST completes, closing a race where two rapid dispatches both read a
 * worker as idle. No tabId (the run hasn't been assigned one yet), so
 * inFlight({tabId}) filtering ignores reservations — only inFlight({worker})
 * and the unfiltered count see them.
 */
const reservations = new Map<number, { worker: number }>()
let nextReservationId = 1

/** RunState for registered prompt_ids (parallels `runs`, keyed the same way). */
const runStates = new Map<string, RunState>()

/**
 * RunState for prompt_ids that never went through registerRun — i.e. bridge-path
 * runs, which never register. Keyed `local_${id ?? '_'}` so unregistered ids
 * (including null/undefined) each still get a stable, distinct bag, preserving
 * single bridge-run semantics (null/undefined share one bag: `local__`).
 */
const transientStates = new Map<string, RunState>()

/** Reactive escape hatch: tracks registry size, updated on every mutation. Drives the "N running" pill without making the Map itself reactive. */
export const inFlightCount = ref(0)

function syncCount() {
  inFlightCount.value = runs.size + reservations.size
}

function freshRunState(): RunState {
  return {
    executedNodeIds: new Set<string>(),
    outputs: [],
    startCredits: null,
    nodeProgress: { completed: 0, total: 0 },
    runningNode: null,
    estimateNodes: [],
  }
}

/**
 * Claims an in-flight slot for `worker` synchronously, before the dispatch
 * POST that will eventually registerRun() a real entry. Returns a
 * reservationId to pass to registerRun (on success) or releaseReservation
 * (on dispatch failure).
 */
export function reserve(worker: number): number {
  const id = nextReservationId++
  reservations.set(id, { worker })
  syncCount()
  return id
}

/** Drops a reservation without it ever becoming a real run (dispatch failed). No-op for unknown ids. */
export function releaseReservation(id: number): void {
  if (reservations.delete(id)) {
    syncCount()
  }
}

export function registerRun(
  e: Omit<RunEntry, 'status' | 'startedAt' | 'canvasId'> & { canvasId?: string | null },
  reservationId?: number,
): RunEntry {
  const entry: RunEntry = { ...e, status: 'queued', startedAt: Date.now(), canvasId: e.canvasId ?? null }
  runs.set(entry.promptId, entry)
  runStates.set(entry.promptId, freshRunState())
  if (reservationId !== undefined) {
    reservations.delete(reservationId)
  }
  syncCount()
  return entry
}

/**
 * Returns the mutable RunState for a prompt_id: the registered state if the
 * id is registered, otherwise a transient bag (created on first access) keyed
 * `local_${id ?? '_'}`. The returned reference is STABLE across calls for the
 * same id — callers mutate it in place and later calls see the same object.
 */
export function perRun(promptId: string | null | undefined): RunState {
  if (promptId != null) {
    const registered = runStates.get(promptId)
    if (registered) return registered
  }
  const key = `local_${promptId ?? '_'}`
  let state = transientStates.get(key)
  if (!state) {
    state = freshRunState()
    transientStates.set(key, state)
  }
  return state
}

/** Tears down the RunState for a prompt_id (registered or transient). No-op for unknown ids. */
export function dropRunState(promptId: string | null | undefined): void {
  if (promptId != null) {
    runStates.delete(promptId)
  }
  const key = `local_${promptId ?? '_'}`
  transientStates.delete(key)
}

export function markRunning(promptId: string): RunEntry | null {
  const existing = runs.get(promptId)
  if (!existing) return null
  const updated: RunEntry = { ...existing, status: 'running' }
  runs.set(promptId, updated)
  return updated
}

/** Removes the entry and returns it (with the given terminal status), or null if unknown. */
export function finishRun(promptId: string, status: 'done' | 'error'): RunEntry | null {
  const existing = runs.get(promptId)
  if (!existing) return null
  const finished: RunEntry = { ...existing, status }
  runs.delete(promptId)
  dropRunState(promptId)
  syncCount()
  return finished
}

export function getRun(promptId: string): RunEntry | null {
  return runs.get(promptId) ?? null
}

/**
 * Synthesizes a RunEntry-shaped stand-in for a reservation so it can flow
 * through the same filter/count path as real runs. Reservations have no
 * tabId (`''`, deliberately unequal to any real tabId filter), which is how
 * inFlight({tabId}) ends up ignoring them.
 */
function reservationAsEntry(worker: number): RunEntry {
  return { promptId: '', tabId: '', live: false, worker, startedAt: 0, status: 'queued', canvasId: null }
}

export function inFlight(filter?: { tabId?: string; worker?: number }): RunEntry[] {
  const all = [...runs.values(), ...Array.from(reservations.values(), (r) => reservationAsEntry(r.worker))]
  if (!filter) return all
  return all.filter((e) => {
    if (filter.tabId !== undefined && e.tabId !== filter.tabId) return false
    if (filter.worker !== undefined && e.worker !== filter.worker) return false
    return true
  })
}

/** Test hook + tab-close cleanup: clears the registry. */
export function clearAllRuns(): void {
  runs.clear()
  runStates.clear()
  transientStates.clear()
  reservations.clear()
  syncCount()
}
