const TAU = Math.PI * 2

export interface RibbonParams {
  rows: number
  rowSpacing: number
  zRotation: number      // max per-row twist (radians) at the outermost rows
  waveAmplitude: number  // world units of vertical undulation
  waveFrequency: number  // sine periods across one tile
  rowPhase: number       // wave phase shift between adjacent rows (0..1 of TAU)
  scrollSpeed: number    // relative scroll rate
  scrollCycles: number   // whole tiles scrolled per loop (integer ⇒ seamless)
  waveCycles: number     // whole wave cycles per loop (integer ⇒ seamless)
}

export interface RibbonRowState {
  y: number              // world Y of the row, centered on 0
  zRotation: number      // row twist in radians
  wavePhase: number      // radians, fed to the per-vertex sine in the shader/geometry
  scrollOffset: number   // 0..1 of one tile, applied to the texture U / geometry
}

/** Wrap any real into [0,1). */
export function wrap01(x: number): number {
  return x - Math.floor(x)
}

/** Repeat unit: uppercased (optional) text + a 3-space gap so tiles read apart. */
export function buildRibbonLabel(text: string, mode: 'upper' | 'as-typed'): string {
  const t = mode === 'upper' ? text.toUpperCase() : text
  return `${t}   `
}

/** How many label tiles cover `widthPx` given one tile is `tilePx` wide (min 2, +2 margin). */
export function tileCount(widthPx: number, tilePx: number): number {
  if (tilePx <= 0) return 2
  const raw = Math.ceil(widthPx / tilePx)
  return raw <= 1 ? 2 : raw + 2
}

/**
 * Per-row state at normalized loop time t01. Pure: depends only on (t01, row,
 * params). Seamlessness comes from scroll/wave advancing by INTEGER cycles over
 * t01 ∈ [0,1], so t01=0 and t01=1 land on the same phase.
 */
export function ribbonRowState(t01: number, row: number, p: RibbonParams): RibbonRowState {
  const n = Math.max(1, Math.floor(p.rows))
  const center = (n - 1) / 2
  const u = n === 1 ? 0 : (row - center) / center  // -1..1, 0 at the middle row

  const y = (row - center) * p.rowSpacing
  const zRotation = u * p.zRotation
  const rowPhaseRad = u * p.rowPhase * TAU
  const wavePhase = t01 * p.waveCycles * TAU + rowPhaseRad
  const scrollOffset = t01 * p.scrollSpeed * p.scrollCycles + u * p.rowPhase

  return { y, zRotation, wavePhase, scrollOffset }
}
