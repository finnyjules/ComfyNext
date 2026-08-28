import { describe, it, expect } from 'vitest'
import { createWiredLayer, wiredBoxFromWidgets, widgetsFromWiredBox } from '~/lib/compositor/wiredLayer'

describe('wired layer mapping', () => {
  const natural = { w: 800, h: 600 }          // content pixels
  const canvas = { w: 1024, h: 1024 }

  it('creates a wired layer with defaults matching the old default placement', () => {
    const l = createWiredLayer(3)
    expect(l.kind).toBe('wired')
    expect(l.slot).toBe(3)
    expect(l.x).toBeCloseTo(0.5)
    expect(l.y).toBeCloseTo(0.5)
    expect(l.rotation).toBe(0)
    expect(l.opacity).toBe(1)
  })

  it('round-trips widget transform -> box -> widget transform', () => {
    const tf = { x: 0.1, y: -0.2, rotation: 15, scale: 1.5, opacity: 0.8 }
    const box = wiredBoxFromWidgets(tf, natural, canvas)
    const back = widgetsFromWiredBox({ ...createWiredLayer(0), ...box }, natural, canvas)
    expect(back.x).toBeCloseTo(tf.x, 5)
    expect(back.y).toBeCloseTo(tf.y, 5)
    expect(back.rotation).toBeCloseTo(tf.rotation, 5)
    expect(back.scale).toBeCloseTo(tf.scale, 5)
    expect(back.opacity).toBeCloseTo(tf.opacity, 5)
  })

  it('identity transform maps to the same box the old fit-draw produced', () => {
    // scale=1, x=y=0 must reproduce the legacy "fit to canvas" box so migrated
    // frames render pixel-identically.
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, natural, canvas)
    expect(box.x).toBeCloseTo(0.5)
    expect(box.y).toBeCloseTo(0.5)
    // 800x600 in 1024x1024: fit => width-limited => w = 1 (full canvas width)
    expect(box.w).toBeCloseTo(1)
  })

  it('height-limited fit matches the legacy contain math', () => {
    // 600x800 (portrait) in 1024x1024: iAspect < cAspect => height-limited, so
    // fitH = H and fitW = H * iAspect => normalized w = 0.75.
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, { w: 600, h: 800 }, canvas)
    expect(box.w).toBeCloseTo(0.75)
    expect(box.lastAspect).toBeCloseTo(800 / 600)
  })

  it('records the content aspect so the unlinked state keeps its last size', () => {
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, natural, canvas)
    expect(box.lastAspect).toBeCloseTo(600 / 800)
  })

  it('round-trips on a non-square canvas', () => {
    const wide = { w: 1920, h: 1080 }
    const tf = { x: -0.33, y: 0.07, rotation: -42, scale: 0.65, opacity: 0.4 }
    const box = wiredBoxFromWidgets(tf, natural, wide)
    const back = widgetsFromWiredBox({ ...createWiredLayer(1), ...box }, natural, wide)
    expect(back.x).toBeCloseTo(tf.x, 5)
    expect(back.y).toBeCloseTo(tf.y, 5)
    expect(back.scale).toBeCloseTo(tf.scale, 5)
  })

  it('gives each created layer a distinct id', () => {
    expect(createWiredLayer(0).id).not.toBe(createWiredLayer(0).id)
  })
})
