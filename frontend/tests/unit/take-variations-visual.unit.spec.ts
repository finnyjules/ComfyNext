// Render-aware "≈ variations": the four tiles have to look different, not just
// hold different numbers.
//
// Node env (ofetch only resolves through the node loader here, same reason as
// `studio-agent-takes.unit.spec.ts`), with two deliberate stubs:
//
//  • the thumbnail registry, replaced by a fake renderer that maps a config to a
//    "picture" — so a test can say "these two configs render identically" and
//    mean it, without a GPU;
//  • `document.createElement('canvas')`, replaced by a pass-through that lets
//    the REAL `thumbSignature`/`pixelDistance` run over those fake pictures.
//
// So the spread, the comparison and the re-spread decision are all the shipped
// code; only the rasteriser is fake. Fully deterministic — no timing, no random.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))
;(globalThis as any).$fetch = (...args: unknown[]) => fetchMock(...args)
;(globalThis as any).useLocalSettings = () => ({ getLocalSetting: () => 'test-key' })

/** A fake "picture": one byte, so identical bytes = identical picture. */
type Fake = { __shade: number }
/** How the current test turns a config into a picture. */
let shadeOf: (softness: number) => number = () => 0

/** When the current test wants a render to FAIL rather than differ. */
let failFor: (softness: number) => boolean = () => false

vi.mock('~/lib/agent/takeThumbs', () => ({
  takeThumbFor: () => async (config: any) => {
    const s = Number(config.softness)
    return failFor(s) ? null : ({ __shade: shadeOf(s) } as Fake)
  },
}))

import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { SUBTLE_SUFFIX, THUMB_DIFF_MIN, THUMB_DIFF_SIZE, readTakeLog, type StudioTake } from '~/lib/agent/takes'
import type { ControlSpec } from '~/lib/spacetype/effect'

// ── the fake rasteriser ─────────────────────────────────────────────────────
// `thumbSignature` makes its own canvas and draws the thumb into it; this makes
// that round-trip return the fake's own shade, so the real comparison maths runs.
let drawn: Fake | null = null
;(globalThis as any).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (src: Fake) => { drawn = src },
      getImageData: () => {
        const px = THUMB_DIFF_SIZE * THUMB_DIFF_SIZE
        return { data: new Uint8ClampedArray(px * 4).fill(drawn?.__shade ?? 0) }
      },
    }),
  }),
}
const store = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } },
}
afterAll(() => { delete (globalThis as any).window; delete (globalThis as any).document })

const CONTROLS: ControlSpec[] = [
  { key: 'softness', label: 'Softness', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
]
/** One take, sitting mid-range so the spread has room in both directions. */
const TAKES = [
  { label: 'soft', changes: [{ key: 'softness', value: 0.5 }], rationale: '' },
  { label: 'sharp', changes: [{ key: 'softness', value: 0.1 }], rationale: '' },
]

function makeAgent() {
  const config = { softness: 0.2 } as Record<string, unknown>
  const params = makeConfigParams(() => config)
  const agent = useStudioAgent({
    controls: () => CONTROLS,
    params,
    label: () => 'Test studio',
    takes: { studio: 'gradient', config: () => config, paramsOf: (c: unknown) => makeConfigParams(() => c) },
  } as any)
  return { agent, config }
}

/** Drain the fire-and-forget thumbnail pipeline (draw loop, then the tighten
 *  pass, each of which awaits per tile). */
async function flush(n = 24) {
  for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0))
}

const move = (t: StudioTake) => Math.abs(Number(t.changes.find(c => c.key === 'softness')!.value) - 0.5)

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ takes: TAKES })
  store.clear()
  drawn = null
  shadeOf = () => 0
  failFor = () => false
})

/** The shipped invariant, stated once: no two tiles may be the same picture as
 *  each other, or as the take they spread around, UNLESS the tile says so. */
function assertDistinctOrLabelled(takes: StudioTake[], pickShade: number) {
  const shade = (t: StudioTake) => shadeOf(Number(t.changes.find(c => c.key === 'softness')!.value))
  const plain = takes.filter(t => !t.label.includes(SUBTLE_SUFFIX))
  for (const t of plain) expect(Math.abs(shade(t) - pickShade)).toBeGreaterThanOrEqual(THUMB_DIFF_MIN)
  for (let a = 0; a < plain.length; a++) {
    for (let b = a + 1; b < plain.length; b++) {
      expect(Math.abs(shade(plain[a]!) - shade(plain[b]!))).toBeGreaterThanOrEqual(THUMB_DIFF_MIN)
    }
  }
}

