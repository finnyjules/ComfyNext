// frontend/tests/unit/motion-preset-capabilities.unit.spec.ts
/** Presets declare what they need from a CONSUMER; consumers declare what they
 *  support. These tests pin (a) that the declaration is derived from real preset
 *  output rather than hand-maintained, (b) that an undeclared consumer gets the
 *  conservative set, and (c) that gating removes exactly the blur and
 *  copy-based presets and nothing else. */
import { describe, it, expect } from 'vitest'
import {
  PRESET_CAPABILITIES, ALL_PRESET_CAPABILITIES, presetIdsFor,
  SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS,
  evaluateAnimation, type PresetCapability, type UnitState,
} from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID } from '~/data/kinetic-presets'

const BLUR_IN_IDS = ['blur-in', 'blur-slide-up']
const BLUR_OUT_IDS = ['blur-out']
/** The four presets that express themselves through `UnitState.copies`. Named
 *  only to assert the DERIVATION reproduces them — no consumer reads this. */
const COPY_LOOP_IDS = ['inward-echoes', 'grid-scroll-x', 'grid-scroll-y', 'noise-tile']
const SLOTS = ['in', 'out', 'loop'] as const
const IDS: Record<typeof SLOTS[number], string[]> = {
  in: SUPPORTED_IN_IDS, out: SUPPORTED_OUT_IDS, loop: SUPPORTED_LOOP_IDS,
}

describe('preset capability declaration', () => {
  it('every registered preset has a declaration', () => {
    for (const slot of SLOTS)
      for (const id of IDS[slot]) expect(PRESET_CAPABILITIES[id], id).toBeDefined()
  })

  it('the blur presets — and only they — require `blur`', () => {
    const needBlur = Object.entries(PRESET_CAPABILITIES)
      .filter(([, caps]) => caps.includes('blur')).map(([id]) => id).sort()
    expect(needBlur).toEqual([...BLUR_IN_IDS, ...BLUR_OUT_IDS].sort())
  })

  it('the copy-based presets — and only they — require `copies`', () => {
    const needCopies = Object.entries(PRESET_CAPABILITIES)
      .filter(([, caps]) => caps.includes('copies')).map(([id]) => id).sort()
    expect(needCopies).toEqual([...COPY_LOOP_IDS].sort())
  })

  it('presets that emit no optional field require nothing', () => {
    for (const id of ['fade-in', 'slide-up', 'mask-up', 'card-flip-h', 'wave', 'fade-out'])
      expect(PRESET_CAPABILITIES[id], id).toEqual([])
  })

  it('no preset emits `axes` yet — the capability exists for Vector Type', () => {
    expect(Object.values(PRESET_CAPABILITIES).some(c => c.includes('axes'))).toBe(false)
    expect(ALL_PRESET_CAPABILITIES).toEqual(['blur', 'axes', 'copies'])
  })
})

// ── Drift guard ─────────────────────────────────────────────────────────────
// The declaration is derived internally with DEFAULT params over a fixed sample
// grid. This re-derives it through the PUBLIC engine, at param extremes, and
// asserts the two agree — so a preset that only emits blur at, say, its max
// "amount" would fail here rather than ship an un-gated tile.

function paramCombos(id: string): Array<Record<string, number> | undefined> {
  const schema = KINETIC_PRESETS_BY_ID[id]?.params ?? []
  if (!schema.length) return [undefined]
  const at = (pick: (p: { min: number; max: number }) => number) =>
    Object.fromEntries(schema.map(p => [p.key, pick(p)]))
  return [undefined, at(p => p.min), at(p => p.max), at(p => (p.min + p.max) / 2)]
}

