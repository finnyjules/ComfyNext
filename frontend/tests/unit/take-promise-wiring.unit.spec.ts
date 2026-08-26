// Take promises — the wiring half: check the real thumbnail, repair once, then
// be honest about what is left.
//
// Node env (ofetch resolves only through the node loader here, same reason as
// `studio-agent-takes`), with two stubs and nothing else faked:
//
//  • the thumbnail registry, replaced by a renderer that turns a config into an
//    actual RGBA picture — so "the take renders sideways" is a real sideways
//    picture, not a flag;
//  • `document.createElement('canvas')`, a pass-through that lets the REAL
//    `thumbSignature` → `checkPromise` pipeline run over those pictures.
//
// So the schema, the checkers, the repair decision and the labelling are all
// shipped code; only the rasteriser is fake.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))
;(globalThis as any).$fetch = (...args: unknown[]) => fetchMock(...args)
;(globalThis as any).useLocalSettings = () => ({ getLocalSetting: () => 'test-key' })

const SIZE = 32
type Fake = { __buf: Uint8ClampedArray | null }

/** angle 90 ⇒ top-to-bottom ramp, angle 0 ⇒ side-to-side, in the promised hue. */
const PALETTE: Record<string, [number, number, number]> = {
  orange: [255, 150, 40],
  blue: [40, 90, 230],
}
function picture(angle: number, hue: string, fail = false): Fake {
  if (fail) return { __buf: null }
  const [r, g, b] = PALETTE[hue] ?? PALETTE.orange!
  const buf = new Uint8ClampedArray(SIZE * SIZE * 4)
  const vertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = (vertical ? y : x) / (SIZE - 1)
      const i = (y * SIZE + x) * 4
      buf[i] = r * (1 - t) + 20 * t
      buf[i + 1] = g * (1 - t) + 10 * t
      buf[i + 2] = b * (1 - t) + 30 * t
      buf[i + 3] = 255
    }
  }
  return { __buf: buf }
}

let renderFails = false
vi.mock('~/lib/agent/takeThumbs', () => ({
  takeThumbFor: () => async (config: any) => {
    const f = picture(Number(config.angle), String(config.hue), renderFails)
    return f.__buf ? f : null
  },
}))

import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { PARTIAL_SUFFIX, SIMILAR_SUFFIX, readTakeLog } from '~/lib/agent/takes'
import type { ControlSpec } from '~/lib/spacetype/effect'

let drawn: Fake | null = null
;(globalThis as any).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (src: Fake) => { drawn = src },
      getImageData: () => ({ data: drawn?.__buf ?? new Uint8ClampedArray(SIZE * SIZE * 4) }),
    }),
  }),
}
const store = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } },
}
afterAll(() => { delete (globalThis as any).window; delete (globalThis as any).document })

const CONTROLS: ControlSpec[] = [
  { key: 'angle', label: 'Angle', kind: 'slider', min: 0, max: 360, step: 1, default: 0 },
  { key: 'hue', label: 'Hue', kind: 'select', options: ['orange', 'blue'], default: 'orange' },
]

/** `repairable: false` models Shader / Shape / Vector Type: no offered key that
 *  aims the picture, so a direction miss can only be labelled. */
function makeAgent(opts: { repairable?: boolean } = {}) {
  const config = { angle: 0, hue: 'orange' } as Record<string, unknown>
  const params = makeConfigParams(() => config)
  const agent = useStudioAgent({
    controls: () => CONTROLS,
    params,
    label: () => 'Toy studio',
    takes: {
      studio: 'gradient',
      config: () => config,
      paramsOf: (c: unknown) => makeConfigParams(() => c),
      ...(opts.repairable === false ? {} : {
        repair: {
          directionPatch: (dir: string) =>
            dir === 'vertical' ? { angle: 90 } : dir === 'horizontal' ? { angle: 0 } : {},
        },
      }),
    },
  } as any)
  return { agent, config }
}

const flush = async (n = 24) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

/** What the fake renderer will DRAW for a take — the picture, not the config. */
function pictureKey(t: { changes: { key: string, value: unknown }[] }): string {
  const get = (k: string, d: unknown) => t.changes.find(c => c.key === k)?.value ?? d
  const angle = Number(get('angle', 0))
  const vertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45
  return `${vertical ? 'v' : 'h'}:${String(get('hue', 'orange'))}`
}
const labels = (agent: any) => agent.takes.value.map((t: any) => t.label)

