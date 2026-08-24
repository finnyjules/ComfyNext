import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fillFraction, nudgeValue, parseTyped } from '../../app/lib/studio/row'
import { scrubValue } from '../../app/lib/studio/scrub'

/**
 * SOFT RANGE — a row whose min/max drive the LOOK but not what you may enter.
 *
 * The default row is unchanged and stays unchanged: `min`/`max` are a hard gate on
 * typed AND keyed entry, because for almost every control in the app the declared
 * range IS the parameter's domain (a roughness of 1.4 is not a thing).
 *
 * A handful of controls are different. 3D Studio's Transform rows declare ±20 / ±180° /
 * 0.05–10 as a general-purpose DESCRIPTION of the parameter, and the gizmo routinely
 * drags an object to x = 35. On a hard-range row that reads back as "35.0" and then one
 * ArrowRight rewrites it to 20 — and, through `axisDeltaWrites`, fans the −15 difference
 * across every other selected object. `entry: 'unclamped'` is the opt-in that makes such
 * a row safe: the range still paints the fill, still sizes the drag, still positions the
 * handle; it just stops deciding what a number may be.
 *
 * What does NOT change in either mode: step snapping, and the refusal to return NaN.
 * A soft range is a soft RANGE, not a soft parser.
 */

// ── the default mode is byte-identical ───────────────────────────────────────

/** Every way of saying "don't opt in". A soft-range row is opt-IN, so all three must
 *  produce the same number as the four-argument call the whole app makes today. */
const NOT_OPTED_IN = [
  ['no options argument at all', undefined],
  ['an empty options object', {}],
  ['the mode named explicitly', { entry: 'clamped' as const }],
] as const

describe('parseTyped — the default mode is untouched', () => {
  const CASES: Array<[string, string, number, number, number, number | null]> = [
    ['a plain in-range number', '0.42', 0, 1, 0.01, 0.42],
    ['past the maximum', '35', -20, 20, 0.1, 20],
    ['below the minimum', '-35', -20, 20, 0.1, -20],
    ['snapped onto the step', '0.427', 0, 1, 0.01, 0.43],
    ['units someone pasted out of dev tools', '42px', 0, 100, 1, 42],
    ['not a number at all', 'abc', 0, 1, 0.01, null],
    ['empty', '   ', 0, 1, 0.01, null],
  ]

  for (const [what, input, min, max, step, want] of CASES) {
    for (const [how, opts] of NOT_OPTED_IN) {
      it(`${what}, with ${how}`, () => {
        expect(parseTyped(input, min, max, step, opts as undefined)).toBe(want)
      })
    }
  }
})

describe('nudgeValue — the default mode is untouched', () => {
  it('still pins at an end, and still reports "no move" there', () => {
    const at = { value: 1, min: 0, max: 1, step: 0.1 } as const
    expect(nudgeValue({ ...at, direction: 1 })).toBe(1)
    expect(nudgeValue({ ...at, direction: 1, entry: 'clamped' })).toBe(1)
  })

  it('still rewrites an out-of-range value back inside the range', () => {
    // This IS the reverted Transform bug, kept as the characterization of the mode
    // every other row in the app still uses.
    expect(nudgeValue({ value: 35, min: -20, max: 20, step: 0.1, direction: 1 })).toBe(20)
  })
})

// ── the soft-range mode ──────────────────────────────────────────────────────

describe('parseTyped — entry: unclamped', () => {
  const soft = { entry: 'unclamped' } as const

  it('keeps a value the range does not contain', () => {
    expect(parseTyped('35', -20, 20, 0.1, soft)).toBe(35)
    expect(parseTyped('-35', -20, 20, 0.1, soft)).toBe(-35)
    expect(parseTyped('240', -180, 180, 1, soft)).toBe(240)
  })

  it('still snaps to the step — a soft range is not a soft grid', () => {
    expect(parseTyped('35.04', -20, 20, 0.1, soft)).toBe(35)
    expect(parseTyped('35.06', -20, 20, 0.1, soft)).toBe(35.1)
  })

  it('still refuses to write NaN into the document', () => {
    expect(parseTyped('abc', -20, 20, 0.1, soft)).toBe(null)
    expect(parseTyped('', -20, 20, 0.1, soft)).toBe(null)
    expect(parseTyped('   ', -20, 20, 0.1, soft)).toBe(null)
  })

  it('still strips pasted units', () => {
    expect(parseTyped('35px', -20, 20, 0.1, soft)).toBe(35)
  })
})

