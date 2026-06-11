// frontend/tests/unit/motion-text-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { layoutTextUnits } from '../../app/lib/motion/animatedText'
import { createTextLayer } from '../../app/composables/useCompositorLayers'

// Minimal measureText stub: every char is 10px wide at any font.
function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
  } as unknown as CanvasRenderingContext2D
}

describe('layoutTextUnits', () => {
  it('lays out one cell per char with monotonic x and line-based y', () => {
    const layer = createTextLayer({ text: 'AB\nC', x: 0.5, y: 0.5, fontSize: 0.1, lineHeight: 1.2, align: 'left' })
    const cells = layoutTextUnits(stubCtx(), layer, 1000, 1000)
    expect(cells.length).toBe(3) // whitespace-only chars get no cell; newline splits lines
    expect(cells[0].char).toBe('A')
    expect(cells[1].x).toBeGreaterThan(cells[0].x)
    expect(cells[2].y).toBeGreaterThan(cells[0].y) // second line lower
    // Cell height = fontSize px; cells carry the em box for unit-relative deltas
    expect(cells[0].h).toBeCloseTo(100, 3)
  })
  it('is deterministic', () => {
    const layer = createTextLayer({ text: 'HELLO' })
    const a = layoutTextUnits(stubCtx(), layer, 800, 600)
    const b = layoutTextUnits(stubCtx(), layer, 800, 600)
    expect(a).toEqual(b)
  })
})
