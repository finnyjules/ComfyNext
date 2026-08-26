// Take promises — the measurement half.
//
// Pure maths over synthetic RGBA buffers, so nothing here is mocked and nothing
// here needs a GPU: these are the exact functions the wiring runs against a real
// thumbnail's 32² downsample. The point of the whole feature is that a claim is
// worth nothing unless the checking is trustworthy, so the boundary cases get
// as much attention as the happy ones.
import { describe, it, expect } from 'vitest'
import {
  COLOR_SHARE_MIN,
  DIRECTION_MIN_ENERGY,
  DIRECTION_RATIO,
  RADIAL_MIN,
  THUMB_DIFF_SIZE as N,
  TONE_DEAD_ZONE,
  checkPromise,
  measureColors,
  measureDirection,
  measureTone,
} from '~/lib/agent/takes'

// ── synthetic pictures ──────────────────────────────────────────────────────
function build(px: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N * N * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r, g, b, a = 255] = px(x, y)
      const i = (y * N + x) * 4
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
    }
  }
  return out
}
const flat = (r: number, g: number, b: number, a = 255) => build(() => [r, g, b, a])
/** Top-to-bottom ramp between two colours. */
const vRamp = (a: [number, number, number], b: [number, number, number]) =>
  build((_x, y) => {
    const t = y / (N - 1)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  })
/** Side-to-side ramp. */
const hRamp = (a: [number, number, number], b: [number, number, number]) =>
  build((x) => {
    const t = x / (N - 1)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  })
/** Bright centre fading to a dark edge. */
const radial = () => build((x, y) => {
  const cx = (N - 1) / 2, cy = (N - 1) / 2
  const d = Math.hypot(x - cx, y - cy) / Math.hypot(cx, cy)
  const v = Math.round(255 * (1 - Math.min(1, d)))
  return [v, v, v]
})
/** Fine noise: lots of local change, no direction at all. Seeded, not random. */
const speckle = () => build((x, y) => {
  const v = ((x * 7 + y * 13) % 2) * 255
  return [v, v, v]
})

describe('measureDirection', () => {
  it('reads a top-to-bottom ramp as vertical', () => {
    const m = measureDirection(vRamp([255, 0, 0], [0, 0, 255]))
    expect(m.direction).toBe('vertical')
    expect(m.vertical).toBeGreaterThan(m.horizontal * DIRECTION_RATIO)
  })

  it('reads a side-to-side ramp as horizontal', () => {
    expect(measureDirection(hRamp([255, 0, 0], [0, 0, 255])).direction).toBe('horizontal')
  })

  it('reads a centre-out fade as radial', () => {
    const m = measureDirection(radial())
    expect(m.direction).toBe('radial')
    expect(m.centreEdge).toBeGreaterThanOrEqual(RADIAL_MIN)
  })

  it('reads a flat field as none', () => {
    const m = measureDirection(flat(120, 40, 200))
    expect(m.direction).toBe('none')
    expect(Math.max(m.vertical, m.horizontal)).toBeLessThan(DIRECTION_MIN_ENERGY)
  })

  it('reads a busy but undirected field as none, not as a direction', () => {
    // The honest answer for marble-like noise: plenty of local change, no axis.
    expect(measureDirection(speckle()).direction).toBe('none')
  })

  it('a barely-tilted ramp does not get called directional', () => {
    // Two channels apart across the whole frame is under the energy floor.
    expect(measureDirection(vRamp([100, 100, 100], [102, 102, 102])).direction).toBe('none')
  })

  it('radial and none are disjoint — a radial field is never reported as none', () => {
    const m = measureDirection(radial())
    expect(m.direction).not.toBe('none')
  })
})

describe('measureTone', () => {
  it('calls a dark picture dark and a light one light', () => {
    expect(measureTone(flat(20, 20, 30)).tone).toBe('dark')
    expect(measureTone(flat(235, 240, 235)).tone).toBe('light')
  })

  it('reports a mid picture as mid', () => {
    expect(measureTone(flat(128, 128, 128)).tone).toBe('mid')
  })

  it('the dead zone is real — a mid picture fails NEITHER claim', () => {
    const mid = flat(128, 128, 128)
    expect(checkPromise(mid, { tone: 'dark' })[0]!.ok).toBe(true)
    expect(checkPromise(mid, { tone: 'light' })[0]!.ok).toBe(true)
    expect(TONE_DEAD_ZONE).toBeGreaterThan(0)
  })

  it('but a clearly dark picture does fail a "light" claim', () => {
    expect(checkPromise(flat(15, 15, 20), { tone: 'light' })[0]!.ok).toBe(false)
  })
})

