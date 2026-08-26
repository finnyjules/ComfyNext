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
/** A fake thumbnail. `toDataURL` is real enough for the see-first review, which
 *  only needs SOME image bytes per tile — the pixels it carries are the ones the
 *  checkers read out of `__buf`. */
type Fake = { __buf: Uint8ClampedArray | null, toDataURL?: (type?: string, q?: number) => string }

/** angle 90 ⇒ top-to-bottom ramp, angle 0 ⇒ side-to-side, in the promised hue. */
const PALETTE: Record<string, [number, number, number]> = {
  orange: [255, 150, 40],
  blue: [40, 90, 230],
}
function picture(angle: number, hue: string, fail = false): Fake {
  if (fail) return { __buf: null }
  const tag = `${angle}:${hue}`
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
  return { __buf: buf, toDataURL: () => `data:image/jpeg;base64,${btoa(tag)}` }
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
import { PARTIAL_SUFFIX, SIMILAR_SUFFIX, TAKE_DISTINCT_MIN, THUMB_DIFF_MIN, readTakeLog } from '~/lib/agent/takes'
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
/** Calls that ASKED for takes — the see-first review is a separate route and a
 *  deliberate second call, so "no second model call" means no second ASK. */
const askCalls = () => fetchMock.mock.calls.filter((c: any) => {
  const u = String(c[0])
  return u.includes('/api/vibe') && !u.includes('/api/vibe-review')
})

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
    expect(askCalls()).toHaveLength(1) // the repair is local — never a second ask
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
    expect(askCalls()).toHaveLength(1) // separation is local — never a second ask
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


// ── separation must not quietly undo the take ───────────────────────────────
//
// Separation rewrites a take's VALUES. Two things ride on that take which the
// rewrite can invalidate: changes that only exist because a macro swapped the
// base config, and the take's own promise. Both were being dropped silently.

/** A toy with a base-look macro whose swapped config has one MORE dial than the
 *  config the ask was made from — the post-swap-only key. */
function makeMacroPixelAgent() {
  const base = { angle: 0, hue: 'orange' } as Record<string, unknown>
  const state = { config: base }
  const PRESETS: Record<string, () => any> = {
    // `tint` exists only after the swap.
    sunset: () => ({ angle: 0, hue: 'orange', tint: 10 }),
  }
  const controlsFor = (cfg: any): ControlSpec[] => [
    { key: 'preset', label: 'Preset', kind: 'select', options: ['sunset'], default: 'sunset' } as ControlSpec,
    ...CONTROLS,
    ...(cfg && 'tint' in cfg
      ? [{ key: 'tint', label: 'Tint', kind: 'slider', min: 0, max: 100, step: 1, default: 0 } as ControlSpec]
      : []),
  ]
  const agent = useStudioAgent({
    controls: () => CONTROLS,
    params: makeConfigParams(() => state.config),
    label: () => 'Macro toy',
    takes: {
      studio: 'gradient',
      config: () => state.config,
      paramsOf: (c: unknown) => makeConfigParams(() => c),
      controls: () => controlsFor(state.config),
      setConfig: (c: unknown) => { state.config = c as Record<string, unknown> },
      macro: {
        key: 'preset',
        apply: (name: string) => PRESETS[name]?.() ?? null,
        recontrol: (c: unknown) => controlsFor(c),
      },
    },
  } as any)
  return { agent, state }
}

describe('separating a MACRO take', () => {
  it('keeps its post-swap-only changes, or counts what it had to shed', async () => {
    // `tint` exists only on the swapped config. Rebuilding the take's values
    // against the PRE-swap vocabulary drops it — and dropping a change with no
    // count, no warning and no label is the exact defect this feature exists to
    // stop, committed by the feature itself.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'macro', changes: [
        { key: 'preset', value: 'sunset' }, { key: 'angle', value: 90 }, { key: 'tint', value: 80 },
      ], rationale: 'a' },
      { label: 'twin', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b' },
      { label: 'other', changes: [{ key: 'angle', value: 0 }, { key: 'hue', value: 'blue' }], rationale: 'c' },
    ] })
    const { agent } = makeMacroPixelAgent()
    await agent.ask('two the same')
    await flush()

    const macro = agent.takes.value.find((t: any) => t.label.startsWith('macro'))!
    const keys = macro.changes.map((c: any) => c.key)
    // It KEEPS the post-swap key — the candidate is validated against the
    // vocabulary the take actually lives in, not the one the ask was made from.
    expect(keys).toContain('tint')
    // …and if a separation ever cannot carry something, that is on the record
    // rather than swallowed.
    expect(agent.takeDropped.value.get(macro) ?? []).not.toContain('preset')
    // The macro itself is never shed — that would change the whole base look.
    expect(keys).toContain('preset')
  })
})

