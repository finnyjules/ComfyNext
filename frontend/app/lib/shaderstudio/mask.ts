// frontend/app/lib/shaderstudio/mask.ts
// Per-effect spatial mask: a single source of truth for the region math, shared
// between the GLSL run at render time (MASK_GLSL) and a JS mirror (sampleMask)
// used by unit tests and the phase-2 on-canvas overlay. maskUniforms() flattens
// an EffectMask into the flat scalar uniforms the mask pass uploads.
//
// Region convention: maskValue(uv) ∈ [0,1] is the mix factor between the effect's
// INPUT (0) and its OUTPUT (1), so 1 = "effect fully applied here". Space is
// aspect-corrected (x *= resolution.x/resolution.y) so a `radius` mask stays
// circular on non-square images.

import type { EffectMask, MaskShape } from './types'

/** Shape → the float discriminator uploaded as u_maskShape and branched in GLSL. */
export const MASK_SHAPE_IDX: Record<MaskShape, number> = { radius: 0, band: 1, linear: 2 }

// The GLSL counterpart of sampleMask() lives inline in shaderfx/renderer.ts
// (MASK_FS) so the low-level renderer stays self-contained. The two are mirror
// implementations: sampleMask() below is guarded by property unit tests, and the
// GLSL is proven by the live pixel-confinement check in the studio.

function clamp(x: number, lo: number, hi: number): number { return Math.min(Math.max(x, lo), hi) }
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / Math.max(e1 - e0, 1e-9), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * JS mirror of MASK_GLSL's maskValue. `aspectRatio` = resolution.x/resolution.y.
 * Must stay byte-for-byte equivalent in behaviour to the GLSL above.
 */
export function sampleMask(m: EffectMask, u: number, v: number, aspectRatio: number): number {
  const ar = aspectRatio
  const dx = (u - m.cx) * ar
  const dy = v - m.cy
  const ca = Math.cos(m.angle), sa = Math.sin(m.angle)
  let rx = ca * dx + sa * dy
  const ry = -sa * dx + ca * dy
  const size = Math.max(m.size, 1e-4)
  const fw = clamp(m.feather, 1e-4, 1)
  let val: number
  if (m.shape === 'radius') {
    rx /= Math.max(m.aspect, 1e-3)
    const dist = Math.hypot(rx, ry) / size
    val = 1 - smoothstep(1 - fw, 1, dist)
  } else if (m.shape === 'band') {
    const dist = Math.abs(ry) / size
    val = 1 - smoothstep(1 - fw, 1, dist)
  } else {
    val = clamp((ry / size) * 0.5 + 0.5, 0, 1)
  }
  val = clamp(val, 0, 1)
  return m.invert ? 1 - val : val
}

/** Flatten an EffectMask to the scalar uniforms the mask pass uploads. */
export function maskUniforms(m: EffectMask): Record<string, number> {
  return {
    u_maskShape: MASK_SHAPE_IDX[m.shape],
    u_maskCx: m.cx,
    u_maskCy: m.cy,
    u_maskSize: m.size,
    u_maskAspect: m.aspect,
    u_maskAngle: m.angle,
    u_maskFeather: m.feather,
    u_maskInvert: m.invert ? 1 : 0,
  }
}
