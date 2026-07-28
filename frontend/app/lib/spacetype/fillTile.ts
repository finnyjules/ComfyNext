/**
 * CPU-only fill primitives — the type, the parser, and the 2D-canvas tile builder.
 *
 * Extracted from fills.ts (which keeps the THREE/GPU texture builders) so consumers
 * that only paint into a 2D canvas — the Frame-modal compositor — can import the fill
 * model + `fillTileCanvas` WITHOUT pulling THREE into their bundle. fills.ts re-exports
 * everything here, so Type Studio importers are unchanged.
 *
 * CIRCULAR IMPORT (intentional, safe): `~/lib/compositor/paint`'s `Paint`/`Gradient`
 * embed this module's `Fill`, and this module's `ShaderSpec.input` is `Paint` — so the
 * two modules import each other. Every cross-boundary value (`isGradient`/`isFill`
 * here, `effectiveTileFill`/`fillTileBox` there) is an `export function` declaration,
 * which ES modules hoist fully before either module's body runs, and neither module
 * calls the other's export at its own top level (only inside function bodies invoked
 * later) — so the cycle never observes a not-yet-initialized binding. Do not turn any
 * of these into `export const fn = () => …`, which is NOT hoisted and would break this.
 */
import { isGradient, isFill, sortedClampedStops, type Paint } from '~/lib/compositor/paint'
// The angle→axis trig for a linear gradient, shared with the SVG spine so a
// gradient tile and the `<linearGradient>` exported for it cannot drift. It is a
// pure numeric helper — importing it pulls no DOM, no model and no cycle
// (`lib/vector/svg` imports nothing at all).
import { gradientUnitAxis } from '~/lib/vector/svg'

export type FillType = 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise' | 'checkerboard' | 'stripes' | 'qr' | 'shader'
/** `a`/`b` drive the slot's fill (stripe); `textColor` is the solid colour for type on that row.
 *  `angle` (degrees) applies to `stripes`/`gradient`/`ombre`; `density` controls cell/stripe count. */
export interface Fill { type: FillType; a: string; b: string; textColor: string; angle: number; density: number; shader?: ShaderSpec }

/** A shader fill runs `input` through a catalog effect against any `Paint` — a flat
 *  colour, a linear/radial gradient, or another (non-shader) `Fill`. `input` is NEVER
 *  itself a shader-typed `Fill` — depth-1 is enforced in normalizeFill/normalizePaint,
 *  because unbounded nesting hangs the renderer. */
export interface ShaderSpec {
  effectId: string
  params: Record<string, number>
  anchor: 'object' | 'frame'
  speed: number
  input: Paint
}

/** All fill types, in picker order. SINGLE SOURCE OF TRUTH — imported by every fill dropdown. */
export const FILL_TYPES: FillType[] = ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr', 'shader']
export const DEFAULT_FILL: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }

export const DEFAULT_SHADER_SPEC: ShaderSpec = {
  effectId: 'fbm_warp', params: {}, anchor: 'object', speed: 1,
  input: { type: 'gradient', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 },
}

/** True when `f` is a shader fill actually carrying a spec (vs. `type: 'shader'` with no spec yet). */
export function fillIsShader(f: Fill): f is Fill & { shader: ShaderSpec } {
  return f.type === 'shader' && !!f.shader
}

/** Paint equivalent of `effectiveTileFill` below — unwraps a shader-typed `Fill` exactly
 *  one level so the shader-INPUT rasterisation path (`paintTileBox`, via `getInputTile`)
 *  never re-enters the field renderer with a stale descriptor. Passes a string, a
 *  `Gradient`, or a non-shader `Fill` through UNCHANGED (same reference) — only a
 *  shader-typed `Fill` is unwrapped. Never returns a shader-typed value: falls back to
 *  the default shader input if `shader` — or its own `input`, however deeply malformed —
 *  is somehow absent/shader-typed itself, and cannot loop because it only ever unwraps
 *  one level. Guard is explicit (`isFill(p) && p.type === 'shader'`) rather than relying
 *  on `undefined !== 'shader'`, so a non-Fill Paint can never accidentally satisfy it. */
