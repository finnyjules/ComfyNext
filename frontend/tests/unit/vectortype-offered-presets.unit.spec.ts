/**
 * Bug 2 — two sources of truth for "is this preset real here?".
 *
 * `vtPresetIdsFor` is documented as *everything a picker should offer*, and
 * `vtKnowsPreset` decides whether a stored id is forwarded to the engine (and so
 * whether `vtIsAnimated` reports "animated" and the frame source claims a
 * duration). They read the same engine list — but the four COPY-BASED presets
 * express themselves through `UnitState.copies`, and `VtGlyphMotion` has no such
 * field, so two of them render a completely frozen word here.
 *
 * The gallery hid them anyway, through a private `COPY_BASED_IDS` set inside
 * `MotionPresetPicker.vue`. That is the second source of truth: the picker
 * agreed with reality and the two library functions did not, so a config
 * imported from JSON reported "animated" over a still frame.
 *
 * The fix is to make `copies` a real, PROBED capability like `blur` — so one
 * derivation answers the question for the picker, for `vtKnowsPreset`, and for
 * every future consumer. These tests pin that there is exactly one list and that
 * it is derived from what the presets actually return.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_PRESET_CAPABILITIES,
  PRESET_CAPABILITIES,
  SUPPORTED_IN_IDS,
  SUPPORTED_LOOP_IDS,
  SUPPORTED_OUT_IDS,
  presetIdsFor,
} from '~/lib/motion/evaluate'
import { VT_PRESET_SLOTS } from '~/lib/vectortype/config'
import {
  VT_PRESET_CAPABILITIES,
  vtKnowsPreset,
  vtPresetIdsFor,
} from '~/lib/vectortype/presetMotion'

/** The four the picker used to hide by hand. Named here only to assert the
 *  DERIVATION reproduces them — nothing in the app reads this list. */
const COPY_BASED = ['inward-echoes', 'grid-scroll-x', 'grid-scroll-y', 'noise-tile'].sort()

describe('`copies` is a probed capability, not a hand-maintained list', () => {
  it('is one of the capabilities the engine derives', () => {
    expect([...ALL_PRESET_CAPABILITIES]).toContain('copies')
  })

  it('the derivation finds exactly the copy-based presets', () => {
    const needCopies = Object.entries(PRESET_CAPABILITIES)
      .filter(([, caps]) => caps.includes('copies'))
      .map(([id]) => id)
      .sort()
    expect(needCopies).toEqual(COPY_BASED)
  })

  it('a consumer that paints copies is still offered them — the Compositor is not regressed', () => {
    for (const id of COPY_BASED) expect(presetIdsFor('loop', ['copies'])).toContain(id)
    // …and one that does not, is not.
    for (const id of COPY_BASED) expect(presetIdsFor('loop', [])).not.toContain(id)
  })
})

describe('Vector Type offers exactly what it will run', () => {
  it('declares every capability it can draw, and only those', () => {
    expect([...VT_PRESET_CAPABILITIES].sort()).toEqual(
      [...ALL_PRESET_CAPABILITIES].filter(c => c !== 'copies').sort(),
    )
  })

  it('never offers a copy-based preset, and never accepts one from stored JSON', () => {
    for (const id of COPY_BASED) {
      expect(vtPresetIdsFor('loop')).not.toContain(id)
      // The bug: `vtKnowsPreset` used to say yes, so a hand-authored config
      // reported "animated" over a frozen word.
      expect(vtKnowsPreset('loop', id), id).toBe(false)
    }
  })

  it('the offered list and the accepted list are the SAME list', () => {
    const engineIds = { in: SUPPORTED_IN_IDS, out: SUPPORTED_OUT_IDS, loop: SUPPORTED_LOOP_IDS }
    for (const slot of VT_PRESET_SLOTS) {
      // Everything offered is accepted…
      for (const id of vtPresetIdsFor(slot)) expect(vtKnowsPreset(slot, id), `${slot}/${id}`).toBe(true)
      // …and every ENGINE id accepted is offered (axis presets are additionally
      // font-gated in the offer, which is a separate question by design).
      for (const id of engineIds[slot]) {
        expect(vtKnowsPreset(slot, id), `${slot}/${id}`).toBe(vtPresetIdsFor(slot).includes(id))
      }
    }
  })
})
