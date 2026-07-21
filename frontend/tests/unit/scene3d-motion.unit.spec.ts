import { describe, it, expect } from 'vitest'
import { parseDoc, serializeDoc, defaultDoc, createPrimitive } from '~/lib/scene3d/config'
import type { ObjectMotion } from '~/lib/scene3d/motion/types'
import { DEFAULT_SCENE_MOTION } from '~/lib/scene3d/motion/types'

describe('scene3d motion — config parse', () => {
  it('defaults scene motion when absent', () => {
    const doc = parseDoc(serializeDoc(defaultDoc()))
    expect(doc.motion).toEqual(DEFAULT_SCENE_MOTION)
  })

  it('round-trips object + camera motion', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box', doc.objects)
    const motion: ObjectMotion = {
      loop: { kind: 'spin', speed: 2, amount: 1 },
      in: { preset: 'move', duration: 0.6, direction: 'left', ease: { kind: 'bezier', cps: [0, 0, 0.58, 1] } },
      offset: 0.2,
    }
    obj.motion = motion
    doc.objects.push(obj)
    doc.motion = { duration: 5, fps: 24, loop: true }
    doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }

    const round = parseDoc(serializeDoc(doc))
    expect(round.motion).toEqual({ duration: 5, fps: 24, loop: true })
    expect(round.objects[0]!.motion).toEqual(motion)
    expect(round.camera.motion).toEqual({ preset: 'orbit', speed: 1, amount: 1 })
  })

  it('drops malformed object motion to undefined', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box', doc.objects)
    doc.objects.push(obj)
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].motion = { loop: { kind: 'not-a-kind', speed: 'x' } }
    const round = parseDoc(JSON.stringify(raw))
    expect(round.objects[0]!.motion).toBeUndefined()
  })

  it('absent motion key round-trips to defaults, objects unchanged', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box', doc.objects)
    obj.position = [1, 2, 3]
    doc.objects.push(obj)
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.motion
    const round = parseDoc(JSON.stringify(raw))
    expect(round.motion).toEqual(DEFAULT_SCENE_MOTION)
    expect(round.objects[0]!.position).toEqual([1, 2, 3])
    expect(round.objects[0]!.motion).toBeUndefined()
  })

  it('malformed scene motion falls back to defaults without throwing', () => {
    const doc = defaultDoc()
    const raw = JSON.parse(serializeDoc(doc))
    raw.motion = 'garbage'
    const round = parseDoc(JSON.stringify(raw))
    expect(round.motion).toEqual(DEFAULT_SCENE_MOTION)
  })

  it('malformed camera motion drops to undefined', () => {
    const doc = defaultDoc()
    const raw = JSON.parse(serializeDoc(doc))
    raw.camera.motion = { preset: 'not-a-preset' }
    const round = parseDoc(JSON.stringify(raw))
    expect(round.camera.motion).toBeUndefined()
  })
})

describe('scene3d motion — resolveEaseRef', () => {
  it('bezier endpoints anchored', async () => {
    const { resolveEaseRef } = await import('~/lib/scene3d/motion/ease')
    const f = resolveEaseRef({ kind: 'bezier', cps: [0.34, 1.56, 0.64, 1] })
    expect(f(0)).toBeCloseTo(0, 6)
    expect(f(1)).toBeCloseTo(1, 6)
    expect(f(0.5)).toBeGreaterThan(0.5) // ease-out-ish region
  })
  it('bezier overshoot exceeds 1 mid-curve', async () => {
    const { resolveEaseRef } = await import('~/lib/scene3d/motion/ease')
    const f = resolveEaseRef({ kind: 'bezier', cps: [0.34, 1.56, 0.64, 1] })
    const peak = Math.max(...Array.from({ length: 19 }, (_, i) => f((i + 1) / 20)))
    expect(peak).toBeGreaterThan(1)
  })
  it('named procedural resolves and anchors', async () => {
    const { resolveEaseRef } = await import('~/lib/scene3d/motion/ease')
    for (const name of ['bounce', 'elastic', 'spring'] as const) {
      const f = resolveEaseRef({ kind: 'named', name })
      expect(f(0)).toBeCloseTo(0, 4)
      expect(f(1)).toBeCloseTo(1, 4)
    }
  })
})

describe('scene3d motion — loop presets close seamlessly', () => {
  const kinds = ['spin', 'bob', 'pulse', 'orbit', 'sway', 'tumble'] as const
  for (const kind of kinds) {
    it(`${kind} identity-equivalent at t=0 and t=1`, async () => {
      const { evaluateLoop } = await import('~/lib/scene3d/motion/presets')
      const a = evaluateLoop({ kind, speed: 2, amount: 1 }, 0)
      const b = evaluateLoop({ kind, speed: 2, amount: 1 }, 1)
      // positions & scale return exactly; rotations return mod 2π
      expect(a.dPosition.map(v => +v.toFixed(6))).toEqual(b.dPosition.map(v => +v.toFixed(6)))
      expect(a.scaleMul.map(v => +v.toFixed(6))).toEqual(b.scaleMul.map(v => +v.toFixed(6)))
      const wrap = (r: number) => +(((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(5)
      expect(a.dRotation.map(wrap)).toEqual(b.dRotation.map(wrap))
    })
  }
  it('none is identity', async () => {
    const { evaluateLoop } = await import('~/lib/scene3d/motion/presets')
    expect(evaluateLoop({ kind: 'none', speed: 1, amount: 1 }, 0.37).dPosition).toEqual([0, 0, 0])
  })
})

describe('scene3d motion — transitions', () => {
  it('move-in travels from offset to home', async () => {
    const { evaluateTransition, MOVE_DIST } = await import('~/lib/scene3d/motion/presets')
    const start = evaluateTransition('move', 'left', 0, 'in')
    const end = evaluateTransition('move', 'left', 1, 'in')
    expect(start.dPosition![0]).toBeCloseTo(-MOVE_DIST, 6)
    expect(end.dPosition![0]).toBeCloseTo(0, 6)
  })
  it('fade-in ramps opacity 0→1; fade-out 1→0', async () => {
    const { evaluateTransition } = await import('~/lib/scene3d/motion/presets')
    expect(evaluateTransition('fade', undefined, 0, 'in').opacity).toBeCloseTo(0, 6)
    expect(evaluateTransition('fade', undefined, 1, 'in').opacity).toBeCloseTo(1, 6)
    expect(evaluateTransition('fade', undefined, 1, 'out').opacity).toBeCloseTo(0, 6)
  })
  it('pop overshoots scale above 1 mid-progress', async () => {
    const { evaluateTransition } = await import('~/lib/scene3d/motion/presets')
    const mid = evaluateTransition('pop', undefined, 0.7, 'in')
    expect(mid.scaleMul![0]).toBeGreaterThan(1)
  })
  it('directionVector maps axes', async () => {
    const { directionVector } = await import('~/lib/scene3d/motion/presets')
    expect(directionVector('right', 3)).toEqual([3, 0, 0])
    expect(directionVector('top', 3)).toEqual([0, 3, 0])
  })
})
