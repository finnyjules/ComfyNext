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
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Toroidal, deterministic Truchet state field (0/1) for "structured" placement.
 * Seeds a hashed random field, then runs fixed coherence-weighted majority
 * smoothing passes (each cell adopts its 4 toroidal neighbours' majority with
 * probability `coherence`). Wraps because every index is taken mod `cells`.
 */
export function truchetStates(cells: number, seed: number, coherence: number): Uint8Array {
  const n = cells * cells
  const f = new Uint8Array(n)
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      f[y * cells + x] = hash1(x * 73856093 + y * 19349663 + seed * 83492791) < 0.5 ? 0 : 1
    }
  }
  const co = clamp01(coherence)
  const PASSES = 3
  for (let pass = 0; pass < PASSES; pass++) {
    const g = f.slice()
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (hash1(x * 26699 + y * 43889 + pass * 15485863 + seed * 2246822519) >= co) continue
        const up = f[((y - 1 + cells) % cells) * cells + x]
        const dn = f[((y + 1) % cells) * cells + x]
        const lf = f[y * cells + ((x - 1 + cells) % cells)]
        const rt = f[y * cells + ((x + 1) % cells)]
        const sum = up + dn + lf + rt
        if (sum >= 3) g[y * cells + x] = 1
        else if (sum <= 1) g[y * cells + x] = 0
        // sum === 2 is a tie → keep current state
      }
    }
    f.set(g)
  }
  return f
}

// Single-entry memo: patternColor is called per-pixel with fixed params per
// render, and only one Texture Studio renders at a time, so one slot suffices.
// (If coherence is ever animated frame-to-frame, widen this to an LRU.)
let _statesCache: { key: string, grid: Uint8Array } | null = null
function cachedStates(cells: number, seed: number, coherence: number): Uint8Array {
  const key = `${cells}|${seed}|${coherence}`
  if (!_statesCache || _statesCache.key !== key) _statesCache = { key, grid: truchetStates(cells, seed, coherence) }
  return _statesCache.grid
}

// Per-base-cell subdivision level (0 = whole-cell arc, 1 = 3×3 subdivided).
// A toroidal coherent value field thresholded at `subdivide`, so subdivided
// regions cluster and the tile wraps.
export function multiscaleLevels(cells: number, seed: number, subdivide: number): Uint8Array {
  const sd = clamp01(subdivide)
  const val = new Float64Array(cells * cells)
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) val[y * cells + x] = hash1(x * 60493 + y * 19990303 + seed * 6151)
  }
  // 2 plain box-blur passes (not truchetStates' stochastic majority): a smaller correlation radius keeps subdivided regions as compact clusters rather than large blobs.
  for (let pass = 0; pass < 2; pass++) {
    const blurred = val.slice()
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const up = val[((y - 1 + cells) % cells) * cells + x], dn = val[((y + 1) % cells) * cells + x]
        const lf = val[y * cells + ((x - 1 + cells) % cells)], rt = val[y * cells + ((x + 1) % cells)]
        blurred[y * cells + x] = (val[y * cells + x] + up + dn + lf + rt) / 5
      }
    }
    val.set(blurred)
  }
  const lvl = new Uint8Array(cells * cells)
  for (let i = 0; i < lvl.length; i++) lvl[i] = val[i] < sd ? 1 : 0
  return lvl
}

let _levelCache: { key: string, grid: Uint8Array } | null = null
function cachedLevels(cells: number, seed: number, subdivide: number): Uint8Array {
  const key = `${cells}|${seed}|${subdivide}`
  if (!_levelCache || _levelCache.key !== key) _levelCache = { key, grid: multiscaleLevels(cells, seed, subdivide) }
  return _levelCache.grid
}

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