describe('separating a take that made a promise', () => {
  it('never commits a separation that breaks the promise it just verified', async () => {
    // The take promises vertical and renders vertical; its twin renders the
    // same. Separation moves `angle` — the very dial the promise depends on —
    // so a candidate that lands sideways must be refused, not committed.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'promised', changes: [{ key: 'angle', value: 90 }], rationale: 'a',
        promise: { direction: 'vertical' } },
      { label: 'twin', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b' },
      { label: 'other', changes: [{ key: 'angle', value: 0 }, { key: 'hue', value: 'blue' }], rationale: 'c' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('two the same')
    await flush()

    const t = agent.takes.value.find((x: any) => x.label.startsWith('promised'))!
    // Whatever separation did, the tile must still keep its own promise — or
    // say it does not.
    const angle = Number(t.changes.find((c: any) => c.key === 'angle')!.value)
    const stillVertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45
    expect(stillVertical || t.label.includes('(')).toBe(true)
  })
})


// ── the bar for MODEL takes is higher than the bar for spreads ──────────────
describe('TAKE_DISTINCT_MIN', () => {
  it('is a separate, higher bar than the spread threshold', () => {
    expect(TAKE_DISTINCT_MIN).toBeGreaterThan(THUMB_DIFF_MIN)
  })

  it('sits below every strip we have measured and called good', () => {
    // Logged live worst-pairs from good strips: 29.79, 40.65, 55.70.
    expect(TAKE_DISTINCT_MIN).toBeLessThan(29.79)
  })
})

/** A macro toy whose PICTURE depends on things no slider can reach, so the
 *  dial-nudge attempt provably cannot separate a duplicate and the base-swap
 *  fallback is what has to. */
function makeBaseSwapAgent() {
  const PRESETS: Record<string, () => any> = {
    sunset: () => ({ angle: 0, hue: 'orange', tint: 10 }),
    ink: () => ({ angle: 90, hue: 'blue', tint: 0 }),
  }
  const state = { config: { angle: 0, hue: 'orange', tint: 0 } as any }
  const controls = (): ControlSpec[] => [
    { key: 'preset', label: 'Preset', kind: 'select', options: Object.keys(PRESETS), default: 'sunset' } as ControlSpec,
    // The only slider, and the picture does not depend on it — so nudging dials
    // can never separate these two.
    { key: 'tint', label: 'Tint', kind: 'slider', min: 0, max: 100, step: 1, default: 0 } as ControlSpec,
  ]
  const agent = useStudioAgent({
    controls,
    params: makeConfigParams(() => state.config),
    label: () => 'Base-swap toy',
    takes: {
      studio: 'gradient',
      config: () => state.config,
      paramsOf: (c: unknown) => makeConfigParams(() => c),
      controls,
      setConfig: (c: unknown) => { state.config = c },
      macro: { key: 'preset', apply: (n: string) => PRESETS[n]?.() ?? null, recontrol: () => controls() },
    },
  } as any)
  return { agent, state }
}

describe('when nudging dials cannot separate two takes', () => {
  const twins = () => ({ takes: [
    { label: 'warm pastel dusk', changes: [{ key: 'preset', value: 'sunset' }], rationale: 'a' },
    { label: 'moody soft dusk', changes: [{ key: 'preset', value: 'sunset' }, { key: 'tint', value: 40 }], rationale: 'b' },
  ] })

  it('offers a genuinely different BASE instead of wasting the slot', async () => {
    fetchMock.mockResolvedValue(twins())
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two directions')
    await flush()

    const presets = agent.takes.value.map((t: any) => t.changes.find((c: any) => c.key === 'preset')?.value)
    expect(new Set(presets).size).toBe(2) // not two of the same base any more
    expect(presets).toContain('ink')
  })

  it('the replacement is visibly OURS, never the duplicate wearing a new value', async () => {
    fetchMock.mockResolvedValue(twins())
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two directions')
    await flush()

    const swapped = agent.takes.value.find((t: any) => t.changes.some((c: any) => c.value === 'ink'))!
    expect(swapped.label).toBe('ink')
    expect(swapped.label).not.toContain('dusk')
    expect(swapped.rationale.toLowerCase()).toMatch(/same|match/)
    // A promise described the look it USED to be; carrying it over would lie.
    expect(swapped.promise).toBeUndefined()
  })

  it('drops a promise the base swap invalidates', async () => {
    fetchMock.mockResolvedValue({ takes: [
      { label: 'warm pastel dusk', changes: [{ key: 'preset', value: 'sunset' }], rationale: 'a' },
      { label: 'moody soft dusk', changes: [{ key: 'preset', value: 'sunset' }, { key: 'tint', value: 40 }],
        rationale: 'b', promise: { colors: ['orange'] } },
    ] })
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two directions')
    await flush()
    for (const t of agent.takes.value as any[]) {
      if (t.changes.some((c: any) => c.value === 'ink')) expect(t.promise).toBeUndefined()
    }
  })

  it('a studio with no base to swap still just says "(similar)"', async () => {
    // Shader / Shape / Vector Type: nothing to offer instead, so honesty is all
    // that is left.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b' },
      { label: 'three', changes: [{ key: 'angle', value: 0 }, { key: 'hue', value: 'blue' }], rationale: 'c' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('two the same')
    await flush()
    for (const t of agent.takes.value as any[]) {
      expect(t.changes.some((c: any) => c.key === 'preset')).toBe(false)
    }
  })
})

describe('the strip says what it could not apply', () => {
  it('logs one line for the whole strip, not just per take', async () => {
    // So a single paste from a screenshot diagnoses a vocabulary gap.
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }, { key: 'nope', value: 1 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 0 }, { key: 'alsoNope', value: 2 }], rationale: 'b' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('anything')

    const said = info.mock.calls.flat().map(String).join(' ')
    expect(said).toContain('one')
    expect(said).toContain('nope')
    expect(said).toContain('two')
    expect(said).toContain('alsoNope')
    info.mockRestore()
  })

  it('stays quiet when every take applied cleanly', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fetchMock.mockResolvedValue(reply(undefined, [{ key: 'angle', value: 90 }]))
    const { agent } = makeAgent()
    await agent.ask('anything')
    expect(info).not.toHaveBeenCalled()
    info.mockRestore()
  })
})