describe('measureColors', () => {
  const shareOf = (buf: Uint8ClampedArray, name: string) => measureColors(buf).shares[name] ?? 0

  it('names the primaries', () => {
    expect(shareOf(flat(230, 30, 30), 'red')).toBeGreaterThan(0.9)
    expect(shareOf(flat(30, 90, 230), 'blue')).toBeGreaterThan(0.9)
    expect(shareOf(flat(40, 190, 90), 'green')).toBeGreaterThan(0.9)
  })

  it('names the achromatics by luminance, not hue', () => {
    expect(shareOf(flat(250, 250, 252), 'white')).toBeGreaterThan(0.9)
    expect(shareOf(flat(8, 8, 10), 'black')).toBeGreaterThan(0.9)
    expect(shareOf(flat(130, 128, 132), 'grey')).toBeGreaterThan(0.9)
  })

  it('splits a two-colour ramp between both ends', () => {
    const m = measureColors(vRamp([255, 140, 0], [90, 0, 160]))
    expect(m.shares.orange).toBeGreaterThan(0.1)
    expect(m.shares.purple).toBeGreaterThan(0.1)
  })

  it('ignores transparent pixels rather than counting them as black', () => {
    // Shape and Vector Type draw on transparency; counting the empty area as
    // black would make every one of their takes "mostly black".
    const half = build((_x, y) => (y < N / 2 ? [230, 30, 30, 255] : [0, 0, 0, 0]))
    expect(shareOf(half, 'red')).toBeGreaterThan(0.9)
    expect(shareOf(half, 'black')).toBe(0)
  })

  it('an entirely transparent picture measures nothing at all', () => {
    expect(measureColors(flat(0, 0, 0, 0)).total).toBe(0)
  })
})

describe('checkPromise — colours, with neighbour tolerance', () => {
  const ok = (buf: Uint8ClampedArray, colors: string[]) =>
    checkPromise(buf, { colors }).every(r => r.ok)

  it('passes a colour that dominates the picture', () => {
    expect(ok(flat(255, 140, 0), ['orange'])).toBe(true)
  })

  it('fails a colour that is not there at all', () => {
    expect(ok(flat(255, 140, 0), ['blue'])).toBe(false)
  })

  it('does not flap at the red/orange boundary, whichever side it lands on', () => {
    // A hue right on the seam must satisfy BOTH neighbouring names — the model
    // saying "red" about #ff4000 is not a lie worth labelling a tile over.
    const seam = flat(255, 64, 0) // hue 15°, exactly the red/orange border
    expect(ok(seam, ['red'])).toBe(true)
    expect(ok(seam, ['orange'])).toBe(true)
    // …but the far side of the wheel still fails.
    expect(ok(seam, ['green'])).toBe(false)
  })

  it('tolerates grey for a near-grey picture, and vice versa', () => {
    const nearGrey = flat(140, 132, 128) // barely saturated
    expect(ok(nearGrey, ['grey'])).toBe(true)
  })

  it('holds every promised colour to the threshold, not just one of them', () => {
    const mostlyOrange = build((_x, y) => (y < N - 2 ? [255, 140, 0] : [40, 90, 230]))
    expect(ok(mostlyOrange, ['orange'])).toBe(true)
    expect(ok(mostlyOrange, ['orange', 'blue'])).toBe(false) // blue is a sliver
    expect(COLOR_SHARE_MIN).toBeGreaterThan(0)
  })

  it('an unknown colour word is not checkable, so it is not a failure', () => {
    // The model is asked for common words; anything else means "we cannot
    // measure this", and unmeasured is never reported as broken.
    expect(checkPromise(flat(255, 140, 0), { colors: ['puce'] })).toEqual([])
  })
})

describe('checkPromise — the contract around it', () => {
  it('reports one result per checkable claim, with what was measured', () => {
    const res = checkPromise(vRamp([255, 140, 0], [90, 0, 160]), {
      colors: ['orange', 'purple'], direction: 'vertical', tone: 'dark',
    })
    expect(res.map(r => r.claim).sort()).toEqual(['colors', 'direction', 'tone'])
    for (const r of res) expect(r.measured).toBeTruthy()
  })

  it('skips everything when there is no picture — missing evidence is not a miss', () => {
    expect(checkPromise(null, { colors: ['orange'], direction: 'vertical', tone: 'dark' })).toEqual([])
  })

  it('an empty promise checks nothing', () => {
    expect(checkPromise(flat(255, 140, 0), {})).toEqual([])
  })

  it('a promise the picture keeps passes every claim', () => {
    const sunsetish = vRamp([255, 154, 77], [59, 0, 96])
    const res = checkPromise(sunsetish, { colors: ['orange', 'purple'], direction: 'vertical' })
    expect(res).toHaveLength(2)
    for (const r of res) expect(r.ok, `${r.claim}: ${r.measured}`).toBe(true)
  })

  it('a sideways sunset fails its own direction claim — the case this exists for', () => {
    const sideways = hRamp([255, 154, 77], [59, 0, 96])
    const res = checkPromise(sideways, { colors: ['orange', 'purple'], direction: 'vertical' })
    const dir = res.find(r => r.claim === 'direction')!
    expect(dir.ok).toBe(false)
    expect(dir.measured).toContain('horizontal')
    // …and the colours, which ARE right, still pass. The label must blame the
    // claim that actually broke.
    expect(res.find(r => r.claim === 'colors')!.ok).toBe(true)
  })
})
