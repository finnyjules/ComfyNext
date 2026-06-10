import { describe, it, expect } from 'vitest'
import { blendChannel, BLEND_MODE_INDEX } from '../../shared/timeline/blendModes'
import type { BlendMode } from '../../shared/timeline/types'

// Expected values computed by hand from comfy_extras/nodes_timeline.py::_blend_np
// (the golden source). soft_light is the pegtop variant (1-2b)a²+2ba — NOT W3C.
// Triples: [a (base), b (top), expected]
const CASES: Record<BlendMode, [number, number, number][]> = {
  normal: [[0.25, 0.5, 0.5], [0.8, 0.7, 0.7]],
  multiply: [[0.25, 0.5, 0.125], [0.8, 0.7, 0.56]],
  screen: [[0.25, 0.5, 0.625], [0.8, 0.7, 0.94]],
  // a < 0.5 → 2ab ; a ≥ 0.5 → 1-2(1-a)(1-b). Boundary a=0.5 takes the high branch.
  overlay: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.88], [0.5, 0.25, 0.25]],
  soft_light: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.864], [0.5, 0.25, 0.375]],
  // b < 0.5 → 2ab ; b ≥ 0.5 → 1-2(1-a)(1-b). Boundary b=0.5 takes the high branch.
  hard_light: [[0.5, 0.25, 0.25], [0.8, 0.7, 0.88], [0.25, 0.5, 0.25]],
  difference: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.1]],
  lighten: [[0.25, 0.5, 0.5], [0.8, 0.7, 0.8]],
  darken: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.7]],
  add: [[0.25, 0.5, 0.75], [0.8, 0.7, 1.0]],
}

describe('blendChannel mirrors _blend_np', () => {
  for (const [mode, cases] of Object.entries(CASES) as [BlendMode, [number, number, number][]][]) {
    it(mode, () => {
      for (const [a, b, want] of cases) {
        expect(blendChannel(a, b, mode), `${mode}(${a}, ${b})`).toBeCloseTo(want, 10)
      }
    })
  }

  it('boundary semantics: branch switches AT 0.5, high branch wins at exactly 0.5', () => {
    // overlay at a=0.5: 1-2(0.5)(1-b) — with b=0.9 → 1-2*0.5*0.1 = 0.9
    expect(blendChannel(0.5, 0.9, 'overlay')).toBeCloseTo(0.9, 10)
    // hard_light at b=0.5: high branch → 1-2(1-a)(0.5) = a (with a=0.3 → 0.3)
    expect(blendChannel(0.3, 0.5, 'hard_light')).toBeCloseTo(0.3, 10)
  })

  it('BLEND_MODE_INDEX covers all 10 modes with stable indices', () => {
    expect(BLEND_MODE_INDEX).toEqual({
      normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4,
      hard_light: 5, difference: 6, lighten: 7, darken: 8, add: 9,
    })
  })
})
