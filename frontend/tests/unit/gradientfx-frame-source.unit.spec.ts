// frontend/tests/unit/gradientfx-frame-source.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { makeGradientFrameSource } from '~/lib/gradientfx/frameSource'

const cfg = (over: any = {}) => ({
  motion: { tracks: [], duration: 6, fps: 30, size: 1080 },
  flow: { speed: 0 },
  canvas: { aspect: '16:9' },
  ...over,
})

describe('makeGradientFrameSource', () => {
  it('reports the config duration and fps as its clock when flow speed drives motion', () => {
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed: 50 } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(6)
    expect(src.fps).toBe(30)
  })

  it('reports duration 0 when there are no tracks and no flow speed', () => {
    const src = makeGradientFrameSource({ getConfig: () => cfg(), render: () => ({} as any) })
    expect(src.duration).toBe(0)
  })

  it('reports the config duration when motion tracks exist even with zero flow speed', () => {
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ motion: { tracks: [{ path: 'flow.angle' }], duration: 3, fps: 25 } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(3)
    expect(src.fps).toBe(25)
  })

  // The renderer takes ABSOLUTE seconds; the registry contract is NORMALIZED
  // 0..1. Getting this conversion wrong is the most likely silent bug, because
  // it still animates — just at the wrong rate.
  it('converts normalized t01 to absolute seconds for the renderer', async () => {
    const calls: number[] = []
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed: 50 } }),
      render: (_c, _w, _h, time) => { calls.push(time); return {} as any },
    })
    await src.getFrame(0, 10, 10)
    await src.getFrame(0.5, 10, 10)
    await src.getFrame(1, 10, 10)
    expect(calls).toEqual([0, 3, 6])   // duration 6
  })

  it('passes the requested size straight through to the renderer', async () => {
    const sizes: Array<[number, number]> = []
    const src = makeGradientFrameSource({
      getConfig: () => cfg(),
      render: (_c, w, h) => { sizes.push([w, h]); return {} as any },
    })
    await src.getFrame(0, 640, 360)
    expect(sizes).toEqual([[640, 360]])
  })

  it('reads config lazily so later edits are picked up', async () => {
    let speed = 0
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(0)
    speed = 70
    expect(src.duration).toBe(6)
  })
})