function emittedCapabilities(slot: typeof SLOTS[number], id: string): PresetCapability[] {
  const found = new Set<PresetCapability>()
  const record = (u: UnitState) => {
    if (typeof u.blur === 'number' && u.blur !== 0) found.add('blur')
    if (u.axes && Object.keys(u.axes).length > 0) found.add('axes')
    if (Array.isArray(u.copies) && u.copies.length > 0) found.add('copies')
  }
  for (const params of paramCombos(id)) {
    const spec = { presetId: id, duration: slot === 'loop' ? 1.5 : 1, stagger: 0, params }
    // Windows chosen so the slot's own branch is the one evaluated (see
    // evaluateAnimation: out is anchored to the window end; loop needs no in/out).
    const anim = slot === 'in' ? { offset: 0, duration: 3, in: spec }
      : slot === 'out' ? { offset: 0, duration: 2, out: spec }
        : { offset: 0, duration: 3, loop: spec }
    const span = slot === 'out' ? [1, 2] : slot === 'loop' ? [0, 1.5] : [0, 1]
    for (let k = 0; k <= 60; k++) {
      const t = span[0]! + ((span[1]! - span[0]!) * k) / 60 * 0.999
      const st = evaluateAnimation(anim, t, { fps: 30, duration: 3 }, 3)
      for (const u of st.units ?? []) record(u)
    }
  }
  return ALL_PRESET_CAPABILITIES.filter(c => found.has(c))
}

describe('declared capabilities match real engine output', () => {
  for (const slot of SLOTS) {
    it(`${slot} presets`, () => {
      for (const id of IDS[slot])
        expect(emittedCapabilities(slot, id), id).toEqual([...PRESET_CAPABILITIES[id]!])
    })
  }

  it('the sweep is not vacuous — it does observe blur and copies', () => {
    expect(emittedCapabilities('in', 'blur-in')).toEqual(['blur'])
    expect(emittedCapabilities('out', 'blur-out')).toEqual(['blur'])
    expect(emittedCapabilities('loop', 'inward-echoes')).toEqual(['copies'])
  })
})

// ── Consumer gating ─────────────────────────────────────────────────────────

describe('presetIdsFor', () => {
  it('defaults to the CONSERVATIVE set, not to everything', () => {
    for (const slot of SLOTS) {
      expect(presetIdsFor(slot)).toEqual(presetIdsFor(slot, []))
      expect(presetIdsFor(slot).length).toBeLessThanOrEqual(IDS[slot].length)
    }
    // The regression in one line: an undeclared consumer must not be offered blur.
    expect(presetIdsFor('in')).not.toContain('blur-in')
    expect(presetIdsFor('in')).not.toContain('blur-slide-up')
    expect(presetIdsFor('out')).not.toContain('blur-out')
  })

  it('drops EXACTLY the blur and copy-based presets and nothing else', () => {
    const dropped = (slot: typeof SLOTS[number]) =>
      IDS[slot].filter(id => !presetIdsFor(slot).includes(id))
    expect(dropped('in')).toEqual(BLUR_IN_IDS)
    expect(dropped('out')).toEqual(BLUR_OUT_IDS)
    expect(dropped('loop')).toEqual(COPY_LOOP_IDS)
    expect([...dropped('in'), ...dropped('out'), ...dropped('loop')]).toHaveLength(7)
  })

  it('a fully-capable consumer keeps the whole catalog — order included', () => {
    for (const slot of SLOTS)
      expect(presetIdsFor(slot, ALL_PRESET_CAPABILITIES)).toEqual(IDS[slot])
  })

  it('partial capability gates only what it lacks', () => {
    expect(presetIdsFor('in', ['blur'])).toEqual(SUPPORTED_IN_IDS)
    expect(presetIdsFor('in', ['axes'])).toEqual(presetIdsFor('in'))
    // The Compositor's own split: a non-text layer paints copies, a text one
    // does not, and that is now one declaration rather than a private set.
    expect(presetIdsFor('loop', ['copies'])).toEqual(SUPPORTED_LOOP_IDS)
    expect(presetIdsFor('loop', [])).toEqual(SUPPORTED_LOOP_IDS.filter(id => !COPY_LOOP_IDS.includes(id)))
  })
})
