import { describe, it, expect } from 'vitest'
import { renderShapes, toSvg, contentBounds } from '~/lib/geoshape/render'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'
import { paintToVectorPaint } from '~/lib/paint/toVector'
import type { ImageFill } from '~/lib/compositor/paint'
import type { Fill } from '~/lib/spacetype/fillTile'

describe('geoshape render', () => {
  it('produces shapes and an evenodd SVG for the default (geologo) config', async () => {
    const shapes = await renderShapes(DEFAULT_CONFIG)
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    const svg = await toSvg(DEFAULT_CONFIG)
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill-rule="evenodd"')
  })

  it('overlapMode shape yields an extra filled shape vs hole', async () => {
    // DEFAULT_CONFIG's own radius (180) puts adjacent hexagon clones exactly
    // vertex-to-vertex (zero-area contact, no real overlap to speak of), so
    // this pulls the ring in — `radius: 100` — to a config whose clones
    // genuinely overlap, which is what the assertion is actually testing.
    const cfg = { ...DEFAULT_CONFIG, radius: 100 }
    const hole = await renderShapes({ ...cfg, overlapMode: 'hole' })
    const shape = await renderShapes({ ...cfg, overlapMode: 'shape' })
    expect(shape.length).toBeGreaterThan(hole.length)
  })

  it('composite bbox is non-degenerate', async () => {
    const shapes = await renderShapes(DEFAULT_CONFIG)
    let maxAbsX = 0
    let maxAbsY = 0
    for (const s of shapes) {
      for (const c of s.commands) {
        const a = c.args ?? []
        for (let i = 0; i + 1 < a.length; i += 2) {
          maxAbsX = Math.max(maxAbsX, Math.abs(a[i] as number))
          maxAbsY = Math.max(maxAbsY, Math.abs(a[i + 1] as number))
        }
      }
    }
    expect(maxAbsX).toBeGreaterThan(0)
    expect(maxAbsY).toBeGreaterThan(0)
  })

  it('viewBox contains the actual rendered geometry (regression: static-size cropping)', async () => {
    const svg = await toSvg(DEFAULT_CONFIG)
    const match = svg.match(/viewBox="([^"]+)"/)
    expect(match).not.toBeNull()
    const [minX, minY, w, h] = match![1]!.split(/\s+/).map(Number)
    const b = contentBounds(await renderShapes(DEFAULT_CONFIG))
    // The old static `size + padding*2` formula sized the box without
    // regard for `arrange`'s actual clone spread — this would fail against
    // that bug because the real geometry ran well outside it.
    expect(b.minX).toBeGreaterThanOrEqual(minX!)
    expect(b.maxX).toBeLessThanOrEqual(minX! + w!)
    expect(b.minY).toBeGreaterThanOrEqual(minY!)
    expect(b.maxY).toBeLessThanOrEqual(minY! + h!)
  })

  it('default config genuinely overlaps (overlapMode shape yields more shapes than hole)', async () => {
    const hole = await renderShapes({ ...DEFAULT_CONFIG, overlapMode: 'hole' })
    const shape = await renderShapes({ ...DEFAULT_CONFIG, overlapMode: 'shape' })
    expect(shape.length).toBeGreaterThan(hole.length)
  })

  it('toSvg emits a real <linearGradient> for a gradient fill', async () => {
    const grad: any = { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }
    const svg = await toSvg({ ...DEFAULT_CONFIG, fill: grad })
    expect(svg).toMatch(/<linearGradient/)
    expect(svg).toContain('#ff0000')
  })
  it('toSvg emits a <pattern> for a procedural pattern fill', async () => {
    const patt: any = { type: 'stripes', a: '#111111', b: '#eeeeee', textColor: '#000', angle: 0, density: 8 }
    const svg = await toSvg({ ...DEFAULT_CONFIG, fill: patt })
    expect(svg).toMatch(/<pattern/)
  })
  it('a solid fill stays a plain fill attribute (no defs)', async () => {
    const svg = await toSvg({ ...DEFAULT_CONFIG, fill: '#123456' })
    expect(svg).toContain('#123456')
    expect(svg).not.toMatch(/<linearGradient|<pattern/)
  })

  // ── Task 4: image/shader TIER 3 raster embed ────────────────────────────────
  //
  // `toSvg`'s own raster step rasterizes via a `<canvas>` (`document.
  // createElement('canvas')`), which this suite's `environment: 'node'` vitest
  // config (no jsdom, no `document`) cannot run — `toSvg` itself detects that
  // and degrades to the pre-Task-4 solid fallback (asserted below). The actual
  // "does a raster turn into a `<pattern>`-with-`<image>`" logic lives entirely
  // in `paintToVectorPaint` (`~/lib/paint/toVector.ts`), which is pure — no DOM,
  // no canvas — so it's exercised DIRECTLY here with a stubbed raster, the way
  // `toSvg` would call it after rasterizing for real in a browser. Full
  // image/shader canvas warming + rasterization is browser/GPU-only and is
  // verified live (Task 5), not here — see task-4-report.md.
  const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const box = { x: -10, y: -10, width: 20, height: 20 }

  it('paintToVectorPaint embeds an ImageFill as a <pattern>-with-<image> when given a raster', () => {
    const imageFill: ImageFill = { type: 'image', src: 'blob:whatever', fit: 'cover' }
    // No raster: the pre-Task-4 behaviour — ImageFill has no vector form on its
    // own, so this stays null (the caller's solid fallback).
    expect(paintToVectorPaint(imageFill, { units: 'userSpaceOnUse', box })).toBeNull()
    const vp = paintToVectorPaint(imageFill, { units: 'userSpaceOnUse', box, raster: TINY_PNG_DATA_URL })
    expect(vp).not.toBeNull()
    expect((vp as any).type).toBe('pattern')
    expect((vp as any).image).toBe(TINY_PNG_DATA_URL)
    expect((vp as any).width).toBe(box.width)
    expect((vp as any).height).toBe(box.height)
  })

  it('paintToVectorPaint embeds a shader Fill as a <pattern>-with-<image> when given a raster', () => {
    const shaderFill: Fill = {
      type: 'shader', a: '#111111', b: '#eeeeee', textColor: '#000', angle: 0, density: 8,
      shader: { effectId: 'fbm_warp', params: {}, anchor: 'object', speed: 0, input: '#111111' },
    }
    expect(paintToVectorPaint(shaderFill, { units: 'userSpaceOnUse', box })).toBeNull()
    const vp = paintToVectorPaint(shaderFill, { units: 'userSpaceOnUse', box, raster: TINY_PNG_DATA_URL })
    expect(vp).not.toBeNull()
    expect((vp as any).type).toBe('pattern')
    expect((vp as any).image).toBe(TINY_PNG_DATA_URL)
  })

  it('toSvg degrades gracefully (solid fallback, no crash) for an ImageFill with no DOM available', async () => {
    const imageFill: ImageFill = { type: 'image', src: 'blob:whatever', fit: 'cover' }
    const svg = await toSvg({ ...DEFAULT_CONFIG, fill: imageFill })
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/<pattern|<image/)
  })

  it('toSvg fillStrategy perClone emits each clone as its own path, cycling fills', async () => {
    const svg = await toSvg({ ...DEFAULT_CONFIG, fillStrategy: 'perClone', fills: ['#ff0000', '#0000ff'], count: 4 })
    expect(svg).toContain('#ff0000')
    expect(svg).toContain('#0000ff')
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
