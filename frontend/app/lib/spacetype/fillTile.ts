/**
 * CPU-only fill primitives — the type, the parser, and the 2D-canvas tile builder.
 *
 * Extracted from fills.ts (which keeps the THREE/GPU texture builders) so consumers
 * that only paint into a 2D canvas — the Frame-modal compositor — can import the fill
 * model + `fillTileCanvas` WITHOUT pulling THREE into their bundle. fills.ts re-exports
 * everything here, so Type Studio importers are unchanged.
 */

export type FillType = 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise' | 'checkerboard' | 'stripes' | 'qr' | 'shader'
/** `a`/`b` drive the slot's fill (stripe); `textColor` is the solid colour for type on that row.
 *  `angle` (degrees) applies to `stripes`/`gradient`/`ombre`; `density` controls cell/stripe count. */
export interface Fill { type: FillType; a: string; b: string; textColor: string; angle: number; density: number; shader?: ShaderSpec }

/** A shader fill runs `input` through a catalog effect. `input` is NEVER itself a shader
 *  fill — depth-1 is enforced in normalizeFill, because unbounded nesting hangs the renderer. */
export interface ShaderSpec {
  effectId: string
  params: Record<string, number>
  anchor: 'object' | 'frame'
  speed: number
  input: Fill
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

/** Resolve the fill that should actually be rasterised by the CPU tile builders below. The
 *  shader renderer doesn't land until a later task, so — per spec — a shader fill degrades
 *  gracefully to its `input` fill rather than an empty/arbitrary shape: the user sees a plain
 *  gradient instead of a warped one, never nothing. Falls back to the default shader input if
 *  `shader` is somehow absent, and cannot loop even on a malformed/miscoerced object, because
 *  it only ever unwraps one level. */
export function effectiveTileFill(fill: Fill): Fill {
  if (fill.type !== 'shader') return fill
  const input = fill.shader?.input ?? DEFAULT_SHADER_SPEC.input
  return input.type === 'shader' ? DEFAULT_SHADER_SPEC.input : input
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
  if (type === 'shader' && depth > 0) type = DEFAULT_SHADER_SPEC.input.type
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
    input: normalizeFill(o.input ?? DEFAULT_SHADER_SPEC.input, depth + 1),
  }
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
    const rad = (fill.angle * Math.PI) / 180, hx = Math.cos(rad) * W / 2, hy = Math.sin(rad) * H / 2
    const g = ctx.createLinearGradient(W / 2 - hx, H / 2 - hy, W / 2 + hx, H / 2 + hy)
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
