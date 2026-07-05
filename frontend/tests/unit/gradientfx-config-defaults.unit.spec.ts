import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults, DEFAULT_CENTER } from '~/lib/gradientfx/types'

describe('ensureConfigDefaults', () => {
  it('does not throw on an empty config and backfills the top-level containers', () => {
    const out = ensureConfigDefaults({} as any)
    expect(out.canvas).toBeTruthy()
    expect(out.canvas.center).toEqual(DEFAULT_CENTER)
    expect(out.relief?.light).toBeTruthy()
    expect(out.flow).toBeTruthy()
    expect(out.focus).toBeTruthy()
    expect(Array.isArray(out.layers)).toBe(true)
  })

  it('backfills a partial config that has canvas but no center/relief/flow', () => {
    const out = ensureConfigDefaults({ canvas: { layout: 'linear' } } as any)
    expect(out.canvas.layout).toBe('linear')
    expect(out.canvas.center).toEqual(DEFAULT_CENTER)
    expect(out.flow).toBeTruthy()
    expect(out.relief.light).toBeTruthy()
  })

  it('backfills mesh points on a mesh-layout layer', () => {
    const cfg: any = {
      seed: 'abc',
      canvas: { layout: 'mesh', center: { x: 0, y: 0 } },
      relief: { light: { azimuth: 1, elevation: 2 } },
      flow: { speed: 1, gloss: 1 },
      focus: {},
      layers: [{ color: { stops: [{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }] } }],
    }
    const out = ensureConfigDefaults(cfg)
    expect(out.layers[0].mesh).toBeTruthy()
  })

  it('leaves an already-complete field untouched', () => {
    const out = ensureConfigDefaults({ canvas: { center: { x: 0.3, y: -0.2 } }, layers: [] } as any)
    expect(out.canvas.center).toEqual({ x: 0.3, y: -0.2 })
  })
})