describe('nudgeValue — entry: unclamped', () => {
  const soft = { min: -20, max: 20, step: 0.1, entry: 'unclamped' } as const

  it('steps FROM where the value actually is, not from the edge of the range', () => {
    expect(nudgeValue({ ...soft, value: 35, direction: 1 })).toBe(35.1)
    expect(nudgeValue({ ...soft, value: 35, direction: -1 })).toBe(34.9)
  })

  it('coarsens by the same multiplier out of range as in it', () => {
    // span 400 steps, so the ladder's top rung: ten steps = 1.0.
    expect(nudgeValue({ ...soft, value: 35, direction: 1, coarse: true })).toBe(36)
  })

  it('never reports "no move", so the write is never skipped out of range', () => {
    // The caller drops a nudge that returns the current value. On a hard range that is
    // the at-an-end case; out of range on a soft one it would drop every keystroke.
    const next = nudgeValue({ ...soft, value: 35, direction: 1 })
    expect(next).not.toBe(35)
  })

  it('walks back INTO the range without stalling at the boundary', () => {
    // -20.05 + 0.1 = -19.95, which then SNAPS onto the 0.1 grid — the off-grid start
    // does not survive the press, exactly as it does not on a hard-range row.
    expect(nudgeValue({ ...soft, value: -20.05, direction: 1 })).toBe(-19.9)
  })
})

// ── what the soft range deliberately does NOT change ─────────────────────────

describe('the range still governs the LOOK and the drag', () => {
  it('the fill and the handle pin at the edge for an out-of-range value', () => {
    expect(fillFraction(35, -20, 20)).toBe(1)
    expect(fillFraction(-35, -20, 20)).toBe(0)
  })

  it('a drag still maps the track onto [min, max], soft range or not', () => {
    // Grabbing a row that reads 35 and dragging it hands back an IN-range number: the
    // gesture is "point at a place on this track", and the track is the declared range.
    expect(scrubValue({ startValue: 35, deltaPx: 0, min: -20, max: 20, step: 0.1 })).toBe(20)
    expect(scrubValue({ startValue: 0, deltaPx: 2600, min: -20, max: 20, step: 0.1 })).toBe(20)
  })
})

// ── the row component threads the mode to the two entry paths, and only those ──

describe('StudioRow wiring', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../app/components/vue-canvas/studio/StudioRow.vue', import.meta.url)),
    'utf-8',
  )

  it('reads the mode off the spec', () => {
    expect(src).toContain("entry?: 'unclamped'")
  })

  it('hands it to typed entry and to the arrow keys', () => {
    // onCommit (the text field) and onKeydown (via nudgeValue) are the two ENTRY paths.
    expect(src.match(/entry:\s*entryMode\.value/g)?.length).toBe(2)
  })

  it('does NOT hand it to click-to-position, which is a track gesture', () => {
    // Clicking the track means "put the value here on the track", so it resolves inside
    // the declared range in both modes — same as a drag.
    expect(src).toContain('parseTyped(String(raw), min.value, max.value, step.value) ?? num.value')
  })
})

// ── the schema field never reaches an agent's vocabulary ─────────────────────

describe('`entry` is presentation, and is stripped from every derived vocabulary', () => {
  // Same treatment `bindable` got: a row-rendering hint must not appear in the JSON the
  // model is handed, or every studio's vocabulary dump shifts the day a row opts in.
  const STRIP_SITES: Array<[string, number]> = [
    ['app/lib/gradientfx/agentControls.ts', 1],
    ['app/lib/scene3d/agentControls.ts', 2],
    ['app/lib/shapefx/agentControls.ts', 1],
    ['app/lib/geoshape/agentControls.ts', 1],
    ['app/lib/vectortype/agentControls.ts', 2],
  ]

  for (const [file, count] of STRIP_SITES) {
    it(`${file} strips it`, () => {
      const src = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf-8')
      const strips = src.match(/\{\s*when,\s*agent,\s*animatable,\s*summary,[^}]*\}/g) ?? []
      expect(strips.length, 'the strip sites this test knows about').toBe(count)
      for (const s of strips) expect(s, s).toMatch(/\bentry\b/)
    })
  }
})
