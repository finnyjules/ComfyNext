import { describe, it, expect } from 'vitest'
import { planOutpaint } from '~/lib/outpaint/plan'

describe('planOutpaint', () => {
  it('extends horizontally for a wider target (square → 16:9)', () => {
    const p = planOutpaint(1000, 1000, 16 / 9)
    // Height-matched, centered horizontally, side margins to fill.
    expect(p.canvasW).toBeGreaterThan(p.drawRect.w)
    expect(p.drawRect.h).toBe(p.canvasH)
    expect(p.drawRect.x).toBeGreaterThan(0)
    expect(p.drawRect.y).toBe(0)
    // Canvas aspect ≈ target.
    expect(p.canvasW / p.canvasH).toBeCloseTo(16 / 9, 1)
  })

  it('extends vertically for a taller target (square → 9:16)', () => {
    const p = planOutpaint(1000, 1000, 9 / 16)
    expect(p.canvasH).toBeGreaterThan(p.drawRect.h)
    expect(p.drawRect.w).toBe(p.canvasW)
    expect(p.drawRect.y).toBeGreaterThan(0)
    expect(p.drawRect.x).toBe(0)
    expect(p.canvasW / p.canvasH).toBeCloseTo(9 / 16, 1)
  })

  it('is a near no-op for an equal aspect (drawRect fills the canvas)', () => {
    const p = planOutpaint(800, 800, 1)
    expect(p.drawRect).toEqual({ x: 0, y: 0, w: p.canvasW, h: p.canvasH })
  })

  it('never crops the source: drawRect stays inside the canvas', () => {
    for (const [w, h, a] of [[1200, 800, 2], [500, 900, 1.4], [1000, 1000, 0.3], [640, 480, 1]] as const) {
      const p = planOutpaint(w, h, a)
      expect(p.drawRect.x).toBeGreaterThanOrEqual(0)
      expect(p.drawRect.y).toBeGreaterThanOrEqual(0)
      expect(p.drawRect.x + p.drawRect.w).toBeLessThanOrEqual(p.canvasW)
      expect(p.drawRect.y + p.drawRect.h).toBeLessThanOrEqual(p.canvasH)
      // Source aspect is preserved in the drawn rect.
      expect(p.drawRect.w / p.drawRect.h).toBeCloseTo(w / h, 1)
    }
  })

  it('caps the longest canvas side to `max`', () => {
    const p = planOutpaint(4000, 4000, 16 / 9, { max: 1536 })
    expect(Math.max(p.canvasW, p.canvasH)).toBeLessThanOrEqual(1536)
  })

  it('keepRect is inset from drawRect for a seam overlap', () => {
    const p = planOutpaint(1000, 1000, 16 / 9, { overlap: 0.05 })
    expect(p.keepRect.x).toBeGreaterThan(p.drawRect.x)
    expect(p.keepRect.y).toBeGreaterThan(p.drawRect.y)
    expect(p.keepRect.w).toBeLessThan(p.drawRect.w)
    expect(p.keepRect.h).toBeLessThan(p.drawRect.h)
  })

  it('overlap: 0 makes keepRect equal drawRect', () => {
    const p = planOutpaint(1000, 800, 2, { overlap: 0 })
    expect(p.keepRect).toEqual(p.drawRect)
  })
})
