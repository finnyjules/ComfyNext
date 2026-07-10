/**
 * Expressive object layout — per-box placement for the CHILDREN of a container
 * (a Smart Layout section, or a Frame layer-group). Sibling to the word engine
 * (`./expressive`): words are 1-D (line bands + horizontal position); objects
 * are 2-D boxes with real width AND height, so they get their own placer.
 *
 * Each item keeps its own w/h; the engine only chooses an (x, y) top-left within
 * the container and a rotation. Deterministic (seed); reroll = bump the seed.
 * `scatter`/`pile` allow overlap (organic); `grid`/`corners` spread objects out.
 */

export type BoxPlacementRule = 'scatter' | 'grid' | 'pile' | 'corners'

export interface ExpressiveBoxParams {
  placement: BoxPlacementRule
  /** 0..1 — how far items stray from their anchor (cell centre / box centre). */
  jitter: number
  /** 0..1 — max tilt as a fraction of MAX_BOX_ROTATION_DEG. */
  rotation: number
  /** Grid columns; unset/0 ⇒ auto ceil(sqrt(n)). */
  columns?: number
  /** Distribute items edge-to-edge across the width, overriding placement + X jitter. */
  justifyX?: boolean
  /** Distribute items edge-to-edge down the height, overriding placement + Y jitter. */
  justifyY?: boolean
  seed: number
}

export interface BoxItem { id: string; w: number; h: number }
export interface PlacedBox { id: string; x: number; y: number; rotation: number }

export const MAX_BOX_ROTATION_DEG = 20

export function defaultExpressiveBoxParams(): ExpressiveBoxParams {
  return { placement: 'scatter', jitter: 0.6, rotation: 0.15, seed: 1 }
}

// Local mulberry32 — kept self-contained so this module has no dependencies and
// behaves identically on server (Satori) and browser.
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1)

export function layoutExpressiveBoxes(opts: {
  items: BoxItem[]
  boxWidth: number
  boxHeight: number
  params: ExpressiveBoxParams
}): PlacedBox[] {
  const { items, boxWidth: BW, boxHeight: BH, params } = opts
  const n = items.length
  if (!n) return []

  const jit = clamp01(params.jitter)
  const rotAmt = clamp01(params.rotation)
  const rng = mulberry32((params.seed | 0) ^ 0x27d4eb2f)

  const cols = Math.max(1, params.columns && params.columns > 0 ? Math.floor(params.columns) : Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const cellW = BW / cols
  const cellH = BH / rows
  // Corner anchors as fractions of the item's available slack.
  const CORNERS: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]]

  const out: PlacedBox[] = []
  for (let i = 0; i < n; i++) {
    const { id, w, h } = items[i]!
    const maxLeft = Math.max(0, BW - w)
    const maxTop = Math.max(0, BH - h)
    const rx = rng(), ry = rng(), rr = rng()

    let x: number, y: number
    switch (params.placement) {
      case 'grid': {
        const col = i % cols
        const row = Math.floor(i / cols)
        const roomX = Math.max(0, cellW - w)
        const roomY = Math.max(0, cellH - h)
        x = col * cellW + roomX / 2 + (rx - 0.5) * jit * roomX
        y = row * cellH + roomY / 2 + (ry - 0.5) * jit * roomY
        x = clamp(x, col * cellW, col * cellW + roomX)   // stay inside the cell → no overlap
        y = clamp(y, row * cellH, row * cellH + roomY)
        break
      }
      case 'corners': {
        const [cx, cy] = CORNERS[i % 4]!
        // Anchor to a corner, then jitter INWARD (away from the edge).
        x = cx * maxLeft + (cx === 0 ? 1 : -1) * rx * jit * maxLeft * 0.5
        y = cy * maxTop + (cy === 0 ? 1 : -1) * ry * jit * maxTop * 0.5
        break
      }
      case 'pile': {
        // Tight cluster near centre; small offsets so items overlap.
        const spread = 0.28
        x = maxLeft / 2 + (rx - 0.5) * jit * maxLeft * spread
        y = maxTop / 2 + (ry - 0.5) * jit * maxTop * spread
        break
      }
      case 'scatter':
      default: {
        // Centre at jitter 0; full spread across the box at jitter 1.
        x = maxLeft / 2 + (rx - 0.5) * jit * maxLeft
        y = maxTop / 2 + (ry - 0.5) * jit * maxTop
        break
      }
    }

    // Justify overrides an axis: distribute items edge-to-edge (item i at
    // i/(n-1) of the slack; single item → origin corner).
    if (params.justifyX) x = n > 1 ? (i / (n - 1)) * maxLeft : 0
    if (params.justifyY) y = n > 1 ? (i / (n - 1)) * maxTop : 0

    const rot = (rr - 0.5) * 2 * rotAmt * MAX_BOX_ROTATION_DEG
    out.push({
      id,
      x: clamp(x, 0, maxLeft),
      y: clamp(y, 0, maxTop),
      rotation: rot === 0 ? 0 : rot,   // normalise -0 → 0
    })
  }
  return out
}
