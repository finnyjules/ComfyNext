/**
 * Post-processing effects for the Compositor — pure kernels + the canvas
 * effect chain shared by per-layer rendering (paintLayer) and the doc-level
 * post stack (paintLayerStack). Spatial params are normalized to canvas
 * width; `opts.W` is the logical width, `opts.scale` device px per logical px.
 *
 * Fixed chain order (applyEffectChain is the single source of truth):
 *   adjust → duotone → bloom → vignette → grain
 */

export interface AdjustEffect {
  type: 'adjust'
  brightness: number  // 1 = neutral, CSS brightness() multiplier, 0..2
  contrast: number    // 1 = neutral, 0..2
  saturation: number  // 1 = neutral, 0..2
  hue: number         // degrees, -180..180, 0 = neutral
  visible: boolean
}
export interface BloomEffect {
  type: 'bloom'
  threshold: number   // 0..1 — luminance cutoff for the bright pass
  radius: number      // blur radius, normalized to canvas width
  intensity: number   // 0..2 — strength of the additive composite
  visible: boolean
}
export interface GrainEffect {
  type: 'grain'
  amount: number      // 0..1 — composite alpha
  size: number        // 1..8 — noise texel scale
  visible: boolean
}
export interface VignetteEffect {
  type: 'vignette'
  amount: number      // 0..1 — darkening strength
  size: number        // 0..1 — inner radius where falloff starts
  softness: number    // 0..1 — falloff width
  visible: boolean
}
export interface DuotoneEffect {
  type: 'duotone'
  shadows: string     // hex colour mapped to luminance 0
  highlights: string  // hex colour mapped to luminance 1
  mix: number         // 0..1 — blend between original and duotone result
  visible: boolean
}
export type PostEffect = AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect

export const POST_EFFECT_DEFAULTS: Record<PostEffect['type'], PostEffect> = {
  adjust: { type: 'adjust', brightness: 1, contrast: 1, saturation: 1, hue: 0, visible: true },
  bloom: { type: 'bloom', threshold: 0.6, radius: 0.02, intensity: 0.8, visible: true },
  grain: { type: 'grain', amount: 0.25, size: 2, visible: true },
  vignette: { type: 'vignette', amount: 0.5, size: 0.5, softness: 0.5, visible: true },
  duotone: { type: 'duotone', shadows: '#1a1a40', highlights: '#ffe8d6', mix: 1, visible: true },
}
export function defaultPostEffect(type: PostEffect['type']): PostEffect {
  return JSON.parse(JSON.stringify(POST_EFFECT_DEFAULTS[type])) as PostEffect
}

/** Shared param bounds — the panel sliders and the agent's sanitizer both obey these. */
export const POST_FX_PARAM_CLAMP: Record<string, Record<string, [number, number]>> = {
  adjust: { brightness: [0, 2], contrast: [0, 2], saturation: [0, 2], hue: [-180, 180] },
  bloom: { threshold: [0, 1], radius: [0, 0.5], intensity: [0, 2] },
  grain: { amount: [0, 1], size: [1, 8] },
  vignette: { amount: [0, 1], size: [0, 1], softness: [0, 1] },
  duotone: { mix: [0, 1] },
}

