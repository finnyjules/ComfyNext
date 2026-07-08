import { describe, it, expect, beforeEach } from 'vitest'
import { resolveEventTab } from '../../app/lib/graph/resolveEventTab'
import { registerRun, clearAllRuns } from '../../app/lib/graph/runRegistry'

describe('resolveEventTab', () => {
  beforeEach(() => clearAllRuns())

  it('registry hit → returns the entry tabId (wins over the active fallback)', () => {
    registerRun({ promptId: 'p1', tabId: 'tab-A', live: false, worker: 0 })
    expect(resolveEventTab('p1', 'tab-active')).toBe('tab-A')
  })

  it('registry miss → falls back to the active project tab', () => {
    registerRun({ promptId: 'p1', tabId: 'tab-A', live: false, worker: 0 })
    expect(resolveEventTab('p-unknown', 'tab-active')).toBe('tab-active')
  })

  it('null prompt_id → falls back to the active project tab', () => {
    expect(resolveEventTab(null, 'tab-active')).toBe('tab-active')
  })

  it('undefined prompt_id → falls back to the active project tab', () => {
    expect(resolveEventTab(undefined, 'tab-active')).toBe('tab-active')
  })

  it('miss with a null fallback → returns null (today’s behavior)', () => {
    expect(resolveEventTab('p-unknown', null)).toBe(null)
  })

  it('does not confuse a different tab’s run for this prompt', () => {
    registerRun({ promptId: 'p1', tabId: 'tab-A', live: false, worker: 0 })
    registerRun({ promptId: 'p2', tabId: 'tab-B', live: false, worker: 1 })
    expect(resolveEventTab('p2', 'tab-active')).toBe('tab-B')
  })
})
