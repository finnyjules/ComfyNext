import * as THREE from 'three'
import { type Fill, type ShaderSpec, hexBytes, patternImageData, ombrePicker, fillIsShader, effectiveTileFill } from './fillTile'
import { parseHexA, stripAlpha } from '~/lib/color/convert'
import { resolveField, beginFieldFrame, type FieldRequest } from '~/lib/shaderfill/field'

/**
 * GPU/THREE fill builders. The CPU fill model (Fill, FILL_TYPES, parsing) and the 2D-canvas
 * tile builder live in ./fillTile (THREE-free, so the Frame-modal compositor can reuse them).
 * Re-exported here so existing importers of fills.ts (SpaceTypeSurface, etc.) are unchanged.
 */
export {
  type Fill, type FillType, FILL_TYPES, DEFAULT_FILL,
  fillIsTextured, parseFills, serializeFills, normalizeFill,
  hexBytes, patternImageData, ombrePicker, fillTileCanvas,
} from './fillTile'

/** The fill's primary colour — used for solid fills and for cross-row gradient-mode lerps.
 *  Alpha is stripped: THREE.Color has no alpha channel and silently renders 8-digit hex WHITE.
 *  Read the alpha separately with fillAlpha(). */
export function fillPrimary(three: typeof THREE, fill: Fill): THREE.Color {
  return new three.Color(stripAlpha(fill.a))
}

/** The fill's alpha, 0–1. Legacy 6-digit fills are fully opaque. */
export function fillAlpha(fill: Fill): number {
  return parseHexA(fill.a).alpha
}

/** The fill's TEXT colour as a THREE.Color. Alpha is stripped for the same reason as
 *  fillPrimary: THREE.Color has no alpha channel and renders 8-digit hex as white.
 *  Read the alpha separately with fillTextAlpha(). */
export function fillTextColor(three: typeof THREE, fill: Fill): THREE.Color {
  return new three.Color(stripAlpha(fill.textColor))
}

/** The alpha of the fill's text colour, 0–1. Legacy 6-digit values are fully opaque. */
export function fillTextAlpha(fill: Fill): number {
  return parseHexA(fill.textColor).alpha
}

// Textures are cached by (type|a|b) so repeated slots/rebuilds reuse one GPU texture. Module
// singletons (never disposed) — the set of distinct fills in a doc is tiny.
const _cache = new Map<string, THREE.Texture>()

// ── Shader (object-anchor) field textures ────────────────────────────────────────────────
// Live shader fields render at this size — matches resolveField's own LIVE_FIELD_PX clamp
// (see ~/lib/shaderfill/field.ts) exactly, and the descriptor.ts measurements this task's
// report cites were taken at 512² too, so the numbers stay comparable.
const SHADER_FIELD_PX = 512

/** Small cap: unlike the other module caches in this file (static textures, "never disposed"
 *  because the set of distinct fills in a doc is tiny and costs nothing once built), each
 *  entry here costs a live GPU render every frame it's refreshed (see refreshLiveShaderFills
 *  below) for as long as it stays cached — an orphaned entry (fill deleted/changed) would
 *  otherwise keep competing for one of resolveField's LIVE_FIELD_CEILING live slots forever.
 *  Recency is refreshed only on genuine reuse (a material build asking for this fill again in
 *  shaderFieldTexture), NOT on every per-frame refresh — see the comment there. */
const SHADER_FIELD_CACHE_MAX = 16
interface LiveShaderFillEntry { tex: THREE.CanvasTexture; spec: ShaderSpec }
const _shaderFieldCache = new Map<string, LiveShaderFillEntry>()

function shaderFieldKey(spec: ShaderSpec): string { return JSON.stringify(spec) }