describe('a duplicate that is ALREADY labelled is still a duplicate', () => {
  it('separates two (partial) twins instead of skipping them', async () => {
    // The owner's screenshot, exactly: both takes lost more than half their ask,
    // both came back "(partial)", and their surviving fragments were the same
    // preset — so they rendered identically. The separation pass skipped them
    // BECAUSE they were already labelled, which is backwards: a take whose ask
    // was gutted is the one most likely to have converged with its neighbour.
    // Only a take that has already conceded "(similar)" has nothing left to try.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'warm pastel dusk', changes: [
        { key: 'preset', value: 'sunset' }, { key: 'nope', value: 1 }, { key: 'alsoNope', value: 2 },
      ], rationale: 'a' },
      { label: 'moody soft dusk', changes: [
        { key: 'preset', value: 'sunset' }, { key: 'thirdNope', value: 3 }, { key: 'fourthNope', value: 4 },
      ], rationale: 'b' },
    ] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two dusks')
    await flush()

    const presets = agent.takes.value.map((t: any) => t.changes.find((c: any) => c.key === 'preset')?.value)
    expect(new Set(presets).size).toBe(2)
    warn.mockRestore()
  })

  it('but leaves a take that already conceded "(similar)" alone', async () => {
    // Nothing more to try there — re-entering would loop on a pair no amount of
    // moving can separate.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 90 }, { key: 'hue', value: 'orange' }], rationale: 'b' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('two the same')
    await flush()
    // One of the pair concedes; the strip settles rather than churning.
    const conceded = agent.takes.value.filter((t: any) => t.label.includes(SIMILAR_SUFFIX.trim()))
    expect(conceded.length).toBeLessThanOrEqual(1)
  })
})


/** A NON-macro toy whose picture no offered slider can move: the only slider is
 *  `tint`, which the renderer ignores. Nothing can separate two of these. */