describe('≈ variations — the tiles are checked as PICTURES', () => {
  it('re-spreads a variation that rendered as the same picture as the pick', async () => {
    // Anything within 0.2 of the pick renders identically to it. The first
    // spread's weaker slots land inside that band; the wider re-spread does not.
    shadeOf = s => (Math.abs(s - 0.5) < 0.2 ? 40 : Math.round(60 + s * 180))
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    agent.variationsOfTake(pick)
    const before = agent.takes.value.filter(t => Math.abs(move(t)) < 0.2).length
    expect(before).toBeGreaterThan(0) // the spread really did produce look-alikes
    await flush()

    // …and every tile now renders differently from the take it spreads around.
    for (const t of agent.takes.value) expect(move(t)).toBeGreaterThanOrEqual(0.2)
    expect(agent.takes.value).toHaveLength(4)
    expect(new Set(agent.takes.value.map(t => JSON.stringify(t.changes))).size).toBe(4)
  })

  it('catches tiles that look like EACH OTHER, not just like the pick', async () => {
    // All four sit far from the pick, but they render as only two pictures —
    // exactly the complaint a vs-parent check alone cannot see.
    shadeOf = s => (s === 0.5 ? 10 : s > 0.5 ? 200 : 100)
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    agent.variationsOfTake(pick)
    await flush()

    expect(agent.takes.value).toHaveLength(4)
    assertDistinctOrLabelled(agent.takes.value, 10)
    // Something had to give: with only two pictures available, at least one tile
    // must admit it (rather than four tiles quietly claiming to be alternatives).
    expect(agent.takes.value.some(t => t.label.includes(SUBTLE_SUFFIX))).toBe(true)
  })

  it('says "(subtle)" rather than pretending, when even the wider spread cannot separate them', async () => {
    // Nothing this control can reach changes the picture — the honest outcome
    // is to say so, not to show four tiles claiming to be alternatives.
    shadeOf = s => (Math.abs(s - 0.5) < 0.95 ? 40 : 200)
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    agent.variationsOfTake(pick)
    await flush()

    expect(agent.takes.value).toHaveLength(4)
    for (const t of agent.takes.value) expect(t.label).toContain(SUBTLE_SUFFIX)
  })

  it('a tile whose REDRAW failed is left unlabelled — "can\u2019t tell" is not "(subtle)"', async () => {
    // The first pass drew fine and read as a look-alike, so a re-spread ran; the
    // re-spread's render then failed. A null there means nothing was measured,
    // and stamping "(subtle)" on it would be inventing a finding.
    shadeOf = () => 40                       // every first-pass tile matches the pick
    failFor = s => Math.abs(s - 0.5) > 0.28  // …and every wider re-spread fails to draw
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    agent.variationsOfTake(pick)
    await flush()

    const redrawn = agent.takes.value.filter(t => agent.takeThumbs.value.get(t) === null)
    expect(redrawn.length).toBeGreaterThan(0) // the redraw really did fail
    for (const t of redrawn) expect(t.label).not.toContain(SUBTLE_SUFFIX)
  })

  it('leaves a spread alone when every tile already looks different', async () => {
    shadeOf = s => Math.round(s * 200) // every distinct value is a distinct picture
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    agent.variationsOfTake(pick)
    const first = agent.takes.value.map(t => JSON.stringify(t.changes))
    await flush()

    expect(agent.takes.value.map(t => JSON.stringify(t.changes))).toEqual(first)
    for (const t of agent.takes.value) expect(t.label).not.toContain(SUBTLE_SUFFIX)
  })

  it('never re-spreads a MODEL round — those have nothing to be too close to', async () => {
    shadeOf = () => 40 // every tile renders identically
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    const before = agent.takes.value.map(t => JSON.stringify(t.changes))
    await flush()

    expect(agent.takes.value.map(t => JSON.stringify(t.changes))).toEqual(before)
    for (const t of agent.takes.value) expect(t.label).not.toContain(SUBTLE_SUFFIX)
  })

  it('is deterministic: the same pick spread twice gives the same four tiles', async () => {
    shadeOf = s => (Math.abs(s - 0.5) < 0.2 ? 40 : Math.round(60 + s * 180))
    const runs: string[][] = []
    for (let i = 0; i < 2; i++) {
      const { agent } = makeAgent()
      await agent.ask('dreamier')
      await flush()
      const pick = agent.takes.value[0]!
      agent.selectTake(pick)
      agent.variationsOfTake(pick)
      await flush()
      runs.push(agent.takes.value.map(t => `${t.label}|${JSON.stringify(t.changes)}`))
    }
    expect(runs[0]).toEqual(runs[1])
  })
})

describe('the pick log records how different it LOOKED', () => {
  it('writes a visualDiff score alongside the decision', async () => {
    // "yours" (softness 0.2) renders 40; the picked take (0.5) renders 200.
    shadeOf = s => (Math.abs(s - 0.5) < 0.2 ? 200 : 40)
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()

    agent.selectTake(agent.takes.value[0])
    const ev = readTakeLog().at(-1)!
    expect(ev.action).toBe('switch')
    expect(ev.visualDiff).toBe(160) // |200 − 40|, mean over every channel
  })

  it('also logs the distance the GUARD gates on — vs the take it spread around', async () => {
    // visualDiff answers "how different from what I had"; visualDiffFromPick
    // answers "how different from the thing this is a variation OF", which is
    // the number THUMB_DIFF_MIN is compared against. Only the second can
    // calibrate the constant, so both are recorded.
    shadeOf = s => Math.round(s * 200)
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    await flush()
    const pick = agent.takes.value[0]!
    agent.selectTake(pick)
    // A model round has nothing it was spread around.
    expect(readTakeLog().at(-1)!.visualDiffFromPick).toBeUndefined()

    agent.variationsOfTake(pick)
    await flush()
    agent.selectTake(agent.takes.value[1])
    const ev = readTakeLog().at(-1)!
    const shadeOfTake = (t: StudioTake) => shadeOf(Number(t.changes.find(c => c.key === 'softness')!.value))
    expect(ev.visualDiffFromPick).toBe(Math.abs(shadeOfTake(agent.takes.value[1]!) - shadeOfTake(pick)))
    expect(ev.visualDiff).toBeTypeOf('number')
  })

  it('omits the field rather than logging a fake 0 when it cannot be measured', async () => {
    const { agent } = makeAgent()
    await agent.ask('dreamier')
    // No flush: the thumbnails have not landed, so there is nothing to compare.
    agent.selectTake(agent.takes.value[0])
    expect(readTakeLog().at(-1)!.visualDiff).toBeUndefined()
  })
})