export function effectiveTilePaint(p: Paint): Paint {
  if (!(isFill(p) && p.type === 'shader')) return p
  const input = p.shader?.input ?? DEFAULT_SHADER_SPEC.input
  return isFill(input) && input.type === 'shader' ? DEFAULT_SHADER_SPEC.input : input
}

/** Resolve the fill that should actually be rasterised by the FILL-ONLY CPU tile builders
 *  below (`fillTileCanvas`/`fillTileBox`) and the THREE seeds in fills.ts/materials.ts —
 *  every one of which can only paint a `Fill`, never a bare colour string or a `Gradient`.
 *  Delegates to `effectiveTilePaint` above (the general Paint-unwrap) so the two can never
 *  silently disagree about what a shader fill unwraps to; when that unwrap yields something
 *  that ISN'T a `Fill` (the shader's configured input is a `Gradient`/string, now that
 *  `ShaderSpec.input` accepts any `Paint`), there is no `Fill` representation of it for
 *  these CPU-only consumers to rasterise, so this degrades the same way the "shader somehow
 *  absent" case always has: the default shader input's plain gradient, never nothing. The
 *  live-field-capable callers (`getInputTile`, `paintTileBox`) use `effectiveTilePaint`
 *  directly instead, so a Gradient/string input is never lossily downgraded on THAT path. */
export function effectiveTileFill(fill: Fill): Fill {
  const p = effectiveTilePaint(fill)
  if (isFill(p)) return p
  // DEFAULT_SHADER_SPEC.input is documented to stay a Fill (see its own declaration
  // above) even though its STATIC type widened to Paint alongside ShaderSpec.input —
  // `isFill` re-narrows that guarantee for the type checker rather than casting past
  // it, with DEFAULT_FILL as an (unreachable in practice) belt-and-suspenders fallback.
  return isFill(DEFAULT_SHADER_SPEC.input) ? DEFAULT_SHADER_SPEC.input : DEFAULT_FILL
}

/** True when the fill needs a texture/pattern (anything but a flat colour). */
export function fillIsTextured(fill: Fill): boolean { return fill.type !== 'solid' }

/** Parse the JSON param string into a non-empty Fill[] (tolerant of junk/legacy values). */
export function parseFills(raw: unknown): Fill[] {
  if (typeof raw !== 'string' || !raw) return [{ ...DEFAULT_FILL }]
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return [{ ...DEFAULT_FILL }]
    return arr.map((f: unknown): Fill => normalizeFill(f))
  } catch { return [{ ...DEFAULT_FILL }] }
}

/** Coerce an unknown value into a valid Fill, filling defaults for missing/bad fields.
 *  `depth` tracks recursion into a shader fill's `input`: at depth 1 the `shader` type is
 *  refused (collapsed to the default shader input's type), enforcing depth-1 nesting. */
export function normalizeFill(f: unknown, depth = 0): Fill {
  const o = (f ?? {}) as Record<string, unknown>
  let type = FILL_TYPES.includes(o.type as FillType) ? (o.type as FillType) : 'solid'
  // Was `DEFAULT_SHADER_SPEC.input.type` — only meaningful while the default shader
  // input was guaranteed to be a Fill. Now that `ShaderSpec.input` is `Paint`, that
  // expression's static type is `Paint['type']`, which includes `undefined` (a bare
  // colour string has no `.type`) — neither `undefined` nor a Gradient's `'linear'`/
  // `'radial'` is a valid `FillType`. The literal is what the default has always
  // actually been (see DEFAULT_SHADER_SPEC above); spelling it out avoids depending on
  // that constant's shape staying a Fill forever.
  if (type === 'shader' && depth > 0) type = 'gradient'
  const base: Fill = {
    type,
    a: typeof o.a === 'string' ? o.a : '#ffffff',
    b: typeof o.b === 'string' ? o.b : '#000000',
    textColor: typeof o.textColor === 'string' ? o.textColor : '#ffffff',
    angle: typeof o.angle === 'number' ? o.angle : 45,
    density: typeof o.density === 'number' ? o.density : 8,
  }
  if (type !== 'shader') return base            // a spec on a non-shader fill is dropped
  return { ...base, shader: normalizeShaderSpec(o.shader, depth) }
}

