// Four Takes (Task 4) — the composable seam. These specs drive `useStudioAgent`
// itself, with `/api/vibe` stubbed, because that composable is the ONE
// choke-point all four vibe studios (Gradient, Shader, Shape, Vector Type) get
// the strip through — a bug here is a bug in every one of them.
//
// Node env (same reason `takes-spread.unit.spec.ts` gives): `ofetch` is not
// linked into this package, so only the node loader lets `vi.mock` intercept it,
// and the pick log's storage is stubbed explicitly rather than inherited.
//
// Honest about what is NOT proven here: no thumbnail pixel is real (there is no
// `document`, so every adapter resolves `null` through its own catch — which is
// exactly the error-tile path, and is asserted as such), and no pointer is real
// (per the house rule, synthetic events prove nothing about hover). Task 5's
// live pass owns both.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))
// `useVibeControl` reaches for Nuxt's auto-imported `$fetch` / `useLocalSettings`
// as free identifiers; in a plain vitest module those resolve off globalThis.
;(globalThis as any).$fetch = (...args: unknown[]) => fetchMock(...args)
;(globalThis as any).useLocalSettings = () => ({ getLocalSetting: () => 'test-key' })

import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { readTakeLog, TAKE_LOG_KEY, type StudioTake } from '~/lib/agent/takes'
import type { ControlSpec } from '~/lib/spacetype/effect'

const CONTROLS: ControlSpec[] = [
  { key: 'hue', label: 'Hue', kind: 'slider', min: 0, max: 360, step: 1, default: 0 },
  { key: 'softness', label: 'Softness', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0.5 },
  // Deliberately ABSENT from the starting config — restoring a key the config
  // never had must not leave a fabricated one behind.
  { key: 'grain', label: 'Grain', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0 },
  { key: 'mood', label: 'Mood', kind: 'select', options: ['calm', 'loud'], default: 'calm' },
]

const TAKES = [
  { label: 'warmer', changes: [{ key: 'hue', value: 40 }], rationale: 'pushes amber' },
  { label: 'softer', changes: [{ key: 'softness', value: 0.8 }], rationale: 'softer edges' },
  { label: 'grainy', changes: [{ key: 'grain', value: 0.6 }], rationale: 'adds tooth' },
  // Changes nothing numeric — the "≈ variations" button must grey out for it.
  { label: 'loud', changes: [{ key: 'mood', value: 'loud' }], rationale: 'turns it up' },
]

function startConfig() {
  return { hue: 10, softness: 0.2, mood: 'calm' } as Record<string, unknown>
}

function makeAgent(over: Record<string, unknown> = {}) {
  const config = startConfig()
  const params = makeConfigParams(() => config)
  const agent = useStudioAgent({
    controls: () => CONTROLS,
    params,
    label: () => 'Test studio',
    takes: { studio: 'gradient', config: () => config, paramsOf: (c: unknown) => makeConfigParams(() => c) },
    ...over,
  } as any)
  return { agent, config }
}

/** Let the fire-and-forget thumbnail stream settle. */
const settle = () => new Promise(r => setTimeout(r, 0))

// The pick log's only storage, stubbed the way `takes-spread.unit.spec.ts`
// stubs it — a real Map behind the two methods `logTakeEvent` uses.
const store = new Map<string, string>()
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
}
;(globalThis as any).window = { localStorage }
afterAll(() => { delete (globalThis as any).window })

beforeEach(() => {
  fetchMock.mockReset()
  store.clear()
})

describe('useStudioAgent — asking for takes', () => {
  it('asks /api/vibe for four variants and populates the strip', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()

    await agent.ask('make it dreamier')

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vibe')
    expect((opts as any).body.variants).toBe(4)
    expect((opts as any).body.phrase).toBe('make it dreamier')
    expect(agent.hasTakes.value).toBe(true)
    expect(agent.takes.value.map((t: StudioTake) => t.label)).toEqual(['warmer', 'softer', 'grainy', 'loud'])
    // Multi-take REPLACES the single proposal UI.
    expect(agent.hasProposal.value).toBe(false)
    expect(agent.selectedTake.value).toBeNull()
  })

  it('shows the strip before any thumbnail exists, then streams them in', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()

    await agent.ask('dreamier')
    // The strip is up with nothing drawn yet: every tile is PENDING (no map
    // entry), which is what lets TakeStrip tell "still drawing" from "failed".
    expect(agent.takes.value).toHaveLength(4)
    expect(agent.takeThumbs.value.size).toBe(0)

    await settle()
    // happy-dom has no WebGL, so each adapter resolves null through its own
    // catch — the entry EXISTS (resolved), and its value is the error tile.
    expect(agent.takeThumbs.value.size).toBe(4)
    for (const t of agent.takes.value) {
      expect(agent.takeThumbs.value.has(t)).toBe(true)
      expect(agent.takeThumbs.value.get(t)).toBeNull()
    }
  })

  it('validates and clamps every take through the existing validatePatch path', async () => {
    fetchMock.mockResolvedValue({
      takes: [
        { label: 'over', changes: [{ key: 'hue', value: 9999 }, { key: 'nope', value: 1 }], rationale: '' },
        { label: 'bad enum', changes: [{ key: 'mood', value: 'purple' }, { key: 'softness', value: 0.83 }], rationale: '' },
      ],
    })
    const { agent } = makeAgent()
    await agent.ask('go wild')

    expect(agent.takes.value[0]!.changes).toEqual([{ key: 'hue', value: 360 }])
    expect(agent.takes.value[1]!.changes).toEqual([{ key: 'softness', value: 0.8 }])
  })
})