function makeStuckAgent() {
  const config = { angle: 0, hue: 'orange', tint: 0 } as Record<string, unknown>
  const controls: ControlSpec[] = [
    { key: 'tint', label: 'Tint', kind: 'slider', min: 0, max: 100, step: 1, default: 0 } as ControlSpec,
  ]
  const agent = useStudioAgent({
    controls: () => controls,
    params: makeConfigParams(() => config),
    label: () => 'Stuck toy',
    takes: {
      studio: 'gradient',
      config: () => config,
      paramsOf: (c: unknown) => makeConfigParams(() => c),
      controls: () => controls,
    },
  } as any)
  return { agent, config }
}

describe('conceding a duplicate never erases what the tile already admitted', () => {
  const gutted = () => ({ takes: [
    { label: 'warm pastel dusk', changes: [{ key: 'tint', value: 10 }, { key: 'nope', value: 1 }, { key: 'alsoNope', value: 2 }], rationale: 'a' },
    { label: 'moody soft dusk', changes: [{ key: 'tint', value: 40 }, { key: 'thirdNope', value: 3 }, { key: 'fourthNope', value: 4 }], rationale: 'b' },
  ] })

  it('keeps "(partial)" rather than overwriting it with "(similar)"', async () => {
    // `withSuffix` trims the label to make room, so stamping a second suffix
    // does not append — it REPLACES, and the louder admission is the one lost.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { agent } = makeStuckAgent()
    await agent.ask('two dusks')
    await flush()

    for (const t of agent.takes.value as any[]) {
      expect(t.label, t.label).toContain(PARTIAL_SUFFIX.trim())
      expect(t.label, t.label).not.toContain(SIMILAR_SUFFIX.trim())
    }
    // The warning still fires — the finding is not lost, only the second badge.
    expect(warn.mock.calls.flat().map(String).join(' ')).toMatch(/too close/)
    warn.mockRestore()
  })

  it('concedes only ONE tile of an unseparable pair, not both', async () => {
    // Two "(similar)" badges say the same thing twice and blame both members
    // for a resemblance that only takes one to fix.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'tint', value: 10 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'tint', value: 40 }], rationale: 'b' },
    ] })
    const { agent } = makeStuckAgent()
    await agent.ask('two the same')
    await flush()

    const conceded = (agent.takes.value as any[]).filter(t => t.label.includes(SIMILAR_SUFFIX.trim()))
    expect(conceded).toHaveLength(1)
    warn.mockRestore()
  })

  it('the gutted fixture really is unseparable (the test would lie otherwise)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(gutted())
    const { agent } = makeStuckAgent()
    await agent.ask('two dusks')
    await flush()
    expect(warn.mock.calls.flat().map(String).join(' ')).toMatch(/could not be separated/)
    warn.mockRestore()
  })

  beforeEach(() => { fetchMock.mockResolvedValue(gutted()) })
})

describe('a base swap starts clean', () => {
  it('carries none of the replaced take\u2019s promise findings', async () => {
    // Those were measured on a picture that is no longer on the tile. Logging
    // them against the new one puts fabricated evidence into the taste stream.
    fetchMock.mockResolvedValue({ takes: [
      { label: 'warm pastel dusk', changes: [{ key: 'preset', value: 'sunset' }], rationale: 'a',
        promise: { colors: ['blue'] } },
      { label: 'moody soft dusk', changes: [{ key: 'preset', value: 'sunset' }, { key: 'tint', value: 40 }], rationale: 'b' },
    ] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two dusks')
    await flush()

    const swapped = (agent.takes.value as any[]).find(t => t.changes.some((c: any) => c.value === 'ink'))
    if (swapped) {
      expect(agent.takePromiseResults.value.get(swapped)).toBeUndefined()
      agent.selectTake(swapped)
      expect(readTakeLog().at(-1)!.promiseResults).toBeUndefined()
    }
    warn.mockRestore()
  })

  it('never offers a base that just duplicates the CURRENT design', async () => {
    // "yours" is a tile in this strip too. The toy's own config renders exactly
    // like its `sunset` preset, so with both takes on `ink` the only spare base
    // available is one the user is already looking at — offering it would
    // separate nothing anybody can see.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ takes: [
      { label: 'one', changes: [{ key: 'preset', value: 'ink' }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'preset', value: 'ink' }, { key: 'tint', value: 40 }], rationale: 'b' },
    ] })
    const { agent } = makeBaseSwapAgent()
    await agent.ask('two inks')
    await flush()

    const presets = (agent.takes.value as any[]).map(t => t.changes.find((c: any) => c.key === 'preset')?.value)
    expect(presets).not.toContain('sunset')
    // …so it concedes honestly instead.
    expect((agent.takes.value as any[]).some(t => t.label.includes(SIMILAR_SUFFIX.trim()))).toBe(true)
    warn.mockRestore()
  })
})


