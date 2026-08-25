import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHIP_INK_ROLES, CHIP_NEIGHBORHOOD, CHIP_R_MAX, CHIP_R_MIN, CHIP_TONE_RANGE,
  CHIP_SALT_X, CHIP_SALT_Y, CHIP_SALT_R, CHIP_SALT_ROLE, CHIP_SALT_TONE,
  chipFeature, chipHash, chipSample, chipTone, patternColor, type RGBA,
} from '~/lib/texturefx/pattern'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { rolesFor } from '~/lib/texturefx/roles'
import { MODES } from '~/lib/texturefx/types'
import { describeTexture } from '~/lib/agent/surfaces/texture'
import { TEXTURE_FS, chipSaltLanes } from '~/lib/texturefx/renderer'
import { TEXTURE_GUIDANCE } from '~/lib/agent/studioTune'

// studioTune.ts pulls in ofetch's $fetch at module scope; nothing here calls a
// tuner, so the mock only has to satisfy the import (same as scene3d-registry).
vi.mock('ofetch', () => ({ $fetch: vi.fn() }))

// --- helpers ---------------------------------------------------------------

const chipParams = (over: Record<string, unknown> = {}) => ({
  ...textureDefaults(), mode: 'chips', seed: 7, ...over,
}) as any

/** The role field on an N×N sample grid (pixel centres, so no seam sampling). */
function roleField(p: any, n = 32): number[] {
  const cells = Number(p.chipCells), seed = Number(p.seed)
  const grout = Number(p.chipGrout), sizeVar = Number(p.chipSizeVar)
  const out: number[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out.push(chipSample((x + 0.5) / n, (y + 0.5) / n, cells, seed, grout, sizeVar).role)
    }
  }
  return out
}

function groundShare(p: any, n = 48): number {
  const f = roleField(p, n)
  return f.filter(r => r === CHIP_INK_ROLES).length / f.length
}

