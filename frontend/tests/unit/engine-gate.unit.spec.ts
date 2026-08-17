/**
 * Stage 5 Task 5: tenant ownership gating for the shared ComfyUI engine's
 * read/control endpoints — the pure filters plus the two thin h3 handlers,
 * driven with a stubbed engine.
 *
 * Security-review additions:
 *   M2 targeted interrupt (TOCTOU), M3 handler return shape,
 *   M4 prototype-safe history filter, M5 allowlisted queue filter,
 *   M6 promptId path encoding, I3/I4 harvest ordering + per-run engine,
 *   I5 harvest amplification.
 * C2 (annotated /view) lives in view-route-gate.unit.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let owns = new Set<string>()
const pendingRuns = vi.fn(async (_u: string, _l?: number) => [] as any[])
vi.mock('../../server/utils/graphRuns', async (orig) => {
  const actual = await orig() as any
  return {
    ...actual,
    ownsPrompt: async (_u: string, id: string) => owns.has(id),
    ownedPromptIds: async () => owns,
    pendingRuns: (...a: any[]) => pendingRuns(...(a as [string])),
  }
})

const settleGraphSuccess = vi.fn(async () => {})
vi.mock('../../server/utils/meterGraphRun', () => ({ settleGraphSuccess: (...a: any[]) => settleGraphSuccess(...(a as [])) }))

const {
  filterQueuePayload, filterHistoryPayload, annotatedFilepath, viewGateDecision,
  handleHostedInterrupt, harvestPendingOutputs, __resetHarvestMemoForTests,
} = await import('../../server/utils/engineGate')

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

beforeEach(() => {
  owns = new Set()
  fetchMock.mockReset()
  settleGraphSuccess.mockClear()
  pendingRuns.mockClear()
  pendingRuns.mockResolvedValue([])
  __resetHarvestMemoForTests?.()
})
afterEach(() => { vi.useRealTimers() })

// ComfyUI queue entries are tuples: [number, prompt_id, prompt, extra_data, outputs_to_execute]
const q = (id: string) => [1, id, {}, {}, []]

describe('filterQueuePayload', () => {
  it('keeps only owned entries in running and pending', () => {
    const out = filterQueuePayload(
      { queue_running: [q('mine')], queue_pending: [q('mine2'), q('theirs')] },
      new Set(['mine', 'mine2']))
    expect(out.queue_running.map((e: any) => e[1])).toEqual(['mine'])
    expect(out.queue_pending.map((e: any) => e[1])).toEqual(['mine2'])
  })
  it('tolerates missing arrays', () => {
    expect(filterQueuePayload({}, new Set())).toEqual({ queue_running: [], queue_pending: [] })
  })
  // M5: the old `{ ...queue, ... }` spread forwarded every other top-level key
  // ComfyUI puts (or later adds) on the payload, unfiltered, to every tenant.
  it('returns ONLY the two filtered keys — no passthrough of sibling fields', () => {
    const out = filterQueuePayload({ queue_running: [], queue_pending: [], other_tenant_stats: { x: 1 }, whatever: 'leak' }, new Set())
    expect(Object.keys(out).sort()).toEqual(['queue_pending', 'queue_running'])
  })
})

describe('filterHistoryPayload', () => {
  it('drops entries the user does not own', () => {
    const out = filterHistoryPayload({ a: { x: 1 }, b: { x: 2 } }, new Set(['b']))
    expect(Object.keys(out)).toEqual(['b'])
  })
  // M4: prompt ids are attacker-influenced strings used as object keys. On a
  // `{}` literal, `out['__proto__'] = entry` walks the setter and mutates the
  // Object prototype instead of adding a key.
  it('is prototype-safe against hostile keys', () => {
    const hist = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"c":1},"prototype":{"p":1},"mine":{"ok":1}}')
    const out = filterHistoryPayload(hist, new Set(['__proto__', 'constructor', 'prototype', 'mine']))
    expect(Object.keys(out)).toEqual(['mine'])
    expect(Object.getPrototypeOf(out)).toBeNull()
    expect(({} as any).polluted).toBeUndefined()
  })
})

describe('annotatedFilepath — mirrors folder_paths.annotated_filepath', () => {
  it('resolves each annotation and strips the separator', () => {
    expect(annotatedFilepath('a.png [output]')).toEqual({ name: 'a.png', type: 'output' })
    expect(annotatedFilepath('a.png [input]')).toEqual({ name: 'a.png', type: 'input' })
    expect(annotatedFilepath('a.png [temp]')).toEqual({ name: 'a.png', type: 'temp' })
  })
  it('leaves an unannotated name alone', () => {
    expect(annotatedFilepath('a.png')).toEqual({ name: 'a.png', type: null })
    expect(annotatedFilepath('a [output].png')).toEqual({ name: 'a [output].png', type: null })
  })
})

describe('viewGateDecision', () => {
  it('gates the annotated form as output regardless of ?type', () => {
    expect(viewGateDecision({ filename: 'v.png [output]', type: 'temp' })).toEqual({ kind: 'check', key: 'output::v.png' })
    expect(viewGateDecision({ filename: 'v.png [output]', type: 'input', subfolder: 's' })).toEqual({ kind: 'check', key: 'output:s:v.png' })
  })
  it('honours an annotation that points AWAY from output', () => {
    expect(viewGateDecision({ filename: 'v.png [temp]', type: 'output' })).toEqual({ kind: 'ungated' })
  })
  it('defaults a missing type to output', () => {
    expect(viewGateDecision({ filename: 'v.png' })).toEqual({ kind: 'check', key: 'output::v.png' })
  })
  it('rejects blake3 reads', () => {
    expect(viewGateDecision({ filename: 'blake3:abc' })).toMatchObject({ kind: 'reject', status: 400 })
  })
})

describe('handleHostedInterrupt', () => {
  function ev() { return { path: '/interrupt', context: { userId: 'u1' }, node: { req: {}, res: {} } } }
  function engine(runningId: string | null) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/queue')) return { ok: true, json: async () => ({ queue_running: runningId ? [q(runningId)] : [] }) }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  }

  it('refuses when the running job is not the caller\'s', async () => {
    engine('theirs')
    await expect(handleHostedInterrupt(ev() as any)).rejects.toMatchObject({ statusCode: 403 })
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/interrupt'))).toBe(false)
  })

  // M2: between the ownership read and the POST, the victim's job can become
  // the running one. ComfyUI's /interrupt accepts a prompt_id and no-ops when
  // it isn't the job actually executing — pass it and the window closes.
  it('sends the owned prompt_id so the engine only cancels THAT run', async () => {
    owns = new Set(['mine'])
    engine('mine')
    await handleHostedInterrupt(ev() as any)
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/interrupt'))!
    expect(JSON.parse(call[1].body)).toEqual({ prompt_id: 'mine' })
    expect(String(call[1].headers['content-type'])).toMatch(/application\/json/)
  })

  // M3: returning null makes h3 emit an empty body; clients parsing JSON get
  // a syntax error on what is actually a success.
  it('returns a JSON success body, not null', async () => {
    owns = new Set(['mine'])
    engine('mine')
    expect(await handleHostedInterrupt(ev() as any)).toEqual({ ok: true })
  })
})

describe('harvestPendingOutputs', () => {
  function history(ok: boolean) {
    fetchMock.mockImplementation(async (_url: string) => ok
      ? { ok: true, json: async () => ({ p1: { status: { status_str: 'success', completed: true } } }) }
      : { ok: false, json: async () => ({}) })
  }

  it('caps and orders in SQL rather than in memory', async () => {
    await harvestPendingOutputs('u1')
    expect(pendingRuns).toHaveBeenCalledWith('u1', 20)
  })

  // I4: a run dispatched to a pool worker was polled on :8188, where its
  // history does not exist — it could never settle from this path.
  it('polls the engine the run actually ran on', async () => {
    pendingRuns.mockResolvedValue([{ promptId: 'p1', holdId: 1, credits: 2, target: 'http://127.0.0.1:8191' }])
    history(true)
    await harvestPendingOutputs('u1')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/history/p1')
    expect(settleGraphSuccess).toHaveBeenCalledWith('http://127.0.0.1:8191', 'p1', 1, 2)
  })

  it('falls back to the main engine when target is null (pre-migration rows)', async () => {
    pendingRuns.mockResolvedValue([{ promptId: 'p1', holdId: null, credits: 0, target: null }])
    history(true)
    await harvestPendingOutputs('u1')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/history/p1')
  })

  // M6: prompt ids land in a URL path. They're engine-assigned UUIDs today,
  // but the ownership row is keyed on a client-visible string — encode it.
  it('percent-encodes the promptId into the history path', async () => {
    pendingRuns.mockResolvedValue([{ promptId: 'a b/../c', holdId: null, credits: 0, target: null }])
    history(false)
    await harvestPendingOutputs('u1')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/history/a%20b%2F..%2Fc')
  })

  // I5: /view calls this on every ownership miss. A page with 40 broken
  // thumbnails fired 40 harvests, each polling up to 20 history endpoints —
  // 800 engine requests from one page load.
  it('memoizes per user for a few seconds', async () => {
    vi.useFakeTimers()
    await harvestPendingOutputs('u1')
    await harvestPendingOutputs('u1')
    await harvestPendingOutputs('u1')
    expect(pendingRuns).toHaveBeenCalledTimes(1)

    await harvestPendingOutputs('u2')
    expect(pendingRuns).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(3001)
    await harvestPendingOutputs('u1')
    expect(pendingRuns).toHaveBeenCalledTimes(3)
  })
})