/** Resolve a shader fill spec to its live field texture — the ONLY place Space Type/Shape
 *  Studio materials get a shader fill's `uFill` texture from. Reused across BOTH
 *  `fillTexture` and `fillShaderTexture` (the latter delegates to the former for any
 *  non-solid fill), so every consumer of either goes through here.
 *
 *  Binds resolveField's canvas DIRECTLY as the CanvasTexture source — never copied, per its
 *  ownership contract (~/lib/shaderfill/field.ts). Falls back to the INPUT fill's own texture
 *  when the field can't be produced yet (unknown effect not loaded, WebGL context loss) —
 *  resolveField returns null in both cases, and the user must see the input fill, never an
 *  empty/blank shape. No cache entry is made on a fallback, so the next per-frame refresh
 *  (or the next material rebuild) simply tries again rather than freezing on the fallback. */
function shaderFieldTexture(three: typeof THREE, spec: ShaderSpec): THREE.Texture {
  const key = shaderFieldKey(spec)
  const hit = _shaderFieldCache.get(key)
  if (hit) {
    _shaderFieldCache.delete(key); _shaderFieldCache.set(key, hit)   // MRU refresh — see cap doc above
    return hit.tex
  }

  const canvas = resolveField({ spec, w: SHADER_FIELD_PX, h: SHADER_FIELD_PX, t: 0, fps: 30 })
  if (!canvas) {
    const inputFill = effectiveTileFill({ type: 'shader', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8, shader: spec })
    return fillTexture(three, inputFill) ?? fillShaderTexture(three, inputFill)
  }

  const tex = new three.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
  tex.colorSpace = three.SRGBColorSpace
  tex.needsUpdate = true

  if (_shaderFieldCache.size >= SHADER_FIELD_CACHE_MAX) {
    const oldest = _shaderFieldCache.keys().next().value
    if (oldest) _shaderFieldCache.delete(oldest)
  }
  _shaderFieldCache.set(key, { tex, spec })
  return tex
}

/** Advance every currently-cached shader-fill texture to time `t` (seconds), reusing each
 *  entry's SAME THREE.CanvasTexture object — set `.image`/`needsUpdate` in place rather than
 *  allocating a new CanvasTexture per frame, per resolveField's ownership contract. Effects
 *  never call this themselves: they only hold the texture object `fillShaderTexture`/
 *  `fillTexture` handed them at build time (stashed in a material's `uFill` uniform); this is
 *  the ONE place that keeps it moving frame to frame, generically across every effect, with no
 *  per-effect changes needed. Call once per host frame, BEFORE the THREE render call — see
 *  SpaceTypeEngine.renderFrameAt.
 *
 *  Returns the frozen-field count from beginFieldFrame so the surface can show a hint when a
 *  fill is capped at a still frame instead of animating — never truncate silently. */
export function refreshLiveShaderFills(t: number, fps = 30): { frozenCount: number } {
  if (_shaderFieldCache.size === 0) return { frozenCount: 0 }
  const entries = [..._shaderFieldCache.values()]
  const requests: FieldRequest[] = entries.map(e => ({ spec: e.spec, w: SHADER_FIELD_PX, h: SHADER_FIELD_PX, t, fps }))
  const { frozenCount } = beginFieldFrame(requests)
  for (let i = 0; i < entries.length; i++) {
    const canvas = resolveField(requests[i]!)
    if (!canvas) continue                          // keep showing the last good frame
    const entry = entries[i]!
    if (entry.tex.image !== canvas) {
      entry.tex.image = canvas
      entry.tex.needsUpdate = true
    }
  }
  return { frozenCount }
}

/** Build (or fetch cached) the tiling texture for a fill. Returns null for `solid`. Shader
 *  fills resolve through shaderFieldTexture (the live field, or a graceful fallback to the
 *  input fill) — never through the switch below, which has no shader case and would
 *  otherwise silently fall into the qr branch. */