describe('useStudioAgent — hover preview is non-destructive', () => {
  it('applies a take on hover and restores a byte-identical config on unhover', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.previewTake(agent.takes.value[0])
    expect(config.hue).toBe(40)
    agent.previewTake(null)
    expect(JSON.stringify(config)).toBe(before)

    // …and a take touching a key the config never had must not leave one behind.
    agent.previewTake(agent.takes.value[2])
    expect(config.grain).toBe(0.6)
    agent.previewTake(null)
    expect(JSON.stringify(config)).toBe(before)
    expect(config.grain).toBeUndefined()
  })

  it('captures the original ONCE — hovering three takes in a row still restores it', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    for (const t of agent.takes.value) agent.previewTake(t)
    agent.previewTake(null)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('unhovering falls back to the SELECTED take, not the original', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')

    agent.selectTake(agent.takes.value[1])
    expect(config.softness).toBe(0.8)
    agent.previewTake(agent.takes.value[0])
    expect(config.hue).toBe(40)
    agent.previewTake(null)
    expect(config.softness).toBe(0.8)
    expect(config.hue).toBe(10)
  })

  it('dismiss restores byte-identically and closes the strip', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.selectTake(agent.takes.value[0])
    agent.dismissTakes()
    expect(JSON.stringify(config)).toBe(before)
    expect(agent.hasTakes.value).toBe(false)
    expect(agent.selectedTake.value).toBeNull()
  })

  it('clicking "yours" reselects the original without closing the strip', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.selectTake(agent.takes.value[0])
    agent.selectTake(null)
    expect(JSON.stringify(config)).toBe(before)
    expect(agent.hasTakes.value).toBe(true)
    expect(agent.selectedTake.value).toBeNull()
  })
})

describe('useStudioAgent — keep commits through the existing path', () => {
  it('writes the take through the same writer accept used, then commits', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')

    agent.selectTake(agent.takes.value[0])
    agent.keepTake()

    expect(config.hue).toBe(40)
    expect(agent.hasTakes.value).toBe(false)
    // Committed exactly as `keep()` always did: the proposal is gone AND the
    // undo record is cleared, so a later revert() cannot resurrect the old value.
    expect(agent.hasProposal.value).toBe(false)
    agent.revert()
    expect(config.hue).toBe(40)
  })

  it('routes through recompute() + keep(), not a private writer', async () => {
    // Source pin (house convention): the point of "the existing apply path" is
    // that undo/autosave integration follows from it, which a behavioural
    // assertion alone cannot distinguish from an identical private write.
    const fs = await import('node:fs')
    const src = fs.readFileSync(`${process.cwd()}/app/composables/useStudioAgent.ts`, 'utf8')
    const body = src.slice(src.indexOf('function keepTake'))
    expect(body).toMatch(/recompute\(\)/)
    expect(body).toMatch(/\bkeep\(\)/)
  })

  it('keeping a take that changes nothing new is a no-op, not a crash', async () => {
    fetchMock.mockResolvedValue({ takes: [
      { label: 'same', changes: [{ key: 'hue', value: 10 }], rationale: '' },
      { label: 'other', changes: [{ key: 'hue', value: 20 }], rationale: '' },
    ] })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    agent.selectTake(agent.takes.value[0])
    agent.keepTake()
    expect(config.hue).toBe(10)
    expect(agent.hasTakes.value).toBe(false)
  })
})

