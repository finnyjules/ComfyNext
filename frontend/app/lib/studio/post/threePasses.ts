// three.js ShaderPass ports of the 2D chain's grain/vignette/duotone effects
// (frontend/app/lib/studio/post/chain.ts, backed by shader_effects/post_grain.frag,
// vignette.frag, duotone.frag). This is Effects Unification Task 2, re-scoped —
// see .superpowers/sdd/ef-2-report.md for the prior investigation that transcribed
// the GLSL and found the alpha bug this file works around (next section).
//
// Follows the existing custom-ShaderPass pattern in ~/lib/spacetype/post.ts's
// gradePass (~line 137): plain GLSL1 (texture2D/varying/gl_FragColor), not the
// catalog's #version 300 es dialect — three.js's ShaderPass default. gl_FragCoord
// is a built-in in both dialects and a ShaderPass's FullScreenQuad renders into a
// same-size target, so grain's device-pixel hash carries over unchanged.
//
// ALPHA (read before touching the fragment shaders below): the source catalog
// frags for vignette.frag/duotone.frag hard-code output alpha to 1.0, which only
// works in the 2D chain because chain.ts runs a separate alpha-restore pass after
// every effect (see that file's module header). A three.js ShaderPass has no such
// restore. So both ports here write `texel.a` (the incoming alpha) instead of a
// hard 1.0 — otherwise enabling vignette or duotone would flatten Space Type /
// Scene3D's transparency to opaque. post_grain.frag already preserves `src.a` in
// its own output (see the catalog source), so the grain port needs no change
// there beyond porting it as-is; its `alphaGated` behaviour (grain modulates
// within the existing alpha via `gate = src.a`) is preserved unchanged too.
import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import type { PostSettings } from '~~/shared/spacetype/state'
import { stripAlpha } from '~/lib/color/convert'

const PASS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

// Ported verbatim from shader_effects/post_grain.frag (Dave Hoskins "hash without
// sine" + the 0.16 amount coefficient + the u_size cell-floor quantisation).
// gl_FragCoord.xy is the device pixel, same convention as the 2D chain's frag.
const GRAIN_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform float u_amount;', // 0..1
  'uniform float u_size;', // 1..8, device px per cell
  'uniform float u_seed;',
  'varying vec2 vUv;',
  'float hashGrain(vec2 p) {',
  '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
  '  p3 += dot(p3, p3.yzx + 33.33);',
  '  return fract((p3.x + p3.y) * p3.z);',
  '}',
  'void main() {',
  '  vec4 src = texture2D(tDiffuse, vUv);',
  '  vec2 coord = u_size > 1.0 ? floor(gl_FragCoord.xy / u_size) * u_size : gl_FragCoord.xy;',
  '  float g = hashGrain(coord + u_seed) - 0.5;',
  '  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));',
  '  float midtone = 0.35 + 0.65 * (lum * (1.0 - lum) * 4.0);',
  '  float gate = src.a;', // alphaGated: no contribution on fully-transparent pixels
  '  vec3 col = src.rgb + g * u_amount * 0.16 * midtone * gate;',
  '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);',
  '}',
].join('\n')

// Ported from shader_effects/vignette.frag. u_roundness has no Sailor-mapped
// param (see ef-2-report.md) so it's pinned to the catalog's own default (0.5,
// shader_effects/manifest.json's vignette record) rather than exposed as a
// uniform nothing ever sets. Output alpha preserves `texel.a` — see the ALPHA
// note above; the source frag hard-codes 1.0 here.
const VIGNETTE_ROUNDNESS_DEFAULT = 0.5
const VIGNETTE_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform vec2 u_resolution;',
  'uniform float u_amount;',
  'uniform float u_radius;',
  'uniform float u_softness;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec4 texel = texture2D(tDiffuse, vUv);',
  '  vec3 col = texel.rgb;',
  '  float aspc = u_resolution.x / u_resolution.y;',
  '  vec2 d = vUv - 0.5;',
  `  d.x *= mix(aspc, 1.0, ${VIGNETTE_ROUNDNESS_DEFAULT.toFixed(1)});`,
  '  float r = length(d) * 2.0;',
  '  float soft = max(u_softness, 0.001);',
  '  float v = smoothstep(u_radius + soft, u_radius - soft, r);',
  '  col *= mix(1.0, v, u_amount);',
  '  gl_FragColor = vec4(col, texel.a);',
  '}',
].join('\n')