export function fillTexture(three: typeof THREE, fill: Fill): THREE.Texture | null {
  if (fillIsShader(fill)) return shaderFieldTexture(three, fill.shader)
  if (fill.type === 'shader') return fillTexture(three, effectiveTileFill(fill))   // no spec yet — degrade to input
  if (fill.type === 'solid') return null
  const key = `${fill.type}|${fill.a}|${fill.b}|${fill.angle}|${fill.density}`
  const hit = _cache.get(key)
  if (hit) return hit
  const t = fill.type === 'gradient' ? gradientRamp(three, fill.a, fill.b)
    : fill.type === 'ombre' ? ombreTex(three, fill.a, fill.b, fill.angle)
    : fill.type === 'grid' ? gridTex(three, fill.a, fill.b, fill.density)
    : fill.type === 'noise' ? noiseTex(three, fill.a, fill.b)
    : fill.type === 'checkerboard' ? checkerboardTex(three, fill.a, fill.b, fill.density)
    : fill.type === 'stripes' ? stripesTex(three, fill.a, fill.b, fill.angle, fill.density)
    : qrTex(three, fill.a, fill.b, fill.density)
  _cache.set(key, t)
  return t
}

// GLSL sRGB→linear decode for fill textures sampled MANUALLY in custom shaders (three only
// auto-decodes textures bound to known material slots like `map`, not raw texture2D calls).
// Without this the canvas colours render washed-out/faded. WebGL1-safe (step, not bvec mix).
export const SRGB_TO_LINEAR_GLSL =
  'vec3 stLin(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c)); }'

// ── Shader path ───────────────────────────────────────────────────────────────────────────
// Effects that paint through a custom ShaderMaterial sample the fill as a 2D texture. So every
// fill (including solid) resolves to a texture here — solid becomes a 1×1 swatch. The shader
// reads `texture2D(uFillTex, uv * uFillTiling)`; tiling makes grid/noise repeat without needing
// per-use texture.repeat (which custom shaders don't auto-apply).
const _shaderCache = new Map<string, THREE.Texture>()

export function fillShaderTexture(three: typeof THREE, fill: Fill): THREE.Texture {
  if (fill.type !== 'solid') return fillTexture(three, fill)!   // gradient/grid/noise/shader already textures
  const key = `solid|${fill.a}`
  const hit = _shaderCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas'); c.width = 1; c.height = 1
  const ctx = c.getContext('2d')!
  ctx.fillStyle = fill.a; ctx.fillRect(0, 0, 1, 1)
  const t = new three.CanvasTexture(c); t.wrapS = t.wrapT = three.ClampToEdgeWrapping
  t.colorSpace = three.SRGBColorSpace
  _shaderCache.set(key, t)
  return t
}

/** How many times the fill texture tiles per unit UV (patterned fills repeat; solid/gradient = 1). */
export function fillTiling(fill: Fill): number {
  if (fill.type === 'noise') return 3
  return 1
}

/**
 * Stack a fill LIST into one vertical atlas (band i = fill i), so a single shader can paint a
 * per-segment palette of textured fills: sample at `v = (slot + localV) / count`. `flipY=false`
 * ⇒ canvas-y maps straight to texture-v (band i at v∈[i/n,(i+1)/n]). Cached by the fills' recipe.
 */
const _atlasCache = new Map<string, THREE.Texture>()

