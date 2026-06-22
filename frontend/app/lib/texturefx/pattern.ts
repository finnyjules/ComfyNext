import type { Params } from '~/lib/spacetype/effect'

export type RGBA = [number, number, number, number]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const out = (c: [number, number, number]): RGBA => [c[0], c[1], c[2], 1]

// Deterministic 0..1 hash of an integer cell index.
function hash1(i: number): number {
  let x = (i | 0) * 374761393 + 668265263
  x = (x ^ (x >>> 13)) * 1274126177
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

const posmod = (a: number, n: number) => ((a % n) + n) % n

export function latticeCell(lattice: string, cells: number, u: number, v: number) {
  let gx = u * cells
  let gy = v * cells
  const row = Math.floor(gy)
  const col = Math.floor(gx)
  if (lattice === 'brick' && posmod(row, 2) === 1) gx += 0.5
  // diagonal = independent half-cell offsets on both axes (odd rows shift x,
  // odd columns shift y) → a quincunx/diamond lattice. row & col are read from
  // the original grid, so the two offsets stay independent. Seamless for even cells.
  if (lattice === 'diagonal') {
    if (posmod(row, 2) === 1) gx += 0.5
    if (posmod(col, 2) === 1) gy += 0.5
  }
  const cx = posmod(Math.floor(gx), cells)
  const cy = posmod(Math.floor(gy), cells)
  return { cx, cy, fx: gx - Math.floor(gx), fy: gy - Math.floor(gy) }
}

// --- Truchet families ------------------------------------------------------
// Per-cell state ∈ {0,1} chosen by a seamless hash of the already-modded cell
// index (so it wraps), biased by rotBias. Each family is fully edge-connected
// and tiles seamlessly for any state combination.
function truchetColor(
  fam: string, fx: number, fy: number, cx: number, cy: number, state: number, tw: number,
  A: [number, number, number], B: [number, number, number], BG: [number, number, number],
): RGBA {
  if (fam === 'diagonal') {
    // state 0: split by main diagonal (ink below fy<fx); state 1: anti-diagonal.
    const side = state === 0 ? fy < fx : fy < 1 - fx
    return out(side ? A : B)
  }
  if (fam === 'weave') {
    // Warp (vertical, A) and weft (horizontal, B) bands; at crossings the
    // cell parity decides which is on top. Gaps show background. Bands span the
    // full cell so they connect across edges → seamless. Fixed band width.
    const bw = 0.62
    const inV = Math.abs(fx - 0.5) < bw * 0.5
    const inH = Math.abs(fy - 0.5) < bw * 0.5
    const warpOnTop = posmod(cx + cy, 2) === 0
    if (inV && inH) return out(warpOnTop ? A : B)
    if (inV) return out(A)
    if (inH) return out(B)
    return out(BG)
  }
  // arcs (Smith): two quarter-circle arcs joining edge midpoints. state 0 joins
  // corners (0,0)&(1,1); state 1 joins (1,0)&(0,1). Either way all four edge
  // midpoints are arc endpoints, so neighbours always connect → seamless.
  const c0x = state === 0 ? 0 : 1, c0y = 0
  const c1x = state === 0 ? 1 : 0, c1y = 1
  const d0 = Math.abs(Math.hypot(fx - c0x, fy - c0y) - 0.5)
  const d1 = Math.abs(Math.hypot(fx - c1x, fy - c1y) - 0.5)
  return (d0 < tw * 0.5 || d1 < tw * 0.5) ? out(A) : out(BG)
}

export function patternColor(p: Params, u: number, v: number): RGBA {
  const cells = Math.max(2, Math.round(Number(p.cells) || 8))
  const A = hexToRgb(String(p.colorA))
  const B = hexToRgb(String(p.colorB))
  const BG = hexToRgb(String(p.background))
  // seed is injected by textureDefaults()/Roll, not part of TEXTURE_CONTROLS
  const seed = Math.round(Number(p.seed) || 1)

  const { cx, cy, fx, fy } = latticeCell(String(p.lattice), cells, u, v)
  // One seamless per-cell hash (modded cx/cy) shared by truchet state + jitter swap.
  const cellHash = hash1(cx * 73856093 + cy * 19349663 + seed * 83492791)

  if (String(p.mode) === 'truchet') {
    const tw = Number(p.truchetWeight) || 0.18
    const rotBias = Number(p.rotBias)
    const bias = Number.isFinite(rotBias) ? rotBias : 0.5
    const state = cellHash < bias ? 0 : 1
    return truchetColor(String(p.tileFamily), fx, fy, cx, cy, state, tw, A, B, BG)
  }

  // Procedural motif path (only reached when mode !== 'truchet').
  const scale = Number(p.scale) || 0.7
  const lw = Number(p.lineWeight) || 0.12
  const jitter = Number(p.jitter) || 0
  const motif = String(p.motif)

  const swap = jitter > 0 && cellHash < jitter
  const ink: [number, number, number] = swap ? B : A
  const ink2: [number, number, number] = swap ? A : B

  switch (motif) {
    case 'stripes':
      // `scale` sets the stripe split point (fraction of each cell that is ink).
      return out(fx < scale ? ink : ink2)
    case 'dots': {
      const d = Math.hypot(fx - 0.5, fy - 0.5)
      return d < scale * 0.5 ? out(ink) : out(BG)
    }
    case 'grid':
      // Stroke only the top/left edge of each cell; the neighbor supplies the
      // other two edges, so seams stay single-width. Seamless by construction.
      return (fx < lw || fy < lw) ? out(ink) : out(BG)
    case 'checker':
    default:
      return out(posmod(cx + cy, 2) === 0 ? ink : ink2)
  }
}