/** Two takes so the strip opens; only the first carries a promise. */
function reply(promise: unknown, changes: { key: string, value: unknown }[] = [{ key: 'angle', value: 0 }]) {
  return { takes: [
    { label: 'first', changes, rationale: 'r', promise },
    { label: 'second', changes: [{ key: 'hue', value: 'blue' }], rationale: 's' },
  ] }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fetchMock.mockReset()
  store.clear()
  drawn = null
  renderFails = false
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
// Restore, not just clear: re-spying an already-spied method hands back the SAME
// mock, so calls from an earlier test would leak into the next one's assertions.
afterEach(() => { warn.mockRestore() })

describe('a promise the picture keeps', () => {
  it('leaves the tile alone and says nothing', async () => {
    fetchMock.mockResolvedValue(reply({ colors: ['orange'], direction: 'vertical' }, [{ key: 'angle', value: 90 }]))
    const { agent } = makeAgent()
    await agent.ask('warm and dreamy')
    await flush()

    expect(labels(agent)).toEqual(['first', 'second'])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('promised')
  })

  it('records every claim it checked on the pick log', async () => {
    fetchMock.mockResolvedValue(reply({ colors: ['orange'], direction: 'vertical' }, [{ key: 'angle', value: 90 }]))
    const { agent } = makeAgent()
    await agent.ask('warm and dreamy')
    await flush()

    agent.selectTake(agent.takes.value[0])
    const ev = readTakeLog().at(-1)!
    expect(ev.promiseResults).toBeTruthy()
    expect(ev.promiseResults!.map(r => r.claim).sort()).toEqual(['colors', 'direction'])
    for (const r of ev.promiseResults!) expect(r.ok).toBe(true)
  })
})

describe('a direction the picture broke', () => {
  it('is repaired once, locally, and the tile stays unlabelled', async () => {
    // The take says vertical and sets the angle that renders sideways — the
    // sideways-sunset shape, caught with no diagnosis.
    fetchMock.mockResolvedValue(reply({ direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    const t = agent.takes.value[0]!
    expect(t.changes.find(c => c.key === 'angle')!.value).toBe(90) // repaired
    expect(t.label).toBe('first')
    expect(fetchMock.mock.calls).toHaveLength(1) // never a second model call
  })

  it('the repair is applied to the studio when the take is previewed', async () => {
    fetchMock.mockResolvedValue(reply({ direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const { agent, config } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    agent.previewTake(agent.takes.value[0])
    expect(config.angle).toBe(90)
    agent.previewTake(null)
    expect(config.angle).toBe(0)
  })

  it('is only LABELLED when the studio offers nothing to aim with', async () => {
    fetchMock.mockResolvedValue(reply({ direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const { agent } = makeAgent({ repairable: false })
    await agent.ask('a vertical wash')
    await flush()

    const t = agent.takes.value[0]!
    expect(t.label).toBe('first (differs)')
    expect(t.changes.find(c => c.key === 'angle')!.value).toBe(0) // untouched
    const said = warn.mock.calls.flat().join(' ')
    expect(said).toContain('first')
    expect(said).toContain('direction')
    expect(said).toContain('horizontal') // what was actually measured
  })

  it('reverts a repair that did not actually fix it, rather than keeping a guess', async () => {
    // The patch is offered but aims at something the checker still calls
    // horizontal, so the take must come back exactly as the model sent it.
    fetchMock.mockResolvedValue(reply({ direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const config = { angle: 0, hue: 'orange' } as Record<string, unknown>
    const agent = useStudioAgent({
      controls: () => CONTROLS,
      params: makeConfigParams(() => config),
      label: () => 'Toy studio',
      takes: {
        studio: 'gradient',
        config: () => config,
        paramsOf: (c: unknown) => makeConfigParams(() => c),
        repair: { directionPatch: () => ({ angle: 10 }) }, // still sideways
      },
    } as any)
    await agent.ask('a vertical wash')
    await flush()

    const t = agent.takes.value[0]!
    expect(t.changes.find(c => c.key === 'angle')!.value).toBe(0) // fully reverted
    expect(t.label).toBe('first (differs)')
  })

  it('never writes a key the studio does not offer', async () => {
    fetchMock.mockResolvedValue(reply({ direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const config = { angle: 0, hue: 'orange' } as Record<string, unknown>
    const agent = useStudioAgent({
      controls: () => CONTROLS,
      params: makeConfigParams(() => config),
      label: () => 'Toy studio',
      takes: {
        studio: 'gradient',
        config: () => config,
        paramsOf: (c: unknown) => makeConfigParams(() => c),
        // One real key, one this studio has never heard of.
        repair: { directionPatch: () => ({ angle: 90, 'not.a.key': 5 }) },
      },
    } as any)
    await agent.ask('a vertical wash')
    await flush()

    const keys = agent.takes.value[0]!.changes.map(c => c.key)
    expect(keys).toContain('angle')
    expect(keys).not.toContain('not.a.key')
  })
})

describe('a colour the picture broke', () => {
  it('is labelled, never repaired — picking a colour would be inventing one', async () => {
    fetchMock.mockResolvedValue(reply({ colors: ['blue'] }, [{ key: 'angle', value: 90 }]))
    const { agent } = makeAgent()
    await agent.ask('make it blue')
    await flush()

    const t = agent.takes.value[0]!
    expect(t.label).toBe('first (differs)')
    // Nothing was added or changed to chase the claim.
    expect(t.changes).toEqual([{ key: 'angle', value: 90 }])
    expect(warn.mock.calls.flat().join(' ')).toContain('colors')
  })

  it('logs the failing result with what was measured', async () => {
    fetchMock.mockResolvedValue(reply({ colors: ['blue'] }, [{ key: 'angle', value: 90 }]))
    const { agent } = makeAgent()
    await agent.ask('make it blue')
    await flush()
    agent.selectTake(agent.takes.value[0])

    const res = readTakeLog().at(-1)!.promiseResults!
    const colours = res.find(r => r.claim === 'colors')!
    expect(colours.ok).toBe(false)
    expect(colours.measured).toContain('orange')
  })
})

describe('honesty composes to ONE suffix', () => {
  it('(partial) wins over (differs) — it already says the stronger thing', async () => {
    fetchMock.mockResolvedValue({ takes: [
      // Two of three changes are unusable ⇒ partial; and the colour claim is a
      // lie ⇒ would otherwise also be differs.
      { label: 'first', changes: [
        { key: 'angle', value: 90 }, { key: 'nope', value: 1 }, { key: 'alsoNope', value: 2 },
      ], rationale: 'r', promise: { colors: ['blue'] } },
      { label: 'second', changes: [{ key: 'hue', value: 'blue' }], rationale: 's' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('make it blue')
    await flush()

    const label = agent.takes.value[0]!.label
    expect(label).toContain(PARTIAL_SUFFIX.trim())
    expect(label).not.toContain('(differs)')
  })
})

describe('no evidence is never a miss', () => {
  it('a render that failed skips the checks and leaves the tile unlabelled', async () => {
    renderFails = true
    fetchMock.mockResolvedValue(reply({ colors: ['blue'], direction: 'vertical' }, [{ key: 'angle', value: 0 }]))
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    expect(labels(agent)).toEqual(['first', 'second'])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('promised')
  })

  it('a take with no promise is never checked or labelled', async () => {
    fetchMock.mockResolvedValue(reply(undefined, [{ key: 'angle', value: 0 }]))
    const { agent } = makeAgent()
    await agent.ask('anything')
    await flush()

    expect(labels(agent)).toEqual(['first', 'second'])
    agent.selectTake(agent.takes.value[0])
    expect(readTakeLog().at(-1)!.promiseResults).toBeUndefined()
  })
})


// ── model takes that render as the same picture ─────────────────────────────
//
// Live evidence (owner report #6): three of four tiles came back near-identical.
// Reproduced on the real renderer — two takes with DIFFERENT change lists
// measured 0.00 apart, and nothing said a word: the pairwise pass only ever ran
// over parametric spreads, never over what the model itself proposed.
describe('four takes that are not four pictures', () => {
  /** Two takes whose different changes land on the same rendered picture. */
  function twins() {
    return { takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      // A different change list, an identical render (the hue it names is the
      // one already there).
      { label: 'two', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b' },
      { label: 'three', changes: [{ key: 'angle', value: 0 }, { key: 'hue', value: 'blue' }], rationale: 'c' },
    ] }
  }

  it('a near-duplicate is separated, or else says so', async () => {
    fetchMock.mockResolvedValue(twins())
    const { agent } = makeAgent()
    await agent.ask('four ways')
    await flush()

    // The invariant, not a slot: no two tiles may render the same picture
    // unless one of them says so. WHICH member of the pair gets moved is the
    // code's business, not the test's.
    const plain = agent.takes.value.filter((t: any) => !t.label.includes(SIMILAR_SUFFIX.trim()))
    const pictures = plain.map((t: any) => pictureKey(t))
    expect(new Set(pictures).size).toBe(pictures.length)
    expect(fetchMock.mock.calls).toHaveLength(1) // never a second model call
  })

  it('leaves four genuinely different takes completely alone', async () => {
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 0 }], rationale: 'b' },
      { label: 'three', changes: [{ key: 'hue', value: 'blue' }], rationale: 'c' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('four ways')
    const before = agent.takes.value.map((t: any) => JSON.stringify(t.changes))
    await flush()

    expect(labels(agent)).toEqual(['one', 'two', 'three'])
    expect(agent.takes.value.map((t: any) => JSON.stringify(t.changes))).toEqual(before)
  })

  it('a broken promise outranks a duplicate — one suffix, and it is the louder one', async () => {
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b',
        promise: { colors: ['blue'] } },
      { label: 'three', changes: [{ key: 'angle', value: 0 }, { key: 'hue', value: 'blue' }], rationale: 'c' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('four ways')
    await flush()

    const label = agent.takes.value[1]!.label
    expect(label).toContain('(differs)')
    expect(label).not.toContain(SIMILAR_SUFFIX.trim())
  })
})
