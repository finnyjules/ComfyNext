import type { Params } from '~/lib/spacetype/effect'

// The exported image ("sheet") and the seamless unit repeated inside it ("tile").
// Pattern Studio renders in four places — studio preview, studio export, node card,
// node headless bake — and every one of them gets its dimensions from here. Deriving
// them locally is how three render paths end up disagreeing.
export type Sheet = { w: number; h: number; tile: number }

/** One drawImage instruction in destination space. */
export type TileOp = { x: number; y: number; size: number }

/** The sheet is exactly one square tile — the pre-Output-tab behaviour, and the default. */
export const SHEET_PRESET_TILE = 'Tile · square'
/** The sheet comes from sheetW/sheetH. */
export const SHEET_PRESET_CUSTOM = 'Custom'

/** Fixed-size presets. Excludes the two special labels above, which are not sizes. */
export const SHEET_SIZES: Record<string, [number, number]> = {
  '1920 × 1080 (16:9)': [1920, 1080],
  '1080 × 1920 (9:16)': [1080, 1920],
  '2048 × 2048': [2048, 2048],
  '3840 × 2160 (4K)': [3840, 2160],
}

export const SHEET_PRESETS: string[] = [SHEET_PRESET_TILE, ...Object.keys(SHEET_SIZES), SHEET_PRESET_CUSTOM]

// Multiples of 64 only: DITHER_PERIOD (types.ts) goes up to 128, and stylizeTile seams
// unless the tile holds a whole number of dither periods. Capped at 2048 — a sheet of
// 2048 tiles is already 16MB of RGBA per tile before the repeat.
export const TILE_PX_OPTIONS: string[] = ['128', '256', '512', '1024', '2048']

const MIN_DIM = 64
const MAX_DIM = 8192

function clampDim(v: number): number {
  if (!Number.isFinite(v)) return 1024
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v)))
}

function clampTile(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1024
  return Math.max(MIN_DIM, Math.min(4096, Math.round(v / 64) * 64))
}

/**
 * Resolve the sheet from flat params. Custom reads sheetW/sheetH and MUST NOT consult
 * the size table — Space Type's dimsFromKey does exactly that and returns stale
 * dimensions for custom sizes.
 */
export function sheetFromParams(p: Params): Sheet {
  const tile = clampTile(Number(p.tilePx ?? 1024))
  const preset = String(p.sheetPreset ?? SHEET_PRESET_TILE)
  if (preset === SHEET_PRESET_CUSTOM) {
    return { w: clampDim(Number(p.sheetW ?? tile)), h: clampDim(Number(p.sheetH ?? tile)), tile }
  }
  const fixed = SHEET_SIZES[preset]
  if (fixed) return { w: fixed[0], h: fixed[1], tile }
  // Tile preset, and any label from a future/legacy build we don't recognise.
  return { w: tile, h: tile, tile }
}

/** How many tiles fit across and down — fractional on purpose, for the readout. */
export function repeatsFor(s: Sheet): { x: number; y: number } {
  return { x: s.w / s.tile, y: s.h / s.tile }
}

/** True when the exported PNG itself repeats edge-to-edge (both axes whole tiles). */
export function isTileable(s: Sheet): boolean {
  const r = repeatsFor(s)
  return Number.isInteger(r.x) && Number.isInteger(r.y)
}

/**
 * True when the user chose a real sheet rather than "just give me the tile".
 * The node card uses this to decide between a full-bleed material swatch and a
 * letterboxed frame — a bare tile has no aspect worth honouring.
 */
export function isSheetFramed(p: Params): boolean {
  return String(p.sheetPreset ?? SHEET_PRESET_TILE) !== SHEET_PRESET_TILE
}

/** Largest rect with the sheet's aspect that fits in boxW x boxH, centred. */
export function fitLetterbox(s: Sheet, boxW: number, boxH: number): { w: number; h: number; x: number; y: number } {
  const k = Math.min(boxW / s.w, boxH / s.h)
  const w = Math.max(1, Math.round(s.w * k))
  const h = Math.max(1, Math.round(s.h * k))
  return { w, h, x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2) }
}

/**
 * Repeat geometry in destination space. `destW` may be smaller than `s.w` — the tile
 * scales with it, so a preview of a 4K sheet costs a preview-sized canvas.
 * Partial repeats overdraw past the edge and get clipped by the canvas; that is what
 * "free crop" means.
 */
export function tilePositions(s: Sheet, destW: number, destH: number): TileOp[] {
  const size = s.tile * (destW / s.w)
  if (!(size > 0)) return []
  const cols = Math.ceil(destW / size)
  const rows = Math.ceil(destH / size)
  const ops: TileOp[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) ops.push({ x: c * size, y: r * size, size })
  }
  return ops
}

/** Repeat-fill `tile` across a destW x destH region of `ctx`, at the sheet's density. */
export function drawSheet(
  ctx: CanvasRenderingContext2D,
  tile: CanvasImageSource,
  s: Sheet,
  destW: number,
  destH: number,
): void {
  for (const op of tilePositions(s, destW, destH)) ctx.drawImage(tile, op.x, op.y, op.size, op.size)
}
