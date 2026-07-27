/**
 * Paint — the compositor's fill/stroke value: a plain CSS color string, a
 * gradient, or a Type-Studio `Fill` (ombre/grid/noise/checkerboard/stripes/qr/
 * shader/…). Moved down from `composables/useCompositorLayers.ts` (which still
 * re-exports everything here for its ~40 existing importers) so CPU-only `lib/`
 * modules — namely `fillTile.ts`, whose `Fill` this type embeds — can reference
 * `Paint` without reaching up to a composable. Gradient geometry is
 * resolution-independent: it's resolved against a box at draw/tile time, so it
 * scales with whatever it's painting.
 *
 * CPU-only: no `three`, no DOM access at module scope (matches the contract in
 * `fillTile.ts`'s header — `paintTileBox` below only touches `document` inside
 * its own function body, exactly like `fillTileBox`/`fillTileCanvas` there).
 */
import { type Fill, effectiveTileFill, fillTileBox } from '~/lib/spacetype/fillTile'

export interface GradientStop { offset: number; color: string } // offset 0..1
export interface LinearGradient { type: 'linear'; angle: number; stops: GradientStop[] } // angle in degrees
export interface RadialGradient { type: 'radial'; stops: GradientStop[] }
export type Gradient = LinearGradient | RadialGradient
export type Paint = string | Gradient | Fill

export function isGradient(p: Paint | undefined): p is Gradient {
  return !!p && typeof p === 'object' && ((p as Gradient).type === 'linear' || (p as Gradient).type === 'radial')
}
// A Fill is distinguished from a Gradient by its `a`/`density` fields (Gradient has `stops`).
export function isFill(p: Paint | undefined): p is Fill {
  return !!p && typeof p === 'object' && 'a' in p && 'density' in p
}

/** Sort a gradient's stops by offset and clamp each to 0..1 (non-finite offsets sink to 0).
 *  Exported (not just internal) so `~/lib/shaderfill/descriptor.ts`'s `inputKey` can encode
 *  a gradient's stops in the SAME canonical order `paintTileBox` renders them in — sorting
 *  twice (once here, once by hand in the key) would let the two silently drift apart. */
export function sortedClampedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops]
    .map(s => ({ ...s, offset: Number.isFinite(s.offset) ? Math.max(0, Math.min(1, s.offset)) : 0 }))
    .sort((a, b) => a.offset - b.offset)
}

/**
 * Build a (w×h) tile for any `Paint` — the `Paint` equivalent of `fillTileBox`.
 * Three arms:
 *  - `string`   → flat fillStyle rect
 *  - `Gradient` → a `CanvasGradient` in CORNER-origin geometry (the tile spans
 *                 `[0,0]..[w,h]`, unlike `resolvePaint` in useCompositorLayers.ts,
 *                 which builds gradients CENTRED on the origin for its centred
 *                 shape-drawing convention — do not copy that geometry here)
 *  - `Fill`     → delegates to `fillTileBox` verbatim, routed through
 *                 `effectiveTileFill` first so a shader-typed fill unwraps to
 *                 its `input` instead of re-entering the field renderer
 *                 (mirrors `getInputTile`'s reentrancy guard)
 */
export function paintTileBox(paint: Paint, w: number, h: number): HTMLCanvasElement {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h))
  if (isFill(paint)) return fillTileBox(effectiveTileFill(paint), W, H)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  if (!isGradient(paint)) {
    ctx.fillStyle = paint; ctx.fillRect(0, 0, W, H); return c
  }
  const stops = sortedClampedStops(paint.stops)
  let g: CanvasGradient
  if (paint.type === 'radial') {
    const r = Math.max(W, H) / 2
    g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(r, 0.0001))
  } else {
    const rad = ((paint.angle ?? 0) * Math.PI) / 180
    const hx = (Math.cos(rad) * W) / 2
    const hy = (Math.sin(rad) * H) / 2
    g = ctx.createLinearGradient(W / 2 - hx, H / 2 - hy, W / 2 + hx, H / 2 + hy)
  }
  for (const s of stops) g.addColorStop(s.offset, s.color)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  return c
}

/** Pure helper (no canvas) so unit tests in the node/no-DOM vitest environment can
 *  exercise stop sorting + clamping without invoking `paintTileBox` itself. */
export const __test__ = { sortedClampedStops }
