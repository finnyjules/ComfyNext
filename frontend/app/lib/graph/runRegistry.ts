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
}

const runs = new Map<string, RunEntry>()

/** Reactive escape hatch: tracks registry size, updated on every mutation. Drives the "N running" pill without making the Map itself reactive. */
export const inFlightCount = ref(0)

function syncCount() {
  inFlightCount.value = runs.size
}

export function registerRun(e: Omit<RunEntry, 'status' | 'startedAt'>): RunEntry {
  const entry: RunEntry = { ...e, status: 'queued', startedAt: Date.now() }
  runs.set(entry.promptId, entry)
  syncCount()
  return entry
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
  syncCount()
  return finished
}

export function getRun(promptId: string): RunEntry | null {
  return runs.get(promptId) ?? null
}

export function inFlight(filter?: { tabId?: string; worker?: number }): RunEntry[] {
  const all = Array.from(runs.values())
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
  syncCount()
}
