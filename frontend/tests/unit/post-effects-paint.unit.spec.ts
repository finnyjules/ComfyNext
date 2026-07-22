import { describe, it, expect, vi, beforeEach } from 'vitest'
import { paintLayerStack, type StackItem, type LocalLayer } from '~/composables/useCompositorLayers'
import { applyEffectChain, defaultPostEffect, type PostEffect } from '~/lib/compositor/postEffects'

function stubCtx(tag = 'ctx') {
  const ctx: any = {
    _tag: tag,
    _filters: [] as string[],
    _ops: [] as string[],
    canvas: { width: 20, height: 20 },
    save: vi.fn(), restore: vi.fn(),
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    setTransform: vi.fn(), getTransform: () => ({ a: 1 }),
    translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), transform: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), clip: vi.fn(),
    roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => ({})),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) =>
      ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: vi.fn(),
    createImageData: vi.fn((w: number, h: number) =>
      ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    measureText: vi.fn(() => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })),
    fillText: vi.fn(), strokeText: vi.fn(),
    globalCompositeOperation: 'source-over', globalAlpha: 1,
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  }
  // Record filter assignments so tests can assert which filters were applied.
  let _filter = 'none'
  Object.defineProperty(ctx, 'filter', {
    get: () => _filter,
    set: (v: string) => { _filter = v; ctx._filters.push(v) },
  })
  return ctx
}

function mkStubCanvas() {
  const c: any = { width: 0, height: 0 }
  const ctx = stubCtx('offscreen')
  ctx.canvas = c
  c.getContext = () => ctx
  return c
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? mkStubCanvas() : ({} as any)),
  })
})

const rect = (effects: any[]): LocalLayer => ({
  id: 'r1', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1,
  w: 0.4, h: 0.4, radius: 0, fill: '#ff0000', stroke: '', strokeWidth: 0,
  effects,
} as any)

describe('applyEffectChain', () => {
  it('applies an adjust filter via a self-copy pass', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    applyEffectChain(off, [{ ...defaultPostEffect('adjust'), brightness: 1.5 } as PostEffect], { W: 20 })
    const ctx = off.getContext()
    expect(ctx._filters.some((f: string) => f.includes('brightness(1.5)'))).toBe(true)
  })
  it('bloom composites additively (lighter)', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    const ctx = off.getContext()
    const ops: string[] = []
    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get: () => 'source-over', set: (v: string) => { ops.push(v) },
    })
    applyEffectChain(off, [defaultPostEffect('bloom')], { W: 20 })
    expect(ops).toContain('lighter')
  })
  it('does nothing for an empty chain', () => {
    const off = mkStubCanvas()
    off.width = 20; off.height = 20
    applyEffectChain(off, [], { W: 20 })
    expect(off.getContext().drawImage).not.toHaveBeenCalled()
  })
})

describe('paintLayer routing', () => {
  it('routes a layer with only a chain effect through the offscreen path', () => {
    const main = stubCtx('main')
    const items: StackItem[] = [{ type: 'local', key: 'l:r1', layer: rect([{ ...defaultPostEffect('adjust'), brightness: 1.5 }]) }]
    paintLayerStack(main, 20, 20, items, [(items[0] as any).layer])
    // Effected path: the layer lands on main via drawImage of the offscreen,
    // not via direct fill on the main ctx.
    expect(main.drawImage).toHaveBeenCalled()
    expect(main.fill).not.toHaveBeenCalled()
  })
  it('fast path unchanged when no effects (no offscreen drawImage)', () => {
    const main = stubCtx('main')
    const items: StackItem[] = [{ type: 'local', key: 'l:r1', layer: rect([]) }]
    paintLayerStack(main, 20, 20, items, [(items[0] as any).layer])
    expect(main.fill).toHaveBeenCalled()
    expect(main.drawImage).not.toHaveBeenCalled()
  })
})

describe('paintLayerStack doc-level post', () => {
  it('with post effects: snapshots, processes, and stamps back onto the main ctx', () => {
    const main = stubCtx('main')
    paintLayerStack(main, 20, 20, [], [], undefined, undefined, undefined, undefined, undefined, undefined,
      [{ ...defaultPostEffect('adjust'), saturation: 1.4 } as PostEffect])
    expect(main.clearRect).toHaveBeenCalled()      // device canvas cleared before the stamp
    expect(main.drawImage).toHaveBeenCalledTimes(1) // processed snapshot stamped back
  })
  it('absent/empty post ⇒ byte-identical (no extra draw on the main ctx)', () => {
    const main = stubCtx('main')
    paintLayerStack(main, 20, 20, [], [])
    paintLayerStack(main, 20, 20, [], [], undefined, undefined, undefined, undefined, undefined, undefined, [])
    expect(main.drawImage).not.toHaveBeenCalled()
  })
})