/** Coerce an unknown value into a valid ShaderSpec, recursing into `input` at `depth + 1`
 *  so the depth-1 guard in normalizeFill applies to it. Exported so other config schemas that
 *  carry a bare `ShaderSpec` (not wrapped in a full `Fill`) — e.g. `shapefx/config.ts`'s
 *  `SurfaceFill.shader` — can reuse the same sanitizing/defaulting logic `normalizeFill` uses
 *  for its own `shader` field, rather than a second hand-rolled copy. Call with `depth: 0` at
 *  the top level. */
export function normalizeShaderSpec(s: unknown, depth: number): ShaderSpec {
  const o = (s ?? {}) as Record<string, unknown>
  const params: Record<string, number> = {}
  if (o.params && typeof o.params === 'object') {
    for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) params[k] = v
    }
  }
  return {
    effectId: typeof o.effectId === 'string' && o.effectId ? o.effectId : DEFAULT_SHADER_SPEC.effectId,
    params,
    anchor: o.anchor === 'frame' ? 'frame' : 'object',
    speed: typeof o.speed === 'number' && Number.isFinite(o.speed) ? o.speed : 1,
    input: normalizePaint(o.input ?? DEFAULT_SHADER_SPEC.input, depth + 1),
  }
}

/** Coerce an unknown value into a valid `Paint` — the `Paint`-widened sibling of
 *  `normalizeFill` for `ShaderSpec.input`. Routing order is a MIGRATION-SAFETY
 *  condition, not a style choice:
 *   1. a string passes through as-is (a flat CSS colour is already a valid Paint)
 *   2. an object shaped like a `Gradient` (`isGradient`) is normalised as one —
 *      offsets coerced to finite numbers clamped 0..1, colors coerced to strings,
 *      entries that aren't even shaped like a stop dropped outright; an empty result
 *      falls back to the default shader input (never an empty-stops gradient); `angle`
 *      normalised for `linear`
 *   3. EVERYTHING ELSE — including `null`, `undefined`, and junk — falls through to
 *      `normalizeFill`, exactly as it always has. This is deliberately NOT gated on
 *      `isFill(p)`: `isFill` requires both `a` and `density` to be present, but a
 *      persisted or hand-edited `Fill` missing either field is currently *repaired* by
 *      `normalizeFill` (defaults fill the gap), not dropped. Gating on `isFill` here
 *      would instead route that same value to the Gradient-or-fallback arms above and
 *      silently drop it to `DEFAULT_SHADER_SPEC.input` — a real data loss on already-
 *      saved projects. Routing "by exclusion" (arms 1 and 2 first, everything else
 *      falls through) preserves `normalizeFill`'s existing total-function/repair
 *      behaviour exactly. */
export function normalizePaint(p: unknown, depth: number): Paint {
  if (typeof p === 'string') return p
  if (isGradient(p as Paint | undefined)) return normalizeGradient(p as Record<string, unknown>)
  return normalizeFill(p, depth)
}

function normalizeGradient(g: Record<string, unknown>): Paint {
  const rawStops = Array.isArray(g.stops) ? g.stops : []
  const stops = rawStops
    .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s: Record<string, unknown>) => ({
      offset: typeof s.offset === 'number' && Number.isFinite(s.offset) ? Math.max(0, Math.min(1, s.offset)) : 0,
      color: typeof s.color === 'string' ? s.color : '#000000',
    }))
  // DEFAULT_SHADER_SPEC.input is a Fill (a gradient-typed one), not a Gradient — an
  // empty stop array falls back to it directly, deliberately changing ARM rather than
  // producing a zero-stop Gradient, mirroring normalizeFill's own "coerce junk to
  // something valid, never throw" contract one level up at the Paint level.
  if (!stops.length) return DEFAULT_SHADER_SPEC.input
  const sorted = sortedClampedStops(stops)
  if (g.type === 'radial') return { type: 'radial', stops: sorted }
  const angle = typeof g.angle === 'number' && Number.isFinite(g.angle) ? g.angle : 0
  return { type: 'linear', angle, stops: sorted }
}