// Ported from shader_effects/duotone.frag. Output alpha preserves `texel.a` —
// see the ALPHA note above; the source frag hard-codes 1.0 here.
const DUOTONE_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform vec3 u_shadow;',
  'uniform vec3 u_highlight;',
  'uniform float u_contrast;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec4 texel = texture2D(tDiffuse, vUv);',
  '  float l = dot(texel.rgb, vec3(0.299, 0.587, 0.114));',
  '  l = clamp((l - 0.5) * (1.0 + u_contrast) + 0.5, 0.0, 1.0);',
  '  vec3 col = mix(u_shadow, u_highlight, l);',
  '  gl_FragColor = vec4(col, texel.a);',
  '}',
].join('\n')

export function makeGrainPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      u_amount: { value: 0 },
      u_size: { value: 1 },
      u_seed: { value: 0 },
    },
    vertexShader: PASS_VERT,
    fragmentShader: GRAIN_FRAG,
  })
}

export function makeVignettePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_amount: { value: 0 },
      u_radius: { value: 0.6 },
      u_softness: { value: 0.5 },
    },
    vertexShader: PASS_VERT,
    fragmentShader: VIGNETTE_FRAG,
  })
}

export function makeDuotonePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      u_shadow: { value: new THREE.Vector3(0, 0, 0) },
      u_highlight: { value: new THREE.Vector3(1, 1, 1) },
      u_contrast: { value: 1 },
    },
    vertexShader: PASS_VERT,
    fragmentShader: DUOTONE_FRAG,
  })
}

export interface PostExtraPasses {
  grain: ShaderPass
  vignette: ShaderPass
  duotone: ShaderPass
}

/** Largest magnitude `u_seed` may reach before highp float precision collapses
 *  the per-pixel hash into a flat wash — mirrors chain.ts's own SEED_MAX/safeSeed
 *  (same constant, same fold), kept as a local copy here rather than an import so
 *  this module stays free of chain.ts's WebGL2-context-creating runner class. */
const SEED_MAX = 10000

function safeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 42
  return Math.abs(seed) % SEED_MAX
}

/** Hex string → a fresh THREE.Vector3 in 0..1, alpha stripped first. StudioColor
 *  emits 8-digit #rrggbbaa as soon as its opacity track is touched, and
 *  THREE.Color's own hex parser only accepts 3/6-digit forms — feeding it an
 *  8-digit string silently no-ops and leaves the colour at its prior value
 *  (default white), not an error. Every THREE.Color built from a Sailor colour
 *  param must stripAlpha first (see ~/lib/spacetype/engine.ts's bgColor handling
 *  for the same pattern). */
function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(stripAlpha(hex))
  return new THREE.Vector3(c.r, c.g, c.b)
}

/** Set `.enabled` + uniforms on all three passes from a PostSettings snapshot.
 *  `resolution` feeds vignette's aspect-ratio correction; `timeSeconds` seeds
 *  grain's hash field (folded through the same precision-safe range as the 2D
 *  chain's `safeSeed`, since there's no per-document seed concept on this live
 *  three.js path — time stands in for it, so the grain field animates/reseeds
 *  as time advances rather than staying frozen). */
export function applyPostExtras(
  passes: PostExtraPasses,
  post: PostSettings,
  resolution: THREE.Vector2,
  timeSeconds: number,
): void {
  const { grain, vignette, duotone } = passes

  grain.enabled = post.grain
  grain.uniforms.u_amount!.value = post.grainAmount
  grain.uniforms.u_size!.value = post.grainSize
  grain.uniforms.u_seed!.value = safeSeed(timeSeconds)

  vignette.enabled = post.vignette
  vignette.uniforms.u_amount!.value = post.vignetteAmount
  vignette.uniforms.u_radius!.value = post.vignetteRadius
  vignette.uniforms.u_softness!.value = post.vignetteSoftness
  ;(vignette.uniforms.u_resolution!.value as THREE.Vector2).copy(resolution)

  duotone.enabled = post.duotone
  // Guarded: hexToVec3 allocates a THREE.Color + THREE.Vector3 per call, and Scene3D
  // calls applyPostExtras every frame — skip the conversion/uniform writes entirely
  // when duotone is off rather than paying that allocation ~240x/sec for nothing.
  if (post.duotone) {
    ;(duotone.uniforms.u_shadow!.value as THREE.Vector3).copy(hexToVec3(post.duotoneShadow))
    ;(duotone.uniforms.u_highlight!.value as THREE.Vector3).copy(hexToVec3(post.duotoneHighlight))
    duotone.uniforms.u_contrast!.value = post.duotoneMix
  }
}
