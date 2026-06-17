import * as THREE from 'three'

/**
 * A "fill" is a reusable colour recipe for a swatch slot: a flat colour, a 2-colour gradient,
 * a grid, or a noise pattern. The UI renders a type dropdown + 1–2 dependent colour pickers per
 * slot; effects turn a fill into either a solid THREE.Color (`solid`) or a tiling THREE.Texture
 * (`gradient`/`grid`/`noise`). Stored in params as a single JSON string so ParamValue stays scalar.
 */
export type FillType = 'solid' | 'gradient' | 'grid' | 'noise' | 'checkerboard' | 'stripes' | 'qr'
/** `a`/`b` drive the slot's fill (stripe); `textColor` is the solid colour for type on that row.
 *  `angle` (degrees) only applies to `stripes`; `density` controls cell/stripe count for patterned fills. */
export interface Fill { type: FillType; a: string; b: string; textColor: string; angle: number; density: number }

const FILL_TYPES: FillType[] = ['solid', 'gradient', 'grid', 'noise', 'checkerboard', 'stripes', 'qr']
const DEFAULT_FILL: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }

/** True when the fill needs a texture (anything but a flat colour). */
export function fillIsTextured(fill: Fill): boolean { return fill.type !== 'solid' }

/** Parse the JSON param string into a non-empty Fill[] (tolerant of junk/legacy values). */
export function parseFills(raw: unknown): Fill[] {
  if (typeof raw !== 'string' || !raw) return [{ ...DEFAULT_FILL }]
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return [{ ...DEFAULT_FILL }]
    return arr.map((f: unknown): Fill => {
      const o = (f ?? {}) as Record<string, unknown>
      const type = FILL_TYPES.includes(o.type as FillType) ? (o.type as FillType) : 'solid'
      return {
        type,
        a: typeof o.a === 'string' ? o.a : '#ffffff',
        b: typeof o.b === 'string' ? o.b : '#000000',
        textColor: typeof o.textColor === 'string' ? o.textColor : '#ffffff',
        angle: typeof o.angle === 'number' ? o.angle : 45,
        density: typeof o.density === 'number' ? o.density : 8,
      }
    })
  } catch { return [{ ...DEFAULT_FILL }] }
}

export function serializeFills(fills: Fill[]): string { return JSON.stringify(fills) }

/** The fill's primary colour — used for solid fills and for cross-row gradient-mode lerps. */
export function fillPrimary(three: typeof THREE, fill: Fill): THREE.Color {
  return new three.Color(fill.a)
}

// Textures are cached by (type|a|b) so repeated slots/rebuilds reuse one GPU texture. Module
// singletons (never disposed) — the set of distinct fills in a doc is tiny.
const _cache = new Map<string, THREE.Texture>()

/** Build (or fetch cached) the tiling texture for a fill. Returns null for `solid`. */
export function fillTexture(three: typeof THREE, fill: Fill): THREE.Texture | null {
  if (fill.type === 'solid') return null
  const key = `${fill.type}|${fill.a}|${fill.b}|${fill.angle}|${fill.density}`
  const hit = _cache.get(key)
  if (hit) return hit
  const t = fill.type === 'gradient' ? gradientRamp(three, fill.a, fill.b)
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
  if (fill.type !== 'solid') return fillTexture(three, fill)!   // gradient/grid/noise already textures
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
  const BAND = 64, W = 64, nb = Math.max(1, fills.length)
  const c = document.createElement('canvas'); c.width = W; c.height = BAND * nb
  const ctx = c.getContext('2d')!
  fills.forEach((fill, i) => {
    const y0 = i * BAND
    if (fill.type === 'gradient') {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + BAND)
      g.addColorStop(0, fill.a); g.addColorStop(1, fill.b)
      ctx.fillStyle = g; ctx.fillRect(0, y0, W, BAND)
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

/** Parse a `#rrggbb` hex to raw sRGB bytes (canvas is sRGB — do NOT go through THREE.Color,
 *  whose components are linear-light and would write the wrong bytes). */
export function hexBytes(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Grid: `a` cell fill + `b` border lines. */
function gridTex(three: typeof THREE, a: string, b: string, density: number): THREE.Texture {
  const N = 128, d = Math.max(1, Math.round(density)), step = N / d
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.fillStyle = a; ctx.fillRect(0, 0, N, N)
  ctx.strokeStyle = b; ctx.lineWidth = Math.max(1, Math.round(6 * (3 / d)))
  for (let i = 0; i <= d; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, N); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(N, i * step); ctx.stroke()
  }
  const t = new three.CanvasTexture(c); t.wrapS = t.wrapT = three.RepeatWrapping; t.anisotropy = 4
  t.colorSpace = three.SRGBColorSpace
  return t
}

/** Hard-threshold black/white-style grain between `a` (dark) and `b` (light), crisp at angles. */
function noiseTex(three: typeof THREE, a: string, b: string): THREE.Texture {
  const dark = hexBytes(a), light = hexBytes(b)
  const N = 64
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
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = t.wrapT = three.RepeatWrapping
  t.generateMipmaps = false
  t.minFilter = three.NearestFilter
  t.magFilter = three.NearestFilter
  return t
}

// ── Pixel-level pattern builders (seamlessly tileable) ────────────────────────

function patternImageData(w: number, h: number, colA: [number, number, number], colB: [number, number, number], picker: (px: number, py: number) => boolean): ImageData {
  const img = new ImageData(w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % w, py = Math.floor((i / 4) / w)
    const useB = picker(px, py)
    img.data[i] = useB ? colB[0] : colA[0]
    img.data[i + 1] = useB ? colB[1] : colA[1]
    img.data[i + 2] = useB ? colB[2] : colA[2]
    img.data[i + 3] = 255
  }
  return img
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
  const N = 128, d = Math.max(2, Math.round(density))
  const colA = hexBytes(a), colB = hexBytes(b)
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, colA, colB, (px, py) =>
    (Math.floor(px * d / N) + Math.floor(py * d / N)) % 2 === 1), 0, 0)
  const t = new three.CanvasTexture(c)
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = t.wrapT = three.RepeatWrapping
  t.magFilter = three.NearestFilter
  t.minFilter = three.NearestFilter
  t.generateMipmaps = false
  return t
}

function stripesTex(three: typeof THREE, a: string, b: string, angle: number, density: number): THREE.Texture {
  const N = 128, d = Math.max(2, Math.round(density))
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
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = t.wrapT = three.RepeatWrapping
  return t
}

function qrTex(three: typeof THREE, a: string, b: string, density: number): THREE.Texture {
  const N = 128, d = Math.max(2, Math.round(density))
  const colA = hexBytes(a), colB = hexBytes(b)
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  ctx.putImageData(patternImageData(N, N, colA, colB, (px, py) => {
    const cx = Math.floor(px * d / N), cy = Math.floor(py * d / N)
    const v = Math.sin((cx * 12.9898 + cy * 78.233 + cx * cy * 3.71)) * 43758.5453
    return (v - Math.floor(v)) > 0.45
  }), 0, 0)
  const t = new three.CanvasTexture(c)
  t.colorSpace = three.SRGBColorSpace
  t.wrapS = t.wrapT = three.RepeatWrapping
  t.magFilter = three.NearestFilter
  t.minFilter = three.NearestFilter
  t.generateMipmaps = false
  return t
}
