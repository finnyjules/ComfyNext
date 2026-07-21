import { describe, it, expect } from 'vitest'
import { useBrushPaint } from '~/composables/useBrushPaint'

describe('useBrushPaint', () => {
  it('radiusNorm maps display px to width fraction', () => {
    const b = useBrushPaint(); b.sizePx.value = 48
    expect(b.radiusNorm(960)).toBeCloseTo(0.025, 4) // 24 / 960
  })
  it('builds a stroke from points and honors eraser/hardness/opacity', () => {
    const b = useBrushPaint()
    b.sizePx.value = 40; b.hardness.value = 0.5; b.opacity.value = 0.7; b.eraser.value = true
    b.beginStroke(0.1, 0.1, 1000); b.extendStroke(0.2, 0.2); b.extendStroke(0.3, 0.25)
    const s = b.endStroke()!
    expect(s.points.length).toBe(3)
    expect(s.erase).toBe(true)
    expect(s.hardness).toBe(0.5)
    expect(s.opacity).toBe(0.7)
    expect(s.radius).toBeCloseTo(0.02, 4) // 20 / 1000
    expect(b.endStroke()).toBe(null)      // cleared after finish
  })
  it('setActive(false) drops any live stroke', () => {
    const b = useBrushPaint()
    b.beginStroke(0.1, 0.1, 1000); b.setActive(false)
    expect(b.hasLiveStroke.value).toBe(false)
  })
})
