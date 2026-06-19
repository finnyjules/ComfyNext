export const DOODLE_KINDS = ['loop', 'spiral', 'zigzag', 'scribble', 'flick'] as const
export type DoodleKind = (typeof DOODLE_KINDS)[number]

export interface Doodle {
  kind: DoodleKind
  x: number; y: number          // center, canvas px
  scale: number                 // px
  rotation: number              // radians
  colorIndex: number            // raw seeded index; caller mods by palette length
  appearAt: number              // 0..1 reveal threshold (draw-on order)
  points: { x: number; y: number }[]  // local-space polyline, roughly within [-1,1]
}

/** Local-space stroke polyline for each doodle kind (centered at origin, ~unit radius). */
function strokePoints(kind: DoodleKind, rng: () => number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const N = 48
  switch (kind) {
    case 'loop': {
      const loops = 1 + Math.floor(rng() * 2)
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2 * loops
        const r = 0.4 + 0.5 * (i / N)
        pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * 0.7 })
      }
      break
    }
    case 'spiral': {
      const turns = 2 + rng() * 2
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2 * turns
        const r = (i / N)
        pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r })
      }
      break
    }
    case 'zigzag': {
      const teeth = 4 + Math.floor(rng() * 4)
      for (let i = 0; i <= teeth; i++) {
        pts.push({ x: -1 + (2 * i) / teeth, y: i % 2 === 0 ? -0.5 : 0.5 })
      }
      break
    }
    case 'scribble': {
      let x = -1, y = 0
      pts.push({ x, y })
      for (let i = 0; i < 12; i++) { x += -0.2 + rng() * 0.4 + 0.18; y = (rng() * 2 - 1) * 0.8; pts.push({ x, y }) }
      break
    }
    case 'flick': {
      pts.push({ x: -0.2, y: 1 }, { x: -0.2, y: -0.6 }, { x: 0.4, y: -1 }, { x: 0.6, y: -0.4 })
      break
    }
  }
  return pts
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Seeded scatter of doodles. Pure given the rng. Positions fall within `area` (a sub-rect of the
 * canvas); when omitted, the full width×height canvas is used.
 */
export function doodleField(
  rng: () => number, count: number, width: number, height: number, sizeRange: [number, number], area?: Rect,
): Doodle[] {
  const n = Math.max(0, Math.floor(count))
  const [smin, smax] = sizeRange
  const ax = area ? area.x : 0, ay = area ? area.y : 0, aw = area ? area.w : width, ah = area ? area.h : height
  const out: Doodle[] = []
  for (let i = 0; i < n; i++) {
    const kind = DOODLE_KINDS[Math.floor(rng() * DOODLE_KINDS.length) % DOODLE_KINDS.length]!
    out.push({
      kind,
      x: ax + rng() * aw,
      y: ay + rng() * ah,
      scale: smin + rng() * (smax - smin),
      rotation: (rng() * 2 - 1) * Math.PI,
      colorIndex: Math.floor(rng() * 1000),
      appearAt: rng(),
      points: strokePoints(kind, rng),
    })
  }
  return out
}