describe('useStudioAgent — the two buttons', () => {
  it('≈ variations spreads locally around the pick — no second model call', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    const callsAfterAsk = fetchMock.mock.calls.length

    agent.selectTake(agent.takes.value[0])
    expect(agent.canVaryTake.value).toBe(true)
    agent.variationsOfTake(agent.takes.value[0])

    expect(fetchMock.mock.calls.length).toBe(callsAfterAsk)
    expect(agent.takes.value).toHaveLength(4)
    expect(agent.takes.value.map((t: StudioTake) => t.label)).not.toContain('warmer')
    expect(agent.selectedTake.value).toBeNull()
  })

  it('greys ≈ variations when the pick moved nothing numeric', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()
    await agent.ask('dreamier')

    agent.selectTake(agent.takes.value[3]) // the enum-only take
    expect(agent.canVaryTake.value).toBe(false)
    const list = agent.takes.value
    agent.variationsOfTake(agent.takes.value[3])
    expect(agent.takes.value).toBe(list) // refused, rather than spreading unrelated sliders
  })

  it('spreading clears the selection AND the preview it was showing', async () => {
    // Without this the strip would say "nothing selected" while the studio still
    // showed the take that was selected a moment ago.
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.selectTake(agent.takes.value[0])
    agent.variationsOfTake(agent.takes.value[0])

    expect(agent.selectedTake.value).toBeNull()
    expect(JSON.stringify(config)).toBe(before)
  })

  it('a spread neighbour still restores byte-identically', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.selectTake(agent.takes.value[0])
    agent.variationsOfTake(agent.takes.value[0])
    agent.previewTake(agent.takes.value[0])
    agent.previewTake(null)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('↻ different directions refetches with variants and a different phrase', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    const first = (fetchMock.mock.calls[0]![1] as any).body.phrase

    await agent.moreDirections()

    expect(fetchMock.mock.calls).toHaveLength(2)
    const second = (fetchMock.mock.calls[1]![1] as any).body
    expect(second.variants).toBe(4)
    expect(second.phrase).not.toBe(first)
    expect(second.phrase).toContain('dreamier')
  })

  it('↻ restores the original before refetching, so the next capture is honest', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent, config } = makeAgent()
    await agent.ask('dreamier')
    const before = JSON.stringify(config)

    agent.selectTake(agent.takes.value[0])
    await agent.moreDirections()
    agent.previewTake(null)
    expect(JSON.stringify(config)).toBe(before)
  })
})

describe('useStudioAgent — the pick log', () => {
  it('appends keep, dismiss and switch events', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()
    await agent.ask('dreamier')

    agent.selectTake(agent.takes.value[0])
    agent.selectTake(agent.takes.value[1])
    agent.dismissTakes()

    await agent.ask('dreamier')
    agent.selectTake(agent.takes.value[2])
    agent.keepTake()

    const log = readTakeLog()
    expect(log.map(e => e.action)).toEqual(['switch', 'switch', 'dismiss', 'switch', 'keep'])
    expect(log.map(e => e.takeLabel)).toEqual(['warmer', 'softer', 'softer', 'grainy', 'grainy'])
    expect(new Set(log.map(e => e.studio))).toEqual(new Set(['gradient']))
    expect(new Set(log.map(e => e.prompt))).toEqual(new Set(['dreamier']))
    expect(localStorage.getItem(TAKE_LOG_KEY)).toBeTruthy()
  })

  it('logs the yours-click as a switch back to the original', async () => {
    fetchMock.mockResolvedValue({ takes: TAKES })
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    agent.selectTake(agent.takes.value[0])
    agent.selectTake(null)
    expect(readTakeLog().at(-1)).toMatchObject({ action: 'switch', takeLabel: 'yours', changes: [] })
  })
})

describe('useStudioAgent — degrading to today’s single tune', () => {
  it('falls back when an older server answers in the single-patch shape', async () => {
    fetchMock.mockResolvedValue({ changes: [{ key: 'hue', value: 40 }], rationale: 'warmer' })
    const { agent, config } = makeAgent()

    await agent.ask('warmer')

    expect(agent.hasTakes.value).toBe(false)
    expect(agent.hasProposal.value).toBe(true)
    expect(agent.changes.value[0]!.after).toBe('40')
    expect(config.hue).toBe(40)
    // The response was already usable — no second call was paid for.
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('retries once without variants when the server rejects them (400)', async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('Bad Request'), { statusCode: 400 }))
      .mockResolvedValueOnce({ changes: [{ key: 'hue', value: 40 }], rationale: 'warmer' })
    const { agent, config } = makeAgent()

    await agent.ask('warmer')

    expect(fetchMock.mock.calls).toHaveLength(2)
    expect((fetchMock.mock.calls[1]![1] as any).body.variants).toBeUndefined()
    expect(agent.hasProposal.value).toBe(true)
    expect(config.hue).toBe(40)
    expect(agent.error.value).toBe('')
  })

  it('does not retry — or strip — on a real failure', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('Overloaded'), { statusCode: 529 }))
    const { agent } = makeAgent()

    await agent.ask('warmer')

    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(agent.error.value).toContain('Overloaded')
    expect(agent.hasTakes.value).toBe(false)
  })

  it('degrades to a single proposal when only one take survives validation', async () => {
    fetchMock.mockResolvedValue({ takes: [
      { label: 'only', changes: [{ key: 'hue', value: 40 }], rationale: 'warmer' },
      { label: 'junk', changes: [{ key: 'nope', value: 1 }], rationale: 'nothing usable' },
    ] })
    const { agent, config } = makeAgent()

    await agent.ask('warmer')

    expect(agent.hasTakes.value).toBe(false)
    expect(agent.hasProposal.value).toBe(true)
    expect(config.hue).toBe(40)
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('a studio that opted out of takes never sends variants', async () => {
    fetchMock.mockResolvedValue({ changes: [{ key: 'hue', value: 40 }], rationale: 'warmer' })
    const { agent } = makeAgent({ takes: undefined })

    await agent.ask('warmer')

    expect((fetchMock.mock.calls[0]![1] as any).body.variants).toBeUndefined()
    expect(agent.hasProposal.value).toBe(true)
    expect(agent.hasTakes.value).toBe(false)
  })
})
