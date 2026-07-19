// frontend/tests/unit/shaderstudio-resolve.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'
import {
  exportClock,
  makeImageSource,
  makeLiveSource,
  motionConfigFor,
  resolveSourceKind,
} from '~/lib/shaderstudio/resolve'

const frames = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({ tag: 'frame' } as any),
  duration: 6,
  fps: 24,
  width: 800,
  height: 600,
  ...over,
})

const shader = { id: 's1', data: {} }
const edgeInto = (from: string) => [{ source: from, target: 's1', targetHandle: 'input-0' }]

describe('resolveSourceKind', () => {
  beforeEach(() => { unregisterStudioFrameSource('up') })

  it('returns null with nothing wired', () => {
    expect(resolveSourceKind('s1', [shader], [])).toBeNull()
  })

  it('prefers a live upstream frame source over the artifact file', () => {
    // The upstream node ALSO has an artifact image — live must still win.
    const up = { id: 'up', data: { images: ['/view?filename=stale.png'] } }
    const src = frames()
    registerStudioFrameSource('up', src)
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'live', source: src })
  })

  it('falls back to the artifact url when the upstream has no frame source', () => {
    const up = { id: 'up', data: { images: ['/view?filename=x.png'] } }
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'url', url: '/view?filename=x.png' })
  })

  // An unmounted / never-opened studio registers nothing. Resolution must fall
  // through rather than fail — same tolerance runStudioCascade has for bakers.
  it('falls through when an upstream studio is unmounted and has no artifact', () => {
    const up = { id: 'up', type: 'space-type', data: {} }
    expect(resolveSourceKind('s1', [shader, up], edgeInto('up'))).toBeNull()
  })

  it('ignores a frame source registered under a node that is not wired in', () => {
    registerStudioFrameSource('other', frames())
    const up = { id: 'up', data: { images: ['/view?filename=x.png'] } }
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'url', url: '/view?filename=x.png' })
    unregisterStudioFrameSource('other')
  })

  // Spec: "each Shader Studio node reads its DIRECT upstream only... the nearest
  // animated ancestor wins". In A -> B -> s1, s1 must see B, never A.
  it('reads only the direct upstream in a chain', () => {
    const a = frames({ duration: 99 }), b = frames({ duration: 2 })
    registerStudioFrameSource('A', a)
    registerStudioFrameSource('B', b)
    const nodes = [shader, { id: 'A', data: {} }, { id: 'B', data: {} }]
    const edges = [
      { source: 'A', target: 'B', targetHandle: 'input-0' },
      { source: 'B', target: 's1', targetHandle: 'input-0' },
    ]
    expect(resolveSourceKind('s1', nodes, edges)).toEqual({ kind: 'live', source: b })
    unregisterStudioFrameSource('A')
    unregisterStudioFrameSource('B')
  })

  // Only input-0 feeds the shader stack; the VARS input must never be mistaken
  // for an image source.
  it('ignores edges into handles other than input-0', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const up = { id: 'up', data: {} }
    const edges = [{ source: 'up', target: 's1', targetHandle: 'input-1' }]
    expect(resolveSourceKind('s1', [shader, up], edges)).toBeNull()
  })
})

describe('makeLiveSource', () => {
  it('carries the upstream clock and dimensions through', () => {
    const r = makeLiveSource(frames({ duration: 3, fps: 60, width: 100, height: 50 }))
    expect(r.duration).toBe(3)
    expect(r.fps).toBe(60)
    expect(r.width).toBe(100)
    expect(r.height).toBe(50)
    expect(r.isLive).toBe(true)
  })

  it('delegates getFrame with the requested time and size', async () => {
    const calls: Array<[number, number, number]> = []
    const r = makeLiveSource(frames({
      getFrame: async (t, w, h) => { calls.push([t, w, h]); return {} as any },
    }))
    await r.getFrame(0.25, 640, 480)
    expect(calls).toEqual([[0.25, 640, 480]])
  })
})

describe('makeImageSource', () => {
  it('is a still with the image natural dimensions', () => {
    const r = makeImageSource({ naturalWidth: 1200, naturalHeight: 900 })
    expect(r.width).toBe(1200)
    expect(r.height).toBe(900)
    expect(r.duration).toBe(0)
    expect(r.isLive).toBe(false)
  })

  it('returns the same image regardless of requested time or size', async () => {
    const img = { naturalWidth: 10, naturalHeight: 10 }
    const r = makeImageSource(img)
    expect(await r.getFrame(0.9, 999, 999)).toBe(img)
  })
})

describe('exportClock', () => {
  it('uses the live upstream clock when the source is animated', () => {
    const r = makeLiveSource(frames({ duration: 6, fps: 24 }))
    expect(exportClock(r, 4, 30)).toEqual({ duration: 6, fps: 24 })
  })

  it('falls back to own settings for a still source', () => {
    const r = makeImageSource({ naturalWidth: 4, naturalHeight: 4 })
    expect(exportClock(r, 4, 30)).toEqual({ duration: 4, fps: 30 })
  })

  it('falls back to own settings with no source at all', () => {
    expect(exportClock(null, 2, 12)).toEqual({ duration: 2, fps: 12 })
  })

  // A live source with duration <= 0 is a still by the spec's rule, so the
  // consumer's own clock governs — NOT a zero-length export.
  it('falls back to own settings for a live source with zero duration', () => {
    const r = makeLiveSource(frames({ duration: 0, fps: 24 }))
    expect(exportClock(r, 5, 30)).toEqual({ duration: 5, fps: 30 })
  })
})

// The spec's rule: motion tracks "stretch to span the upstream duration, so a
// from->to ramp runs exactly once across the clip". applyMotion divides by
// cfg.motion.duration internally (motion.ts:72), so feeding it absolute seconds
// from a DIFFERENT clock silently runs tracks at the wrong rate — 1.5 loops for a
// 6s source against a 4s config. This helper is what prevents that.
describe('motionConfigFor', () => {
  const cfg = { motion: { duration: 4, fps: 30, tracks: [{ path: 'adjust.hue' }] }, resolution: 1536 }

  it('overrides motion.duration with the supplied clock', () => {
    expect(motionConfigFor(cfg, 6).motion.duration).toBe(6)
  })

  it('preserves every other motion field', () => {
    const out = motionConfigFor(cfg, 6)
    expect(out.motion.fps).toBe(30)
    expect(out.motion.tracks).toEqual([{ path: 'adjust.hue' }])
  })

  it('preserves non-motion config', () => {
    expect(motionConfigFor(cfg, 6).resolution).toBe(1536)
  })

  it('does not mutate the input config', () => {
    motionConfigFor(cfg, 99)
    expect(cfg.motion.duration).toBe(4)
  })

  it('is identity-equivalent when the clock already matches', () => {
    expect(motionConfigFor(cfg, 4).motion.duration).toBe(4)
  })
})