export function serializeFills(fills: Fill[]): string { return JSON.stringify(fills) }

/**
 * The representative solid colour of any Paint-like value (string | Gradient | Fill),
 * for code paths that can only take a flat CSS colour — SVG export, animated per-char
 * text, a caret. Structural (no type import): `a` ⇒ Fill, `stops` ⇒ Gradient.
 */
export function paintPrimaryColor(p: unknown, fallback = '#000000'): string {
  if (typeof p === 'string') return p
  if (p && typeof p === 'object') {
    const o = p as { a?: string; stops?: Array<{ color?: string }> }
    if (typeof o.a === 'string') return o.a
    if (Array.isArray(o.stops)) return o.stops[0]?.color ?? fallback
  }
  return fallback
}

/** Parse a `#rrggbb` (or `#rrggbbaa`) hex to raw sRGB bytes (canvas is sRGB — do NOT go
 *  through THREE.Color, whose components are linear-light and would write the wrong bytes).
 *  8-digit input has its alpha pair stripped first — bit-shifting the full 32-bit value would
 *  overflow to the wrong bytes rather than the rgb component. */
export function hexBytes(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.length === 8 ? h.slice(0, 6) : h
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Ombre: a GRAINY / pointillist A→B fade at `angle` degrees — each pixel is colB with probability
 *  = its position along the gradient (else colA), so the two colours mix as scattered dots whose
 *  density shifts across the fade (solid A → grain → solid B). Deterministic hash for stable dots. */
export function ombrePicker(w: number, h: number, angle: number): (px: number, py: number) => boolean {
  const rad = (angle * Math.PI) / 180, dx = Math.cos(rad), dy = Math.sin(rad)
  const cor = [0, w * dx, h * dy, w * dx + h * dy]
  const pmin = Math.min(...cor), range = (Math.max(...cor) - pmin) || 1
  return (px, py) => {
    const t = (px * dx + py * dy - pmin) / range            // 0→1 along the fade direction
    const hsh = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453
    return (hsh - Math.floor(hsh)) < t                       // colB density grows with t
  }
}

/** Per-pixel A/B image from a boolean picker — the shared core of every patterned tile. */
export function patternImageData(w: number, h: number, colA: [number, number, number], colB: [number, number, number], picker: (px: number, py: number) => boolean): ImageData {
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

/**
 * Build a tileable 2D canvas for a fill — the CPU companion to the THREE texture path.
 * `solid` returns a flat swatch; `gradient` a vertical A→B ramp; the rest reuse the same
 * pixel pickers as the GPU textures so the look matches. `shader` has no CPU renderer yet,
 * so it degrades to its `input` fill via `effectiveTileFill` (see there).
 */
export function fillTileCanvas(fillIn: Fill, size = 128): HTMLCanvasElement {
  const fill = effectiveTileFill(fillIn)
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  if (fill.type === 'solid') { ctx.fillStyle = fill.a; ctx.fillRect(0, 0, size, size); return c }
  if (fill.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, size); g.addColorStop(0, fill.a); g.addColorStop(1, fill.b)
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size); return c
  }
  if (fill.type === 'ombre') {
    ctx.putImageData(patternImageData(size, size, hexBytes(fill.a), hexBytes(fill.b), ombrePicker(size, size, fill.angle)), 0, 0)
    return c
  }
  if (fill.type === 'grid') {
    const d = Math.max(1, Math.round(fill.density)), step = size / d
    ctx.fillStyle = fill.a; ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = fill.b; ctx.lineWidth = Math.max(1, Math.round(6 * (3 / d)))
    for (let i = 0; i <= d; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke()
    }
    return c
  }
  const colA = hexBytes(fill.a), colB = hexBytes(fill.b), d = Math.max(2, Math.round(fill.density))
  const picker: (px: number, py: number) => boolean =
    fill.type === 'checkerboard' ? (px, py) => (Math.floor(px * d / size) + Math.floor(py * d / size)) % 2 === 1
    : fill.type === 'stripes' ? (() => {
        const rad = (fill.angle * Math.PI) / 180, dx = Math.cos(rad), dy = Math.sin(rad)
        return (px: number, py: number) => Math.floor((px * dx + py * dy) / (size / d)) % 2 !== 0
      })()
    : fill.type === 'noise' ? (px, py) => { const h = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453; return (h - Math.floor(h)) >= 0.5 }
    : (px, py) => { const cx = Math.floor(px * d / size), cy = Math.floor(py * d / size); const v = Math.sin(cx * 12.9898 + cy * 78.233 + cx * cy * 3.71) * 43758.5453; return (v - Math.floor(v)) > 0.45 }
  ctx.putImageData(patternImageData(size, size, colA, colB, picker), 0, 0)
  return c
}