/** Coefficient of variation of per-chip pixel counts (how uneven the chips are). */
function areaCV(p: any, n = 64): number {
  const cells = Number(p.chipCells), seed = Number(p.seed)
  const counts = new Map<string, number>()
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = chipSample((x + 0.5) / n, (y + 0.5) / n, cells, seed, 0, Number(p.chipSizeVar))
      const k = `${s.cellX},${s.cellY}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  // Cells that won no pixel still count as chips of area 0.
  const areas: number[] = []
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) areas.push(counts.get(`${cx},${cy}`) ?? 0)
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length
  const varc = areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length
  return Math.sqrt(varc) / mean
}

const eqRGBA = (a: RGBA, b: RGBA) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9)
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// --- mode registration -----------------------------------------------------

describe('chips mode registration', () => {
  it('appends chips to MODES without moving the existing indices', () => {
    // renderer.ts dispatches on MODES.indexOf(mode) — appending keeps saved scenes valid.
    expect(MODES.indexOf('procedural' as any)).toBe(0)
    expect(MODES.indexOf('truchet' as any)).toBe(1)
    expect(MODES.indexOf('raster' as any)).toBe(2)
    expect(MODES.indexOf('shapes' as any)).toBe(3)
    expect(MODES.includes('chips' as any)).toBe(true)
  })

  it('rolesFor: chips resolves to the ink roles + ground', () => {
    const roles = rolesFor({ mode: 'chips' } as any)
    expect(roles).toEqual(['chipA', 'chipB', 'ground'])
    // The ground role index the CPU math emits must be the LAST role in the list.
    expect(roles.length).toBe(CHIP_INK_ROLES + 1)
  })
})

// --- controls (the factory's only declaration) -----------------------------

describe('chips controls', () => {
  const find = (k: string) => TEXTURE_CONTROLS.find(c => c.key === k)!

  it('declares chipCells / chipGrout / chipSizeVar with the spec ranges', () => {
    expect(find('chipCells')).toMatchObject({ kind: 'slider', min: 4, max: 24, step: 1, default: 12, group: 'Chips' })
    expect(find('chipGrout')).toMatchObject({ kind: 'slider', min: 0, max: 0.25, step: 0.005, default: 0.05, group: 'Chips' })
    expect(find('chipSizeVar')).toMatchObject({ kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Chips' })
  })

  it('reveals the Chips group only in chips mode', () => {
    const proc = textureDefaults()
    const chips = chipParams()
    for (const k of ['chipCells', 'chipGrout', 'chipSizeVar']) {
      expect(find(k).when!(proc), `${k} in procedural`).toBe(false)
      expect(find(k).when!(chips), `${k} in chips`).toBe(true)
    }
  })

  it('colour jitter is shared by procedural and chips', () => {
    expect(find('jitter').when!(textureDefaults())).toBe(true)
    expect(find('jitter').when!(chipParams())).toBe(true)
    expect(find('jitter').when!({ ...textureDefaults(), mode: 'truchet' })).toBe(false)
  })

  it('hides the lattice controls in chips mode (chips are not a lattice)', () => {
    expect(find('cells').when!(chipParams())).toBe(false)
    expect(find('lattice').when!(chipParams())).toBe(false)
    expect(find('cells').when!(textureDefaults())).toBe(true)
  })

  it('DELIBERATE GRANT: the three chip controls are agent-visible', () => {
    // Opt-out model — a new control reaches the agent unless it is hidden. This
    // test is the characterization: chipCells/chipGrout/chipSizeVar are tunable
    // by the agent on purpose (see the terrazzo recipe in the tuner guidance).
    const settings = describeTexture({ params: chipParams() }).objects.find(o => o.type === 'settings')!
    const keys = (settings.current as any).controls.map((c: any) => c.key)
    expect(keys).toContain('chipCells')
    expect(keys).toContain('chipGrout')
    expect(keys).toContain('chipSizeVar')
    expect(keys).toContain('jitter')
  })
})

// --- determinism -----------------------------------------------------------

describe('chips determinism', () => {
  it('same seed → identical role field; different seed → a different one', () => {
    const a = roleField(chipParams({ seed: 11 }))
    const b = roleField(chipParams({ seed: 11 }))
    expect(a).toEqual(b)
    const c = roleField(chipParams({ seed: 12 }))
    expect(c).not.toEqual(a)
  })

  it('the same params render the same colours twice (no hidden state)', () => {
    const p = chipParams({ jitter: 0.8 })
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.5], [0.92, 0.04]]) {
      expect(eqRGBA(patternColor(p, u!, v!), patternColor(p, u!, v!))).toBe(true)
    }
  })
})

// --- seamlessness ----------------------------------------------------------

describe('chips seamlessness', () => {
  const RING = Array.from({ length: 41 }, (_, i) => i / 40)

  it('the role field wraps at u∈{0,1} and v∈{0,1}', () => {
    for (const cells of [4, 7, 12, 24]) {
      for (const t of RING) {
        const l = chipSample(0, t, cells, 5, 0.06, 0.7)
        const r = chipSample(1, t, cells, 5, 0.06, 0.7)
        expect(l.role, `x-wrap role @ v=${t} cells=${cells}`).toBe(r.role)
        expect(`${l.cellX},${l.cellY}`, `x-wrap owner @ v=${t} cells=${cells}`).toBe(`${r.cellX},${r.cellY}`)
        const b = chipSample(t, 0, cells, 5, 0.06, 0.7)
        const u = chipSample(t, 1, cells, 5, 0.06, 0.7)
        expect(b.role, `y-wrap role @ u=${t} cells=${cells}`).toBe(u.role)
        expect(`${b.cellX},${b.cellY}`, `y-wrap owner @ u=${t} cells=${cells}`).toBe(`${u.cellX},${u.cellY}`)
      }
    }
  })

  it('the rendered colour wraps too', () => {
    const p = chipParams({ chipCells: 9, jitter: 0.7 })
    for (const t of RING) {
      expect(eqRGBA(patternColor(p, 0, t), patternColor(p, 1, t)), `x @ v=${t}`).toBe(true)
      expect(eqRGBA(patternColor(p, t, 0), patternColor(p, t, 1)), `y @ u=${t}`).toBe(true)
    }
  })
})

// --- input correlation -----------------------------------------------------

describe('chips input correlation', () => {
  it('wider grout → strictly more ground', () => {
    const shares = [0, 0.02, 0.05, 0.1, 0.2].map(g => groundShare(chipParams({ chipGrout: g })))
    expect(shares[0]).toBe(0)
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]!, `grout step ${i}: ${shares[i - 1]} → ${shares[i]}`).toBeGreaterThan(shares[i - 1]!)
    }
    expect(shares[shares.length - 1]!).toBeLessThan(1)
  })

  it('size variance 0 → far more even chips than size variance 1', () => {
    const even = areaCV(chipParams({ chipSizeVar: 0 }))
    const wild = areaCV(chipParams({ chipSizeVar: 1 }))
    expect(even).toBeGreaterThan(0)          // random feature points are never a perfect grid
    expect(wild).toBeGreaterThan(even * 1.5) // ...but hashed radii make them far more uneven
  })

  it('more chips across → smaller chips (mean pixel area falls)', () => {
    const meanArea = (cells: number) => {
      const n = 64
      const counts = new Map<string, number>()
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const s = chipSample((x + 0.5) / n, (y + 0.5) / n, cells, 7, 0, 0.7)
        counts.set(`${s.cellX},${s.cellY}`, (counts.get(`${s.cellX},${s.cellY}`) ?? 0) + 1)
      }
      return (n * n) / counts.size
    }
    expect(meanArea(20)).toBeLessThan(meanArea(6))
  })
})

// --- roles + colour --------------------------------------------------------

describe('chips roles and colour', () => {
  it('only the declared role indices appear, and every one of them does', () => {
    const seen = new Set(roleField(chipParams({ chipGrout: 0.08 }), 64))
    expect([...seen].every(r => r >= 0 && r <= CHIP_INK_ROLES)).toBe(true)
    expect(seen.size).toBe(CHIP_INK_ROLES + 1)   // both inks AND ground are present
  })

  it('jitter 0 → exactly the role colours (no off-palette pixels)', () => {
    const p = chipParams({ jitter: 0, chipGrout: 0.08, colorA: '#c94f3d', colorB: '#3d6bc9', background: '#f2ede4' })
    const palette: RGBA[] = [[...hex('#c94f3d'), 1] as RGBA, [...hex('#3d6bc9'), 1] as RGBA, [...hex('#f2ede4'), 1] as RGBA]
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const c = patternColor(p, (x + 0.5) / 24, (y + 0.5) / 24)
        expect(palette.some(q => eqRGBA(c, q)), `pixel ${x},${y} = ${c.join(',')}`).toBe(true)
      }
    }
  })

  it('jitter never clips a light palette flat (the studio DEFAULT colours)', () => {
    // Regression: a multiplicative gain drove 27.5% of default chipA (#e8eef5)
    // pixels to pure white at jitter 1, collapsing 69 chip tones into 49 colours
    // — the lightest quarter of the terrazzo went flat. chipTone mixes toward an
    // endpoint instead, so no pixel can leave the 0..1 cube and every distinct
    // tone survives as a distinct colour.
    const p = chipParams({ jitter: 1 })   // default palette: #e8eef5 / #7aa2f7 / #0e1116
    const tones = new Set<number>(), colours = new Set<string>()
    let clipped = 0
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const u = (x + 0.5) / 64, v = (y + 0.5) / 64
        const s = chipSample(u, v, Number(p.chipCells), Number(p.seed), Number(p.chipGrout), Number(p.chipSizeVar))
        if (s.role !== 0) continue        // the light ink role is where clipping bit
        tones.add(s.tone)
        const c = patternColor(p, u, v)
        if (c[0] >= 1 && c[1] >= 1 && c[2] >= 1) clipped++
        if (c[0] <= 0 && c[1] <= 0 && c[2] <= 0) clipped++
        colours.add(c.map(n => n.toFixed(6)).join(','))
      }
    }
    expect(tones.size).toBeGreaterThan(40)          // a real sample of chips, not two
    expect(clipped, 'pixels crushed to pure white/black').toBe(0)
    expect(colours.size).toBe(tones.size)           // every tone = its own colour
  })

  it('chipTone is clip-free for the extreme palettes (white and black chips)', () => {
    for (const c of [[1, 1, 1], [0, 0, 0]] as [number, number, number][]) {
      for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
        const t = chipTone(c, tone, 1)
        expect(t.every(v => v >= 0 && v <= 1), `${c} tone ${tone} → ${t}`).toBe(true)
      }
    }
    // …and jitter 0 is the identity, to the bit.
    expect(chipTone([0.31, 0.62, 0.93], 0.9, 0)).toEqual([0.31, 0.62, 0.93])
  })

  it('jitter > 0 → chips shift in tone but the ground stays exact', () => {
    const base = { chipGrout: 0.08, colorA: '#c94f3d', colorB: '#3d6bc9', background: '#f2ede4' }
    const p = chipParams({ ...base, jitter: 1 })
    const ground: RGBA = [...hex('#f2ede4'), 1] as RGBA
    let offPalette = 0, groundPixels = 0
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const u = (x + 0.5) / 24, v = (y + 0.5) / 24
        const s = chipSample(u, v, Number(p.chipCells), Number(p.seed), Number(p.chipGrout), Number(p.chipSizeVar))
        const c = patternColor(p, u, v)
        if (s.role === CHIP_INK_ROLES) { groundPixels++; expect(eqRGBA(c, ground)).toBe(true) }
        else if (!eqRGBA(c, [...hex('#c94f3d'), 1] as RGBA) && !eqRGBA(c, [...hex('#3d6bc9'), 1] as RGBA)) offPalette++
      }
    }
    expect(groundPixels).toBeGreaterThan(0)
    expect(offPalette).toBeGreaterThan(50)     // jitter really varies chip tone
  })
})

// --- hand-computed / independently brute-forced case -----------------------

describe('chips: pinned hash + independent brute force', () => {
  // A 2×2 grid, seed 3, no size variance: small enough to reason about by hand.
  // These four feature points are FROZEN literals — if the hash or the salts
  // change, every saved terrazzo reshuffles, and this fails first.
  const PINNED: Record<string, [number, number]> = {
    '0,0': [0.6705462061210596, 0.9461013283049056],
    '1,0': [0.6845809291239107, 0.10155403213832415],
    '0,1': [0.6235929105654918, 0.47105750874413843],
    '1,1': [0.6126190208237858, 0.15313794697146932],
  }

  it('chipFeature returns the pinned points, radius exactly 1 at sizeVar 0', () => {
    for (const [key, xy] of Object.entries(PINNED)) {
      const [cx, cy] = key.split(',').map(Number) as [number, number]
      const f = chipFeature(cx, cy, 3, 0)
      expect(f.x).toBeCloseTo(xy[0], 12)
      expect(f.y).toBeCloseTo(xy[1], 12)
      expect(f.r).toBe(1)
    }
  })

  it('hand arithmetic: the tile centre belongs to the nearest of the four points', () => {
    // At cells=2 the tile centre is (gx,gy) = (1,1). The feature point of cell
    // (cx,cy) sits at (cx + fx, cy + fy); at sizeVar 0 every radius is 1, so the
    // weighted distance is plain distance. Using the pinned points above:
    //   (0,0) → (0.6705, 0.9461)  d = |(0.3295, 0.0539)| = 0.3338  ← nearest
    //   (0,1) → (0.6236, 1.4711)  d = |(0.3764, 0.4711)| = 0.6030  ← runner-up
    //   (1,1) → (1.6126, 1.1531)  d = |(0.6126, 0.1531)| = 0.6315
    //   (1,0) → (1.6846, 0.1016)  d = |(0.6846, 0.8984)| = 1.1295
    // Every wrapped image of those points (±2 cells) is further away than 1.1.
    const s = chipSample(0.5, 0.5, 2, 3, 0, 0)
    expect([s.cellX, s.cellY]).toEqual([0, 0])
    expect(s.f1).toBeCloseTo(0.3338, 3)
    expect(s.f2).toBeCloseTo(0.6030, 3)
    // F2 − F1 = 0.269 — wider than the widest grout the control allows, so the
    // tile centre stays a chip however far the grout slider is pushed.
    expect(chipSample(0.5, 0.5, 2, 3, 0.25, 0).role).toBeLessThan(CHIP_INK_ROLES)

    // Halfway between those same two feature points, F1 and F2 are equal by
    // construction, so ANY positive grout makes that pixel ground:
    //   midpoint = ((0.6705+0.6236)/2, (0.9461+1.4711)/2) = (0.6471, 1.2086)
    //   → u = 0.6471/2 = 0.32355, v = 1.2086/2 = 0.6043
    const mid = chipSample(0.32355, 0.6043, 2, 3, 0.005, 0)
    expect(mid.f2 - mid.f1).toBeLessThan(0.005)
    expect(mid.role).toBe(CHIP_INK_ROLES)
    expect(chipSample(0.32355, 0.6043, 2, 3, 0, 0).role).toBeLessThan(CHIP_INK_ROLES) // grout 0 = no grout at all
  })

  it('agrees with a GLOBAL toroidal brute force (every cell × 9 tile images)', () => {
    // Deliberately a different algorithm from the implementation: instead of a
    // local neighbourhood window it searches every feature point in a 3×3 block
    // of tile copies. If the window were too small, or the wrap wrong, the two
    // would disagree.
    const brute = (u: number, v: number, C: number, seed: number, grout: number, sizeVar: number) => {
      const gx = u * C, gy = v * C
      let best = Infinity, bestId = '', second = Infinity
      const cands: { d: number; id: string }[] = []
      for (let cy = 0; cy < C; cy++) {
        for (let cx = 0; cx < C; cx++) {
          const f = chipFeature(cx, cy, seed, sizeVar)
          for (let ty = -1; ty <= 1; ty++) {
            for (let tx = -1; tx <= 1; tx++) {
              const px = cx + f.x + tx * C, py = cy + f.y + ty * C
              cands.push({ d: Math.hypot(gx - px, gy - py) / f.r, id: `${cx},${cy}` })
            }
          }
        }
      }
      for (const c of cands) if (c.d < best) { best = c.d; bestId = c.id }
      for (const c of cands) if (c.id !== bestId && c.d < second) second = c.d
      return { id: bestId, ground: second - best < grout }
    }
    for (const [C, sizeVar] of [[2, 0], [2, 0.7], [7, 0], [7, 1], [12, 1]] as [number, number][]) {
      for (let y = 0; y < 21; y++) {
        for (let x = 0; x < 21; x++) {
          const u = (x + 0.37) / 21, v = (y + 0.61) / 21
          const s = chipSample(u, v, C, 3, 0.06, sizeVar)
          const b = brute(u, v, C, 3, 0.06, sizeVar)
          expect(`${s.cellX},${s.cellY}`, `owner @ ${u},${v} cells=${C} sizeVar=${sizeVar}`).toBe(b.id)
          expect(s.role === CHIP_INK_ROLES, `ground @ ${u},${v} cells=${C} sizeVar=${sizeVar}`).toBe(b.ground)
        }
      }
    }
  })

  it('the search window is wide enough to be mirrored in GLSL as a fixed loop', () => {
    expect(CHIP_NEIGHBORHOOD).toBe(2)   // 5×5 — the shader twin loops the same bounds
  })

  it('the radius range stays inside the invariant that licenses a 5×5 window', () => {
    // N = 2 is an EMPIRICAL bound, not a proved one (the proved bound is 4 — see
    // the CHIP_NEIGHBORHOOD docblock). It holds because the radius spread is
    // narrow. Widen this ratio and the window silently starts missing winners,
    // so fail HERE rather than in a render nobody is diffing.
    expect(CHIP_R_MAX / CHIP_R_MIN).toBeLessThanOrEqual(2.5)
  })

  it('no feature point OUTSIDE the window ever beats the winner (margin measured)', () => {
    // Searches rings 3..6 — every candidate the 5×5 window throws away — at the
    // worst setting (sizeVar 1). If the closest discarded point ever got within
    // the winning distance, the window would be too small and the tile would
    // show it as a wrongly-coloured chip.
    let worst = Infinity
    for (const C of [4, 6, 9, 12, 17, 24]) {
      for (const seed of [1, 7, 42]) {
        for (let y = 0; y < 13; y++) {
          for (let x = 0; x < 13; x++) {
            const u = (x + 0.5) / 13, v = (y + 0.5) / 13
            const f1 = chipSample(u, v, C, seed, 0, 1).f1
            const gx = u * C, gy = v * C, ix = Math.floor(gx), iy = Math.floor(gy)
            let best = Infinity
            for (let dy = -6; dy <= 6; dy++) {
              for (let dx = -6; dx <= 6; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) <= CHIP_NEIGHBORHOOD) continue
                const jx = ix + dx, jy = iy + dy
                const f = chipFeature(((jx % C) + C) % C, ((jy % C) + C) % C, seed, 1)
                best = Math.min(best, Math.hypot(gx - (jx + f.x), gy - (jy + f.y)) / f.r)
              }
            }
            worst = Math.min(worst, best / f1)
          }
        }
      }
    }
    expect(worst, `closest discarded point was ${worst.toFixed(3)}× the winner`).toBeGreaterThan(1.15)
  })

  it('chipHash is NOT symmetric in x/y (or the tile mirrors down the diagonal)', () => {
    // Stock hash13 adds the same constant to all three lanes, which makes the mix
    // symmetric: h(1,2) === h(2,1). chipHash uses a per-lane constant vector to
    // break that — the shader twin must copy the vector, not the scalar.
    for (const [a, b] of [[1, 2], [3, 7], [5, 11]] as [number, number][]) {
      expect(Math.abs(chipHash(a, b, 3.317) - chipHash(b, a, 3.317)), `h(${a},${b}) vs h(${b},${a})`).toBeGreaterThan(0.02)
    }
  })

  it('chipHash spreads evenly over a whole grid (feature points really scatter)', () => {
    const vals: number[] = []
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) vals.push(chipHash(x, y, 3.317))
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
    expect(mean).toBeGreaterThan(0.42); expect(mean).toBeLessThan(0.58)
    expect(sd).toBeGreaterThan(0.25)      // uniform 0..1 has sd 0.289
  })
})

// --- the GPU twin ----------------------------------------------------------
// The shader can't run here (a WebGL context needs a browser), so these are
// SOURCE assertions on the one fragment shader render() compiles — the house
// style for shader coverage (see shapefx-post.unit.spec.ts's POST_FRAG block).
// The CPU sampler above stays the behavioural truth; pixel-level agreement is
// checked with a tolerance on /dev/pattern-gallery's chips row.

describe('chips shader branch', () => {
  /** Just the chips branch: from its gate to the shapes gate that follows it. */
  const chipsBranch = (() => {
    const start = TEXTURE_FS.indexOf('if (u_mode > 3.5)')
    const end = TEXTURE_FS.indexOf('if (u_mode > 2.5)')
    return TEXTURE_FS.slice(start, end)
  })()

  it('gates on the chips MODE INDEX, and gates before the shapes branch', () => {
    // The hazard this test exists for: the shapes gate is a bare `u_mode > 2.5`,
    // so chips (index 4) used to render the SHAPES branch — a believable wrong
    // tile, not a blank one. Chips must therefore return FIRST.
    expect(MODES.indexOf('chips' as any)).toBe(4)
    const chipsGate = TEXTURE_FS.indexOf('if (u_mode > 3.5)')
    const shapesGate = TEXTURE_FS.indexOf('if (u_mode > 2.5)')
    expect(chipsGate, 'chips branch missing from the shader').toBeGreaterThan(0)
    expect(chipsGate, 'chips must be gated BEFORE shapes').toBeLessThan(shapesGate)
    // 3.5 is the midpoint between shapes (3) and chips (4) — if chips ever moves,
    // this threshold has to move with it.
    expect(MODES.indexOf('chips' as any) - 0.5).toBe(3.5)
  })

  it('interpolates pattern.ts constants instead of retyping them', () => {
    // Retyped constants are how the twins drift: these must be the SAME numbers
    // the CPU used, which is only guaranteed if the template literal read them.
    expect(chipsBranch).toContain(`for (int dy = -${CHIP_NEIGHBORHOOD}; dy <= ${CHIP_NEIGHBORHOOD}; dy++)`)
    expect(chipsBranch).toContain(`for (int dx = -${CHIP_NEIGHBORHOOD}; dx <= ${CHIP_NEIGHBORHOOD}; dx++)`)
    expect(chipsBranch).toContain(`float(${CHIP_R_MIN})`)
    expect(chipsBranch).toContain(`float(${CHIP_R_MAX})`)
    expect(chipsBranch).toContain(`float(${CHIP_TONE_RANGE})`)
    expect(chipsBranch).toContain(`evalFill(${CHIP_INK_ROLES}, fc, v_uv)`)   // ground = grout
    // The salts never appear in GLSL at all — they are folded into the
    // u_chipSalt lanes on the JS side (chipSaltLanes), so a literal here would
    // mean someone hand-typed one.
    for (const s of [CHIP_SALT_X, CHIP_SALT_Y, CHIP_SALT_R, CHIP_SALT_ROLE, CHIP_SALT_TONE]) {
      expect(TEXTURE_FS, `salt ${s} hand-typed into the shader`).not.toContain(String(s))
    }
  })

  it('uses the ASYMMETRIC per-lane hash, not the shared scalar cellHash', () => {
    // cellHash() adds 33.33 to all three lanes, which makes it symmetric in x/y
    // and mirrors every chip across the tile diagonal (the CPU twin has its own
    // test for the asymmetry).
    expect(TEXTURE_FS).toContain('vec3(33.33, 41.17, 27.83)')
    expect(chipsBranch).toContain('chipHash(')
    expect(chipsBranch, 'chips must not fall back to the symmetric cellHash').not.toContain('cellHash(')
  })

  it('keeps F2 on a DIFFERENT cell id (a chip never grouts against itself)', () => {
    expect(chipsBranch).toContain('if (id != id1) f2 = f1;')
    expect(chipsBranch).toContain('else if (id != id1 && d < f2)')
    // wrapped id vs un-wrapped position — the split that makes the tile seamless
    expect(chipsBranch).toContain('float cx = posmod(jx, C), cy = posmod(jy, C);')
    expect(chipsBranch).toContain('vec2 fp = vec2(jx + chipHash(cx, cy, u_chipSalt[0]), jy + chipHash(cx, cy, u_chipSalt[1]));')
  })

  it('jitter is one mix toward white/black — no clamp on the colour, no branch', () => {
    expect(chipsBranch).toContain('col = mix(col, vec3(step(0.5, tone)), abs(tone - 0.5) * clamp(u_jitter, 0.0, 1.0) * float(0.6));')
  })

  it('every chip uniform the shader declares is actually uploaded by render()', () => {
    const src = readFileSync(resolve(__dirname, '../../app/lib/texturefx/renderer.ts'), 'utf8')
    for (const name of ['u_chipCells', 'u_chipGrout', 'u_chipSizeVar']) {
      expect(TEXTURE_FS, `${name} not declared`).toContain(name)
      expect(src, `${name} declared but never set`).toContain(`u('${name}')`)
    }
    expect(TEXTURE_FS).toContain('uniform float u_chipSalt[5];')
    expect(src).toContain(`u('u_chipSalt[0]')`)
    // Colour jitter is the SHARED uniform, not a chips-only copy.
    expect(chipsBranch).toContain('u_jitter')
  })
})

describe('chipSaltLanes (the float32 seed hazard)', () => {
  /** chipHash exactly as the GLSL computes it: the third lane arrives already
   *  hashed. If this stops equalling pattern.ts's chipHash, the shader is
   *  computing a different field from the CPU and every chips tile drifts. */
  const glslChipHash = (cx: number, cy: number, pz: number) => {
    const fr = (x: number) => x - Math.floor(x)
    let px = fr(cx * 0.1031), py = fr(cy * 0.1031), pzz = pz
    const d = px * (py + 33.33) + py * (pzz + 41.17) + pzz * (px + 27.83)
    px += d; py += d; pzz += d
    return fr((px + py) * pzz)
  }
  const SALTS = [CHIP_SALT_X, CHIP_SALT_Y, CHIP_SALT_R, CHIP_SALT_ROLE, CHIP_SALT_TONE]

  it('pre-hashing the salt is the identical function, lane for lane', () => {
    for (const seed of [1, 3, 7, 977, 123457, 999983]) {
      const lanes = chipSaltLanes(seed)
      expect(lanes.length).toBe(SALTS.length)
      for (let i = 0; i < SALTS.length; i++) {
        for (const [cx, cy] of [[0, 0], [1, 2], [5, 11], [23, 17]] as [number, number][]) {
          expect(glslChipHash(cx, cy, lanes[i]!), `seed ${seed} lane ${i} cell ${cx},${cy}`)
            .toBe(chipHash(cx, cy, seed + SALTS[i]!))
        }
      }
    }
  })

  it('every lane is a 0..1 fraction — which is the point (float32 keeps those)', () => {
    // A raw seed + salt is not: at seed 1e6 a float32 ulp is 0.0625, which
    // swallows the salts whole and would reshuffle the entire tile on the GPU
    // while the CPU (float64) kept the old one.
    for (const seed of [1, 1_000_000]) {
      for (const l of chipSaltLanes(seed)) { expect(l).toBeGreaterThanOrEqual(0); expect(l).toBeLessThan(1) }
    }
    // ...and the five lanes stay distinct, so the five hashes stay independent.
    expect(new Set(chipSaltLanes(7)).size).toBe(SALTS.length)
  })
})

// --- the tuner's chips vocabulary ------------------------------------------

describe('texture tuner guidance', () => {
  it('keeps the honesty clause and names the three chips looks', () => {
    expect(TEXTURE_GUIDANCE).toContain('Never present an approximation as an exact match.')
    for (const look of ['terrazzo', 'mosaic', 'pebbles']) {
      expect(TEXTURE_GUIDANCE.toLowerCase(), `no recipe for ${look}`).toContain(look)
    }
  })

  it('names only control keys, roles and commands that actually exist', () => {
    // Same detector as geoshape's guidance test: every control key, role key and
    // command op the prose names is camelCase, and ordinary English never
    // produces a lowercase-then-uppercase token — so a renamed or typo'd name
    // gets pulled out here and fails, instead of quietly sending the model after
    // a control that no longer exists.
    const snapshot = describeTexture({ params: chipParams() })
    const keys = new Set(TEXTURE_CONTROLS.map(c => c.key))
    const roles = new Set(rolesFor({ mode: 'chips' } as any))
    const ops = new Set(snapshot.commands.map(c => c.op))
    const candidates = new Set(TEXTURE_GUIDANCE.match(/\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b/g) ?? [])
    expect(candidates.size, 'the field-name detector found nothing — check the regex').toBeGreaterThan(3)
    for (const c of candidates) expect(keys.has(c) || roles.has(c) || ops.has(c), c).toBe(true)
    // The recipes lean on all three chip sliders…
    for (const k of ['chipCells', 'chipGrout', 'chipSizeVar']) expect(candidates.has(k), k).toBe(true)
    // …plus jitter, which the detector can't see (one lowercase word).
    expect(TEXTURE_GUIDANCE).toContain('jitter')
  })

  it('does not promise more chip colours than the shader can paint', () => {
    // CHIP_INK_ROLES is 2 by decision — a third ink needs the fill uniform arrays
    // widened first, so the recipe must say two inks + ground, not "3-4 chips".
    expect(rolesFor({ mode: 'chips' } as any).length).toBe(CHIP_INK_ROLES + 1)
    expect(TEXTURE_GUIDANCE).toContain('two ink colours plus the ground')
    expect(TEXTURE_GUIDANCE).not.toMatch(/three chip colou?rs|four chip colou?rs/i)
  })
})