export function fillAtlasTexture(three: typeof THREE, fills: Fill[]): THREE.Texture {
  const key = fills.map(f => `${f.type}:${f.a}:${f.b}:${f.angle}:${f.density}`).join('|')
  const hit = _atlasCache.get(key)
  if (hit) return hit
  const BAND = 256, W = 256, nb = Math.max(1, fills.length)
  const c = document.createElement('canvas'); c.width = W; c.height = BAND * nb
  const ctx = c.getContext('2d')!
  fills.forEach((fill, i) => {
    const y0 = i * BAND
    if (fill.type === 'gradient') {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + BAND)
      g.addColorStop(0, fill.a); g.addColorStop(1, fill.b)
      ctx.fillStyle = g; ctx.fillRect(0, y0, W, BAND)
    } else if (fill.type === 'ombre') {
      ctx.putImageData(patternImageData(W, BAND, hexBytes(fill.a), hexBytes(fill.b), ombrePicker(W, BAND, fill.angle)), 0, y0)
    } else if (fill.type === 'grid') {
      const d = Math.max(1, Math.round(fill.density)), step = W / d
      ctx.fillStyle = fill.a; ctx.fillRect(0, y0, W, BAND)
      ctx.strokeStyle = fill.b; ctx.lineWidth = Math.max(1, Math.round(4 * (3 / d)))
      for (let gx = 0; gx <= d; gx++) { ctx.beginPath(); ctx.moveTo(gx * step, y0); ctx.lineTo(gx * step, y0 + BAND); ctx.stroke() }
      for (let gy = 0; gy <= d; gy++) { ctx.beginPath(); ctx.moveTo(0, y0 + gy * step); ctx.lineTo(W, y0 + gy * step); ctx.stroke() }
    } else if (fill.type === 'noise') {
      const dark = hexBytes(fill.a), light = hexBytes(fill.b)
      const img = ctx.createImageData(W, BAND)
      for (let p = 0; p < img.data.length; p += 4) {
        const px = (p / 4) % W, py = Math.floor((p / 4) / W) + y0
        const h = Math.sin((px * 12.9898 + py * 78.233)) * 43758.5453
        const f = (h - Math.floor(h)) < 0.5 ? 0 : 1
        img.data[p] = dark[0] + (light[0] - dark[0]) * f
        img.data[p + 1] = dark[1] + (light[1] - dark[1]) * f
        img.data[p + 2] = dark[2] + (light[2] - dark[2]) * f
        img.data[p + 3] = 255
      }
      ctx.putImageData(img, 0, y0)
    } else if (fill.type === 'checkerboard') {
      drawPatternBand(ctx, fill, y0, W, BAND)
    } else if (fill.type === 'stripes') {
      drawPatternBand(ctx, fill, y0, W, BAND)
    } else if (fill.type === 'qr') {
      drawPatternBand(ctx, fill, y0, W, BAND)
    } else {
      ctx.fillStyle = fill.a; ctx.fillRect(0, y0, W, BAND)
    }
  })
  const t = new three.CanvasTexture(c)
  t.flipY = false
  t.wrapS = three.RepeatWrapping
  t.wrapT = three.ClampToEdgeWrapping
  t.colorSpace = three.SRGBColorSpace
  _atlasCache.set(key, t)
  return t
}

/** Vertical A→B gradient ramp (a at top, b at bottom). */
function gradientRamp(three: typeof THREE, a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, a); g.addColorStop(1, b)
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256)
  const t = new three.CanvasTexture(c); t.wrapS = t.wrapT = three.ClampToEdgeWrapping
  t.colorSpace = three.SRGBColorSpace
  return t
}

/** Ombre dither for an EXTRUDE side wall: the grainy fade runs along V (the extrude depth) and
 *  the perimeter (U) tiles. ClampToEdge on V so the whole 0→1 depth is ONE fade (no repeat banding),
 *  unlike the tiled grid/noise side textures. Solid `a` at the near face → grain → solid `b` at the far. */
export function ombreSideTexture(three: typeof THREE, a: string, b: string): THREE.Texture {
  const N = 256
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  // angle 90 → fade along the canvas height (V); flipY (CanvasTexture default) puts V=0 at the bottom.
  ctx.putImageData(patternImageData(N, N, hexBytes(a), hexBytes(b), ombrePicker(N, N, 90)), 0, 0)
  const t = new three.CanvasTexture(c)
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = three.RepeatWrapping
  t.wrapT = three.ClampToEdgeWrapping
  t.magFilter = three.NearestFilter; t.minFilter = three.NearestFilter
  t.generateMipmaps = false
  return t
}

/** Standard filtering for fill pattern textures: crisp edges up close (nearest magnification)
 *  but anti-aliased when minified on tilted/receding geometry (mipmaps + anisotropy). Replaces
 *  the old NearestFilter-without-mipmaps, which shimmered/aliased on the wavy bands. */
function tunePattern(three: typeof THREE, t: THREE.Texture): void {
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = t.wrapT = three.RepeatWrapping
  t.generateMipmaps = true
  t.magFilter = three.NearestFilter
  t.minFilter = three.NearestMipmapLinearFilter
  t.anisotropy = 8
}

function ombreTex(three: typeof THREE, a: string, b: string, angle: number): THREE.Texture {
  const N = 256
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, hexBytes(a), hexBytes(b), ombrePicker(N, N, angle)), 0, 0)
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}