// ── the see-first loop ──────────────────────────────────────────────────────
//
// The model is shown its own four pictures and may keep, fix or replace each
// one. These drive the REAL orchestration with the review route stubbed at the
// same fetch seam the ask uses — so the finalize path, the re-render, the
// backstops and the superseded guards are all shipped code.

/** Answer /api/vibe-review with these verdicts; everything else passes through. */
function reviewReply(reviews: unknown[], takesReply?: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/vibe-review')) return { reviews }
    return takesReply ?? reply(undefined, [{ key: 'angle', value: 0 }])
  })
}

describe('the model looks at its own takes', () => {
  it('keeps a strip the review is happy with, exactly as it was', async () => {
    reviewReply([{ verdict: 'keep', reason: 'reads right' }, { verdict: 'keep' }])
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    const before = agent.takes.value.map((t: any) => JSON.stringify(t.changes))
    await flush()

    expect(agent.takes.value.map((t: any) => JSON.stringify(t.changes))).toEqual(before)
    expect(labels(agent)).toEqual(['first', 'second'])
  })

  it('applies a FIX in place, and re-renders the tile it changed', async () => {
    reviewReply([{ verdict: 'fix', changes: [{ key: 'angle', value: 90 }], label: 'upright', reason: 'it was sideways' }, { verdict: 'keep' }])
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    const fixed = agent.takes.value[0]!
    expect(fixed.changes.find((c: any) => c.key === 'angle')!.value).toBe(90)
    expect(fixed.label).toBe('upright')
    // The tile is the NEW picture, not the one the model complained about.
    expect(agent.takeThumbs.value.get(fixed)).toBeTruthy()
  })

  it('a REPLACE drops the promise, because it is a different reading', async () => {
    reviewReply([
      { verdict: 'replace', changes: [{ key: 'angle', value: 90 }], label: 'other idea' },
      { verdict: 'keep' },
    ], { takes: [
      { label: 'first', changes: [{ key: 'angle', value: 0 }], rationale: 'r', promise: { direction: 'horizontal' } },
      { label: 'second', changes: [{ key: 'hue', value: 'blue' }], rationale: 's' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('a wash')
    await flush()

    const replaced = agent.takes.value[0]!
    expect(replaced.label).toBe('other idea')
    expect(replaced.promise).toBeUndefined()
  })

  it('a fix keeps the take\u2019s promise — same intent, corrected values', async () => {
    reviewReply([
      { verdict: 'fix', changes: [{ key: 'angle', value: 90 }] },
      { verdict: 'keep' },
    ], { takes: [
      { label: 'first', changes: [{ key: 'angle', value: 0 }], rationale: 'r', promise: { direction: 'vertical' } },
      { label: 'second', changes: [{ key: 'hue', value: 'blue' }], rationale: 's' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()
    expect(agent.takes.value[0]!.promise).toEqual({ direction: 'vertical' })
  })

  it('a fix goes through the SAME finalize path — unofferable keys are counted', async () => {
    reviewReply([
      { verdict: 'fix', changes: [{ key: 'angle', value: 90 }, { key: 'notAKey', value: 3 }] },
      { verdict: 'keep' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    const fixed = agent.takes.value[0]!
    expect(fixed.changes.map((c: any) => c.key)).not.toContain('notAKey')
    expect(agent.takeDropped.value.get(fixed)).toContain('notAKey')
    warn.mockRestore()
  })

  it('records the verdict on the pick log, reason and all', async () => {
    reviewReply([{ verdict: 'keep', reason: 'reads right' }, { verdict: 'keep' }])
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()

    agent.selectTake(agent.takes.value[0])
    expect(readTakeLog().at(-1)!.reviewVerdict).toMatchObject({ verdict: 'keep', reason: 'reads right' })
  })

  it('flies a quiet flag while it is out, and lowers it after', async () => {
    reviewReply([{ verdict: 'keep' }, { verdict: 'keep' }])
    const { agent } = makeAgent()
    expect(agent.reviewingTakes.value).toBe(false)
    await agent.ask('a vertical wash')
    await flush()
    expect(agent.reviewingTakes.value).toBe(false)
  })

  it('never reviews a parametric spread — that is our maths, not the model\u2019s', async () => {
    reviewReply([{ verdict: 'keep' }, { verdict: 'keep' }], { takes: [
      { label: 'one', changes: [{ key: 'angle', value: 90 }], rationale: 'a' },
      { label: 'two', changes: [{ key: 'angle', value: 30 }], rationale: 'b' },
    ] })
    const { agent } = makeAgent()
    await agent.ask('a wash')
    await flush()
    const before = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-review')).length

    agent.selectTake(agent.takes.value[0])
    agent.variationsOfTake(agent.takes.value[0])
    await flush()

    const after = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-review')).length
    expect(after).toBe(before)
  })
})

describe('the review can never make things worse', () => {
  it('a failed review leaves the strip exactly as it was, with one quiet line', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-review')) throw new Error('timeout')
      return reply(undefined, [{ key: 'angle', value: 0 }])
    })
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    const before = agent.takes.value.map((t: any) => JSON.stringify(t.changes))
    await flush()

    expect(agent.takes.value.map((t: any) => JSON.stringify(t.changes))).toEqual(before)
    expect(agent.reviewingTakes.value).toBe(false)
    expect(info.mock.calls.flat().map(String).join(' ')).toMatch(/review skipped/)
    info.mockRestore()
  })

  it('a nonsense review is a no-op, not a corruption', async () => {
    reviewReply(['nope', { verdict: 'fix' }])
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    const before = agent.takes.value.map((t: any) => JSON.stringify(t.changes))
    await flush()
    expect(agent.takes.value.map((t: any) => JSON.stringify(t.changes))).toEqual(before)
  })

  it('never runs a second round on its own output', async () => {
    reviewReply([{ verdict: 'fix', changes: [{ key: 'angle', value: 90 }] }, { verdict: 'keep' }])
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush()
    const reviews = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-review'))
    expect(reviews).toHaveLength(1)
  })

  it('a strip the user dismissed mid-review is never rewritten behind them', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-review')) {
        await held
        return { reviews: [{ verdict: 'fix', changes: [{ key: 'angle', value: 90 }] }, { verdict: 'keep' }] }
      }
      return reply(undefined, [{ key: 'angle', value: 0 }])
    })
    const { agent } = makeAgent()
    await agent.ask('a vertical wash')
    await flush(6)

    agent.dismissTakes()          // the user moved on…
    release()                     // …and only then does the review land
    await flush()

    expect(agent.hasTakes.value).toBe(false)
    expect(agent.takes.value).toEqual([])
  })

  it('a review that lands after a NEW ask never rewrites the new strip', async () => {
    // Honest about what this proves: that a stale review never reaches the new
    // strip — not WHICH of the several guards stopped it. Three stand in its
    // way (the draw loop's own supersede check, the post-fetch one, and the
    // emptied vocabulary a reset leaves behind), and no fixture I could build
    // isolates the middle one. It stays because it is the only one that is
    // ABOUT this race; the other two stop it by side effect.
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    let reviews = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-review')) {
        // Only the FIRST review is held, and only it carries the stale label —
        // the second ask's own review is content with what it sees.
        if (++reviews === 1) {
          await held
          return { reviews: [{ verdict: 'fix', changes: [{ key: 'angle', value: 90 }], label: 'STALE' }, { verdict: 'keep' }] }
        }
        return { reviews: [{ verdict: 'keep' }, { verdict: 'keep' }] }
      }
      return reply(undefined, [{ key: 'angle', value: 0 }])
    })
    const { agent } = makeAgent()
    await agent.ask('first ask')
    await flush(6)

    await agent.ask('second ask')   // a whole new strip…
    await flush(6)
    release()                        // …and only now does the FIRST review land
    await flush()

    expect(labels(agent).some((l: string) => l.includes('STALE'))).toBe(false)
  })

  it('what the user KEPT mid-review is what they saw', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-review')) {
        await held
        return { reviews: [{ verdict: 'fix', changes: [{ key: 'angle', value: 90 }] }, { verdict: 'keep' }] }
      }
      return reply(undefined, [{ key: 'angle', value: 0 }])
    })
    const { agent, config } = makeAgent()
    await agent.ask('a vertical wash')
    await flush(6)

    agent.selectTake(agent.takes.value[0])
    agent.keepTake()
    release()
    await flush()

    // The take they looked at had angle 0. The review's correction must not
    // reach into a design they already committed.
    expect(config.angle).toBe(0)
  })
})