// True where pixel (fx,fy) lies on one of the two quarter-circle arcs for `state`.
// state 0 joins corners (0,0)&(1,1); state 1 joins (1,0)&(0,1). Either way the
// arcs hit all four edge midpoints, so neighbours connect.
function arcCoverage(fx: number, fy: number, state: number, tw: number): boolean {
  const c0x = state === 0 ? 0 : 1, c0y = 0
  const c1x = state === 0 ? 1 : 0, c1y = 1
  const d0 = Math.abs(Math.hypot(fx - c0x, fy - c0y) - 0.5)
  const d1 = Math.abs(Math.hypot(fx - c1x, fy - c1y) - 0.5)
  return d0 < tw * 0.5 || d1 < tw * 0.5
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
  if (fam === 'maze') {
    // 10-PRINT: a straight diagonal per cell. state 0 → main diagonal '\' (corners
    // (0,0)-(1,1)); state 1 → anti-diagonal '/'. Lines end at cell corners, which
    // are shared with neighbours, so uniform/mixed states weave into a labyrinth.
    const d = state === 0 ? Math.abs(fy - fx) : Math.abs(fy - (1 - fx))
    return d < tw ? out(A) : out(BG)
  }
  if (fam === 'arcs2') {
    // Double Truchet arcs: two concentric quarter-circles (radius 0.5 ± gap) per
    // corner pair. Same edge-midpoint endpoints as `arcs`, so it stays connected.
    const c0x = state === 0 ? 0 : 1, c1x = state === 0 ? 1 : 0
    const gap = 0.16
    const onArc = (cx0: number, cy0: number) => {
      const d = Math.hypot(fx - cx0, fy - cy0)
      return Math.abs(d - (0.5 - gap)) < tw * 0.5 || Math.abs(d - (0.5 + gap)) < tw * 0.5
    }
    return (onArc(c0x, 0) || onArc(c1x, 1)) ? out(A) : out(BG)
  }
  if (fam === 'arcdot') {
    // Truchet arcs with a dot at each cell centre — reads as a connected pipe network
    // studded with rivets. Arc coverage OR a centre disc of radius ~tw.
    const dot = Math.hypot(fx - 0.5, fy - 0.5) < tw * 1.4
    return (dot || arcCoverage(fx, fy, state, tw)) ? out(A) : out(BG)
  }
  if (fam === 'weave') {
    // Warp (vertical, A) and weft (horizontal, B) bands. Band width follows the
    // line-weight control (tw); the over/under at each crossing is the cell
    // parity XOR the per-cell state, so coherence/placement vary the weave
    // (uniform state = a clean basket weave; mixed = irregular). Bands span the
    // full cell so they connect across edges → seamless.
    const bw = 0.44 + tw
    const inV = Math.abs(fx - 0.5) < bw * 0.5
    const inH = Math.abs(fy - 0.5) < bw * 0.5
    const warpOnTop = (posmod(cx + cy, 2) === 0) !== (state === 1)
    if (inV && inH) return out(warpOnTop ? A : B)
    if (inV) return out(A)
    if (inH) return out(B)
    return out(BG)
  }
  // arcs (Smith): two quarter-circle arcs joining edge midpoints. state 0 joins
  // corners (0,0)&(1,1); state 1 joins (1,0)&(0,1). Either way all four edge
  // midpoints are arc endpoints, so neighbours always connect → seamless.
  return arcCoverage(fx, fy, state, tw) ? out(A) : out(BG)
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

    if (String(p.tileFamily) === 'multiscale') {
      const level = cachedLevels(cells, seed, clamp01(Number(p.subdivide) || 0))[cy * cells + cx]
      let lfx = fx, lfy = fy, sub = 0
      if (level >= 1) {
        const sx = Math.min(2, Math.floor(fx * 3)), sy = Math.min(2, Math.floor(fy * 3)) // clamp guards fx===1.0 at the UV seam (floor(3)=3 → index 2)
        lfx = fx * 3 - sx; lfy = fy * 3 - sy; sub = sx * 3 + sy + 1 // sub: 0 = whole cell, 1-9 = row-major 3×3 sub-cell index (+1), so each sub-cell hashes to its own arc orientation
      }
      const st = hash1(cx * 73856093 + cy * 19349663 + sub * 50331653 + seed * 83492791) < 0.5 ? 0 : 1
      return arcCoverage(lfx, lfy, st, tw) ? out(A) : out(BG)
    }

    let state: number
    if (String(p.placement) === 'structured') {
      const grid = cachedStates(cells, seed, clamp01(Number(p.coherence) || 0))
      state = grid[cy * cells + cx]
    } else {
      const rotBias = Number(p.rotBias)
      const bias = Number.isFinite(rotBias) ? rotBias : 0.5
      state = cellHash < bias ? 0 : 1
    }
    return truchetColor(String(p.tileFamily), fx, fy, cx, cy, state, tw, A, B, BG)
  }

  // Procedural motif path (only reached when mode !== 'truchet').
  const scale = Number(p.scale) || 0.7
  const lw = Number(p.lineWeight) || 0.12
  const jitter = Number(p.jitter) || 0
  const motif = String(p.motif)
  // Shared knobs for the appended figure motifs. `bands` = concentric-band /
  // wave-cycle count; `waveAmp` = wave line amplitude; `majorEvery` = graph-paper
  // heavy-line interval. Every figure below is a pure function of the cell-local
  // (fx,fy) plus modded (cx,cy), so it wraps at the tile edge by construction.
  const bands = Math.max(1, Math.round(Number(p.bands) || 6))
  const waveAmp = Number.isFinite(Number(p.waveAmp)) ? Number(p.waveAmp) : 0.3
  const rtri = (x: number) => Math.abs(2 * (x - Math.floor(x)) - 1)

  const swap = jitter > 0 && cellHash < jitter
  const ink: [number, number, number] = swap ? B : A
  const ink2: [number, number, number] = swap ? A : B

  switch (motif) {
    case 'rings': {
      // Concentric circles centred in each cell (Euclidean distance banding).
      const bi = Math.floor(Math.hypot(fx - 0.5, fy - 0.5) * 2 * bands)
      return out(posmod(bi, 2) === 0 ? A : BG)
    }
    case 'squares': {
      // Concentric squares (Chebyshev distance banding).
      const bi = Math.floor(Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5)) * 2 * bands)
      return out(posmod(bi, 2) === 0 ? A : BG)
    }
    case 'diamonds': {
      // Concentric diamonds (Manhattan distance banding).
      const bi = Math.floor((Math.abs(fx - 0.5) + Math.abs(fy - 0.5)) * 2 * bands)
      return out(posmod(bi, 2) === 0 ? A : BG)
    }
    case 'waves': {
      // Sine wave line, `bands` humps per cell. Endpoints sit at fy=0.5 (sin=0 at the
      // integer-frequency cell edges), so lines join left↔right into continuous waves.
      const curve = 0.5 + waveAmp * Math.sin(fx * 2 * Math.PI * bands)
      return out(Math.abs(fy - curve) < lw ? A : BG)
    }
    case 'zigzag': {
      // Triangle-wave line (chevron rows). rtri peaks at the integer-frequency cell
      // edges, so adjacent cells connect at a shared peak.
      const curve = 0.5 + waveAmp * (2 * rtri(fx * bands) - 1)
      return out(Math.abs(fy - curve) < lw ? A : BG)
    }
    case 'cross': {
      // A plus sign centred in each cell; arms half-width = line weight.
      return out((Math.abs(fx - 0.5) < lw || Math.abs(fy - 0.5) < lw) ? A : BG)
    }
    case 'graph': {
      // Graph paper: thin minor rule on every cell's top/left edge (like `grid`),
      // heavier major rule every `majorEvery` cells. major → A, minor → B, ground → BG.
      const major = Math.max(2, Math.round(Number(p.majorEvery) || 4))
      const minorW = Math.min(0.45, lw)
      const majorW = Math.min(0.49, lw * 1.8)
      const onMajor = (posmod(cx, major) === 0 && fx < majorW) || (posmod(cy, major) === 0 && fy < majorW)
      const onMinor = fx < minorW || fy < minorW
      return out(onMajor ? A : onMinor ? B : BG)
    }
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