/** Grid: `a` cell fill + `b` border lines. */
function gridTex(three: typeof THREE, a: string, b: string, density: number): THREE.Texture {
  const N = 512, d = Math.max(1, Math.round(density)), step = N / d
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.fillStyle = a; ctx.fillRect(0, 0, N, N)
  ctx.strokeStyle = b; ctx.lineWidth = Math.max(1, Math.round(6 * (3 / d)))
  for (let i = 0; i <= d; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, N); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(N, i * step); ctx.stroke()
  }
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}

/** Hard-threshold black/white-style grain between `a` (dark) and `b` (light), crisp at angles. */
function noiseTex(three: typeof THREE, a: string, b: string): THREE.Texture {
  const dark = hexBytes(a), light = hexBytes(b)
  const N = 256
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < img.data.length; i += 4) {
    // Deterministic hash grain, hard-thresholded so the two colours stay distinct (no grey mush).
    const h = Math.sin(i * 12.9898) * 43758.5453
    const f = (h - Math.floor(h)) < 0.5 ? 0 : 1
    img.data[i] = dark[0] + (light[0] - dark[0]) * f
    img.data[i + 1] = dark[1] + (light[1] - dark[1]) * f
    img.data[i + 2] = dark[2] + (light[2] - dark[2]) * f
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}


function drawPatternBand(ctx: CanvasRenderingContext2D, fill: Fill, y0: number, w: number, h: number) {
  const colA = hexBytes(fill.a), colB = hexBytes(fill.b)
  const d = Math.max(2, Math.round(fill.density))
  const img = fill.type === 'checkerboard'
    ? patternImageData(w, h, colA, colB, (px, py) => (Math.floor(px * d / w) + Math.floor(py * d / h)) % 2 === 1)
    : fill.type === 'stripes'
      ? (() => {
          const rad = (fill.angle * Math.PI) / 180
          const dx = Math.cos(rad), dy = Math.sin(rad)
          return patternImageData(w, h, colA, colB, (px, py) => {
            const proj = px * dx + py * dy
            return Math.floor(proj / (w / d)) % 2 !== 0
          })
        })()
      : patternImageData(w, h, colA, colB, (px, py) => {
          const cx = Math.floor(px * d / w), cy = Math.floor(py * d / h)
          const v = Math.sin((cx * 12.9898 + cy * 78.233 + cx * cy * 3.71)) * 43758.5453
          return (v - Math.floor(v)) > 0.45
        })
  ctx.putImageData(img, 0, y0)
}

// ── Standalone fill textures for new pattern types ───────────────────────────

function checkerboardTex(three: typeof THREE, a: string, b: string, density: number): THREE.Texture {
  const N = 512, d = Math.max(2, Math.round(density))
  const colA = hexBytes(a), colB = hexBytes(b)
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, colA, colB, (px, py) =>
    (Math.floor(px * d / N) + Math.floor(py * d / N)) % 2 === 1), 0, 0)
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}

function stripesTex(three: typeof THREE, a: string, b: string, angle: number, density: number): THREE.Texture {
  const N = 512, d = Math.max(2, Math.round(density))
  const colA = hexBytes(a), colB = hexBytes(b)
  const rad = (angle * Math.PI) / 180
  const dx = Math.cos(rad), dy = Math.sin(rad)
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, colA, colB, (px, py) => {
    const proj = px * dx + py * dy
    return Math.floor(proj / (N / d)) % 2 !== 0
  }), 0, 0)
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}

function qrTex(three: typeof THREE, a: string, b: string, density: number): THREE.Texture {
  const N = 512, d = Math.max(2, Math.round(density))
  const colA = hexBytes(a), colB = hexBytes(b)
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, colA, colB, (px, py) => {
    const cx = Math.floor(px * d / N), cy = Math.floor(py * d / N)
    const v = Math.sin((cx * 12.9898 + cy * 78.233 + cx * cy * 3.71)) * 43758.5453
    return (v - Math.floor(v)) > 0.45
  }), 0, 0)
  const t = new three.CanvasTexture(c)
  tunePattern(three, t)
  return t
}