/**
 * Box-aware tile: build a (w×h) tile sized to a shape's actual on-screen pixels, so
 * the fill stays CRISP (no upscaling a 128px tile) and patterns use SQUARE cells
 * (cell px = w/density, applied on both axes) so they never stretch on a non-square
 * shape. `gradient` honours `angle` here (the square `fillTileCanvas` is vertical-only);
 * `ombre` fades across the box at its angle. `shader` degrades to its `input` fill, same as
 * `fillTileCanvas` above. Used by the compositor's resolveFill.
 */
export function fillTileBox(fillIn: Fill, w: number, h: number): HTMLCanvasElement {
  const fill = effectiveTileFill(fillIn)
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h))
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  if (fill.type === 'solid') { ctx.fillStyle = fill.a; ctx.fillRect(0, 0, W, H); return c }
  if (fill.type === 'gradient') {
    // Corner-origin: the unit axis scaled onto the tile. Was `W/2 ± cos·W/2`
    // written out here, which is the same arithmetic — the shared helper is what
    // makes the SVG export the same GEOMETRY rather than the same intention.
    const ax = gradientUnitAxis(fill.angle)
    const g = ctx.createLinearGradient(ax.x1 * W, ax.y1 * H, ax.x2 * W, ax.y2 * H)
    g.addColorStop(0, fill.a); g.addColorStop(1, fill.b)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return c
  }
  if (fill.type === 'ombre') {
    ctx.putImageData(patternImageData(W, H, hexBytes(fill.a), hexBytes(fill.b), ombrePicker(W, H, fill.angle)), 0, 0)
    return c
  }
  const d = Math.max(1, Math.round(fill.density)), cell = Math.max(2, Math.round(W / d))
  if (fill.type === 'grid') {
    ctx.fillStyle = fill.a; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = fill.b; ctx.lineWidth = Math.max(1, Math.round(cell * 0.08))
    for (let x = 0; x <= W + cell; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y <= H + cell; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    return c
  }
  const colA = hexBytes(fill.a), colB = hexBytes(fill.b)
  const picker: (px: number, py: number) => boolean =
    fill.type === 'checkerboard' ? (px, py) => (Math.floor(px / cell) + Math.floor(py / cell)) % 2 === 1
    : fill.type === 'stripes' ? (() => {
        const rad = (fill.angle * Math.PI) / 180, dx = Math.cos(rad), dy = Math.sin(rad)
        return (px: number, py: number) => Math.floor((px * dx + py * dy) / cell) % 2 !== 0
      })()
    : fill.type === 'noise' ? (px, py) => { const v = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453; return (v - Math.floor(v)) >= 0.5 }
    : (px, py) => { const cx = Math.floor(px / cell), cy = Math.floor(py / cell); const v = Math.sin(cx * 12.9898 + cy * 78.233 + cx * cy * 3.71) * 43758.5453; return (v - Math.floor(v)) > 0.45 }
  ctx.putImageData(patternImageData(W, H, colA, colB, picker), 0, 0)
  return c
}
