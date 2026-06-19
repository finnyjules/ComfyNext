import { describe, it, expect, vi, beforeEach } from 'vitest'
import { paintLayerStack, type StackItem } from '~/composables/useCompositorLayers'

// A tagged 2D-context stub. Offscreen canvases created inside the renderer get
// their own ('offscreen'); the main ctx we pass in is tagged 'main' so we can
// assert WHICH ctx a draw closure was handed.
function stubCtx(tag = 'ctx') {
  const ctx: any = {
    _tag: tag,
    canvas: { width: 10, height: 10 },
    save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(),
    clearRect: vi.fn(), setTransform: vi.fn(), getTransform: () => ({ a: 1 }),
    beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), clip: vi.fn(), fillRect: vi.fn(),
    globalCompositeOperation: 'source-over', filter: 'none', globalAlpha: 1,
  }
  return ctx
}

beforeEach(() => {
  // The unit env is 'node' (no DOM); offscreen canvases are created via
  // document.createElement, so stub the global the same way the sibling
  // layer-mask-composite regression test does.
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => stubCtx('offscreen') } as any
      return {} as any
    },
  })
})

describe('paintLayerStack cross-source masking', () => {
  it('skips the mask-source layer from top-level paint and stamps the masked result', () => {
    const mainCtx = stubCtx('main')
    const drawA = vi.fn() // wired mask source w:2
    const drawB = vi.fn() // wired content w:1, masked by w:2
    const items: StackItem[] = [
      { type: 'wired', key: 'w:2', draw: drawA },
      { type: 'wired', key: 'w:1', draw: drawB },
    ]
    paintLayerStack(mainCtx, 10, 10, items, [], undefined, undefined, undefined, {
      'w:1': { maskedByKey: 'w:2' },
    })
    expect(drawA).toHaveBeenCalled()
    expect(drawA.mock.calls.every((c: any[]) => c[0] !== mainCtx)).toBe(true)
    expect(drawB).toHaveBeenCalled()
    expect(drawB.mock.calls.every((c: any[]) => c[0] !== mainCtx)).toBe(true)
    expect(mainCtx.drawImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the mask source visible (also painting on main ctx) when showSource is set', () => {
    const mainCtx = stubCtx('main')
    const drawA = vi.fn() // w:2 mask source
    const drawB = vi.fn() // w:1 content masked by w:2
    const items: StackItem[] = [
      { type: 'wired', key: 'w:2', draw: drawA },
      { type: 'wired', key: 'w:1', draw: drawB },
    ]
    paintLayerStack(mainCtx, 10, 10, items, [], undefined, undefined, undefined, {
      'w:1': { maskedByKey: 'w:2', showSource: true },
    })
    // w:2 now ALSO paints directly on the main ctx (kept visible)...
    expect(drawA.mock.calls.some((c: any[]) => c[0] === mainCtx)).toBe(true)
    // ...while w:1 is still masked (rendered via offscreen, not directly on main).
    expect(drawB.mock.calls.every((c: any[]) => c[0] !== mainCtx)).toBe(true)
    expect(mainCtx.drawImage).toHaveBeenCalled()
  })

  it('renders an unmasked wired item directly onto the main ctx', () => {
    const mainCtx = stubCtx('main')
    const draw = vi.fn()
    const items: StackItem[] = [{ type: 'wired', key: 'w:1', draw }]
    paintLayerStack(mainCtx, 10, 10, items, [], undefined, undefined, undefined, {})
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toBe(mainCtx)
  })
})
