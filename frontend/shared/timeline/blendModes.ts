import type { BlendMode } from './types'

// TS reference of the timeline blend math — a 1:1 mirror of
// comfy_extras/nodes_timeline.py::_blend_np, the formula set the committed
// goldens were rendered with. The GLSL shader (engine/gl/shaders.ts) must
// match THIS, verified by tests/gl-blend-conformance.spec.ts.
//
// NOTE: soft_light is the pegtop variant (1-2b)a² + 2ba. The Compositor
// feature uses W3C soft-light — that is a DIFFERENT product surface with
// different goldens. Do not "unify" them.
//
// Branch boundaries: overlay switches on a < 0.5, hard_light on b < 0.5;
// at exactly 0.5 the high branch applies (numpy `where(x < 0.5, lo, hi)`).

export function blendChannel(a: number, b: number, mode: BlendMode): number {
  switch (mode) {
    case 'normal': return b
    case 'multiply': return a * b
    case 'screen': return 1 - (1 - a) * (1 - b)
    case 'overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
    case 'soft_light': return (1 - 2 * b) * a * a + 2 * b * a
    case 'hard_light': return b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
    case 'difference': return Math.abs(a - b)
    case 'lighten': return Math.max(a, b)
    case 'darken': return Math.min(a, b)
    case 'add': return Math.min(1, a + b)
  }
}

/** Stable mode → int mapping shared with the GLSL shader's `u_mode` uniform. */
export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4,
  hard_light: 5, difference: 6, lighten: 7, darken: 8, add: 9,
}
