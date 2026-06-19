export interface TilePose { x: number; y: number; rot: number; side: number; textDir: number; jumper: number }
export interface Rgb { r: number; g: number; b: number }

export function streamerRadius(segmentCount: number, segmentSpace: number): number {
  return (segmentCount * segmentSpace) / Math.PI
}

/** Character slots in one full loop. */
export function streamerCycle(segmentCount: number, middleStretch: number): number {
  return Math.round(2 * segmentCount + 2 * segmentCount * middleStretch)
}

/**
 * STG ribbon 4-phase racetrack pose for character index `i` (loop-local space, before the
 * per-tile translate(0,-radius)+rotateX and ribbon offsets the effect applies). Ported from
 * sketch_ribbon.js: top straight → right semicircle → bottom straight → left semicircle.
 */
export function tilePose(i: number, segmentCount: number, segmentSpace: number, middleStretch: number): TilePose {
  const cycle = 2 * segmentCount + 2 * segmentCount * middleStretch
  const radius = streamerRadius(segmentCount, segmentSpace)
  const segmentLength = segmentCount * segmentSpace
  const sinStep = Math.PI / segmentCount
  const m = ((i % cycle) + cycle) % cycle
  const jumper = Math.floor(i / cycle)
  const straightTop = segmentCount * middleStretch
  let x: number, y: number, rot: number, side: number, textDir: number
  if (m <= straightTop) {
    x = m * segmentSpace; y = jumper * radius * 4; rot = 0; side = 1; textDir = -1
  } else if (m <= segmentCount + segmentCount * middleStretch) {
    const step = m - straightTop
    x = segmentLength * middleStretch; y = jumper * radius * 4; rot = step * sinStep; side = 1; textDir = -1
  } else if (m <= segmentCount + 2 * segmentCount * middleStretch) {
    const step = m - (straightTop + segmentCount)
    x = segmentLength * middleStretch - step * segmentSpace; y = radius * 2 + jumper * radius * 4; rot = 0; side = -1; textDir = 1
  } else {
    const step = m - (straightTop + segmentCount)
    x = 0; y = radius * 2 + jumper * radius * 4; rot = -step * sinStep + Math.PI * middleStretch; side = -1; textDir = 1
  }
  return { x, y, rot, side, textDir, jumper }
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(s, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

/**
 * Gradient color for window slot `slot` of `runLength`, banded across `stops` (STG setGradient):
 * the run is split into stops.length-1 equal bands and lerped within each. Returns rgb in 0..1.
 */
export function gradientColorAt(slot: number, runLength: number, stops: string[]): Rgb {
  if (stops.length <= 1) return hexToRgb(stops[0] ?? '#ffffff')
  const bands = stops.length - 1
  const f = Math.min(1, Math.max(0, runLength > 0 ? slot / runLength : 0)) * bands
  const idx = Math.min(bands - 1, Math.floor(f))
  const local = f - idx
  const a = hexToRgb(stops[idx]!), b = hexToRgb(stops[idx + 1]!)
  return { r: lerp(a.r, b.r, local), g: lerp(a.g, b.g, local), b: lerp(a.b, b.b, local) }
}