const CHAIN_TYPES = new Set<string>(['adjust', 'duotone', 'bloom', 'vignette', 'grain'])
export const isChainEffect = (e: { type: string }): e is PostEffect => CHAIN_TYPES.has(e.type)
export const chainActive = (effects?: { type: string; visible?: boolean }[]): boolean =>
  !!effects?.some(e => e.visible !== false && CHAIN_TYPES.has(e.type))

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6) // 8-digit hex: strip alpha
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** CSS filter string for an adjust effect — '' when every param is neutral. */
export function adjustFilterString(fx: AdjustEffect): string {
  const b = clamp(fx.brightness ?? 1, 0, 2)
  const c = clamp(fx.contrast ?? 1, 0, 2)
  const s = clamp(fx.saturation ?? 1, 0, 2)
  const h = clamp(fx.hue ?? 0, -180, 180)
  const parts: string[] = []
  if (b !== 1) parts.push(`brightness(${b})`)
  if (c !== 1) parts.push(`contrast(${c})`)
  if (s !== 1) parts.push(`saturate(${s})`)
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`)
  return parts.join(' ')
}

/** Deterministic PRNG bytes (mulberry32) — grain must render identically every
 *  frame/bake or motion sequences shimmer. */
export function noiseBytes(seed: number, count: number): Uint8Array {
  let a = seed >>> 0
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 255
  }
  return out
}

/** Bloom bright pass: zero the alpha of every pixel whose luminance is below
 *  threshold. Hard cutoff — the subsequent blur softens the knee. */
export function brightPassInPlace(data: Uint8ClampedArray, threshold: number): void {
  const t = clamp01(threshold) * 255
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    if (lum < t) data[i + 3] = 0
  }
}

/** Gradient-map RGB toward shadows→highlights by luminance; alpha untouched. */
export function duotoneInPlace(
  data: Uint8ClampedArray,
  shadows: { r: number; g: number; b: number },
  highlights: { r: number; g: number; b: number },
  mix: number,
): void {
  const m = clamp01(mix)
  if (m === 0) return
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    data[i] = data[i]! + (shadows.r + (highlights.r - shadows.r) * lum - data[i]!) * m
    data[i + 1] = data[i + 1]! + (shadows.g + (highlights.g - shadows.g) * lum - data[i + 1]!) * m
    data[i + 2] = data[i + 2]! + (shadows.b + (highlights.b - shadows.b) * lum - data[i + 2]!) * m
  }
}

/** Radial-gradient stops (fractions of the half-diagonal) for a vignette.
 *  softness 0 still keeps a minimal ramp so the edge never bands. */
export function vignetteStops(size: number, softness: number): { inner: number; outer: number } {
  const inner = clamp01(size)
  const outer = Math.min(1.5, inner + Math.max(0.02, clamp01(softness)))
  return { inner, outer }
}

// ── Canvas chain (appended to frontend/app/lib/compositor/postEffects.ts) ────

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = mkCanvas(src.width, src.height)
  c.getContext('2d')?.drawImage(src, 0, 0)
  return c
}

// Cached 128×128 mid-gray noise tile. Fixed seed: grain must be identical
// across renders/bakes (motion frames would shimmer otherwise).
let _grainTile: HTMLCanvasElement | null = null
export function grainTile(): HTMLCanvasElement {
  if (_grainTile) return _grainTile
  const N = 128
  const c = mkCanvas(N, N)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const bytes = noiseBytes(0x5a1108, N * N)
  for (let i = 0; i < N * N; i++) {
    const v = bytes[i]!
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  _grainTile = c
  return c
}

/**
 * Apply the visible chain effects to an offscreen canvas, in the fixed order
 * adjust → duotone → bloom → vignette → grain. Mutates `off` in place; every
 * op runs in identity transform space (the caller's ctx transform is preserved).
 * `opts.W` = logical canvas width (normalized params scale by it);
 * `opts.scale` = device px per logical px (default 1 — pass the ctx transform's
 * `.a` when `off` is a device-resolution snapshot).
 */
export function applyEffectChain(
  off: HTMLCanvasElement,
  effects: PostEffect[],
  opts: { W: number; scale?: number },
): void {
  const fx = effects.filter(e => e.visible)
  if (!fx.length) return
  const ctx = off.getContext('2d')
  if (!ctx) return
  const scale = opts.scale ?? 1
  const find = <T extends PostEffect>(t: T['type']) => fx.find((e): e is T => e.type === t)

  const adjust = find<AdjustEffect>('adjust')
  if (adjust) {
    const f = adjustFilterString(adjust)
    if (f) {
      const src = cloneCanvas(off)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, off.width, off.height)
      ctx.filter = f
      ctx.drawImage(src, 0, 0)
      ctx.restore()
    }
  }

  const duotone = find<DuotoneEffect>('duotone')
  if (duotone && duotone.mix > 0) {
    const img = ctx.getImageData(0, 0, off.width, off.height)
    duotoneInPlace(img.data, hexToRgb(duotone.shadows), hexToRgb(duotone.highlights), duotone.mix)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.putImageData(img, 0, 0)
    ctx.restore()
  }

  const bloom = find<BloomEffect>('bloom')
  if (bloom && bloom.intensity > 0 && bloom.radius > 0) {
    const bp = cloneCanvas(off)
    const bctx = bp.getContext('2d')
    if (bctx) {
      const img = bctx.getImageData(0, 0, bp.width, bp.height)
      brightPassInPlace(img.data, bloom.threshold)
      bctx.putImageData(img, 0, 0)
      const blurred = mkCanvas(off.width, off.height)
      const blctx = blurred.getContext('2d')
      if (blctx) {
        blctx.filter = `blur(${Math.max(0, bloom.radius * opts.W * scale)}px)`
        blctx.drawImage(bp, 0, 0)
        blctx.filter = 'none'
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'lighter'
        const k = Math.min(2, Math.max(0, bloom.intensity))
        ctx.globalAlpha = Math.min(1, k)
        ctx.drawImage(blurred, 0, 0)
        if (k > 1) { ctx.globalAlpha = k - 1; ctx.drawImage(blurred, 0, 0) }
        ctx.restore()
      }
    }
  }

  const vignette = find<VignetteEffect>('vignette')
  if (vignette && vignette.amount > 0) {
    const w = off.width, h = off.height
    const R = Math.hypot(w, h) / 2
    const { inner, outer } = vignetteStops(vignette.size, vignette.softness)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // source-atop = clip to existing alpha, so a per-layer vignette never
    // halos beyond the silhouette (doc snapshots are opaque where content is).
    ctx.globalCompositeOperation = 'source-atop'
    const g = ctx.createRadialGradient(w / 2, h / 2, inner * R, w / 2, h / 2, outer * R)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, vignette.amount))})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  const grain = find<GrainEffect>('grain')
  if (grain && grain.amount > 0) {
    const gc = mkCanvas(off.width, off.height)
    const gctx = gc.getContext('2d')
    if (gctx) {
      const pat = gctx.createPattern(grainTile(), 'repeat')
      if (pat) {
        const s = Math.max(1, grain.size) * scale
        gctx.save()
        gctx.scale(s, s)
        gctx.fillStyle = pat
        gctx.fillRect(0, 0, gc.width / s, gc.height / s)
        gctx.restore()
        gctx.globalCompositeOperation = 'destination-in'
        gctx.drawImage(off, 0, 0) // clip noise to the layer/content alpha
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'overlay'
        ctx.globalAlpha = Math.min(1, Math.max(0, grain.amount))
        ctx.drawImage(gc, 0, 0)
        ctx.restore()
      }
    }
  }
}

/**
 * Doc-level post pass: snapshot the device canvas, run the chain on it, stamp
 * it back in identity space. Called by paintLayerStack when `post` is active.
 */
export function applyStackPost(ctx: CanvasRenderingContext2D, post: PostEffect[], W: number): void {
  const dev = ctx.canvas
  const t = ctx.getTransform()
  const snap = mkCanvas(dev.width, dev.height)
  const sctx = snap.getContext('2d')
  if (!sctx) return
  sctx.drawImage(dev, 0, 0)
  applyEffectChain(snap, post, { W, scale: t.a || 1 })
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, dev.width, dev.height)
  ctx.drawImage(snap, 0, 0)
  ctx.restore()
}
