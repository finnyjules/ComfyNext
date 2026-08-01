// @vitest-environment happy-dom
//
// The rest of the unit suite runs in `environment: 'node'`, but paper.js
// touches browser globals when it loads, so this one spec opts into happy-dom.
// Worth the exception: `outlineStrokes` is the step that decides whether a
// pasted Lucide/Feather icon imports as geometry or as nothing at all, and the
// two failure modes it can have (no area, or curves sampled at their anchors)
// are both invisible until something is rendered.
import { describe, it, expect, beforeAll } from 'vitest'
import { outlineStrokes, type SvgLeafPath } from '~/composables/useVectorSvg'

/**
 * happy-dom has a <canvas> element but no 2D context, and paper refuses to load
 * without one (it feature-detects blend modes at import time). Everything this
 * spec exercises — boolean ops, path data, area, hit testing — is pure JS maths
 * that never touches the raster; only paper's renderer does, and we never draw.
 * So we hand it a context that answers every call and remembers what is set on
 * it. Installed in beforeAll, which is early enough because useVectorSvg
 * `import()`s paper lazily on first use, not at module load.
 */
function installStubCanvas2D() {
  const data: Record<string, unknown> = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000000', strokeStyle: '#000000',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    font: '10px sans-serif', shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true,
    // paper divides by these when working out the device pixel ratio; a no-op
    // function here would make the ratio NaN and every view coordinate with it.
    backingStorePixelRatio: 1, webkitBackingStorePixelRatio: 1,
    mozBackingStorePixelRatio: 1, msBackingStorePixelRatio: 1,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h,
    }),
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  }
  const ctx = new Proxy(data, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true },
  })
  ;(globalThis as any).HTMLCanvasElement.prototype.getContext = function () {
    ;(data as any).canvas = this
    return ctx
  }
}

beforeAll(() => { installStubCanvas2D() })

const stroked = (d: string): SvgLeafPath => ({
  d, fill: 'none', stroke: '#000000', strokeWidth: 0.1, fillRule: 'nonzero',
})

/** Re-parse an outlined `d` so we can ask paper about its area/containment. */
async function measure(d: string) {
  const paper = (await import('paper')).default
  paper.setup(new paper.Size(100, 100))
  return new paper.CompoundPath(d)
}

describe('outlineStrokes', () => {
  it('turns a stroked open line into a filled shape with area', async () => {
    const [outlined, ...rest] = await outlineStrokes([stroked('M -0.5 0 L 0.5 0')])
    expect(rest).toHaveLength(0)
    expect(outlined).toBeDefined()
    // The stroke's colour becomes the solid's colour; nothing is left to stroke.
    expect(outlined!.fill).toBe('#000000')
    expect(outlined!.stroke).toBe('none')
    expect(outlined!.strokeWidth).toBe(0)

    const shape = await measure(outlined!.d)
    expect(shape.closed ?? shape.children.every((c: any) => c.closed)).toBe(true)
    // 1.0 long × 0.1 wide with round caps ≈ 0.1 + π·0.05² ≈ 0.108.
    expect(Math.abs(shape.area)).toBeGreaterThan(0.09)
    expect(Math.abs(shape.area)).toBeLessThan(0.13)
  })

  it('follows the curve rather than the anchors', async () => {
    // A unit circle stroked 0.1 wide: the ring must contain the point at 45°,
    // radius 1. Outlining from paper's anchors alone (which sit at 0/90/180/270)
    // would produce chords passing 0.29 short of it — the "expanded <circle>
    // comes out a rounded square" failure this guards.
    const [outlined] = await outlineStrokes([stroked('M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0 Z')])
    expect(outlined).toBeDefined()
    const shape = await measure(outlined!.d)
    const c = Math.SQRT1_2
    const paper = (await import('paper')).default
    expect(shape.contains(new paper.Point(c, c))).toBe(true)
    // ...and the hole is still a hole: the centre is outside the ring.
    expect(shape.contains(new paper.Point(0, 0))).toBe(false)
  })

  it('passes filled paths through and drops paths with neither fill nor stroke', async () => {
    const filled: SvgLeafPath = { d: 'M 0 0 L 1 0 L 1 1 Z', fill: '#ff0000', stroke: 'none', strokeWidth: 0, fillRule: 'evenodd' }
    const empty: SvgLeafPath = { d: 'M 0 0 L 1 0', fill: 'none', stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' }
    const out = await outlineStrokes([filled, empty])
    expect(out).toEqual([filled])
  })
})
