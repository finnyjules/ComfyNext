import { beforeEach, describe, expect, it } from 'vitest'
import {
  getStudioFrameSource,
  isAnimatedSource,
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'

const stub = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({} as any),
  duration: 4,
  fps: 30,
  width: 1920,
  height: 1080,
  ...over,
})

describe('studio frame-source registry', () => {
  beforeEach(() => {
    unregisterStudioFrameSource('a')
    unregisterStudioFrameSource('b')
  })

  it('returns undefined for an unregistered id', () => {
    expect(getStudioFrameSource('a')).toBeUndefined()
  })

  it('returns the registered source', () => {
    const s = stub()
    registerStudioFrameSource('a', s)
    expect(getStudioFrameSource('a')).toBe(s)
  })

  it('keeps ids independent', () => {
    const a = stub({ duration: 2 }), b = stub({ duration: 9 })
    registerStudioFrameSource('a', a)
    registerStudioFrameSource('b', b)
    expect(getStudioFrameSource('a')?.duration).toBe(2)
    expect(getStudioFrameSource('b')?.duration).toBe(9)
  })

  it('unregister removes only that id', () => {
    registerStudioFrameSource('a', stub())
    registerStudioFrameSource('b', stub())
    unregisterStudioFrameSource('a')
    expect(getStudioFrameSource('a')).toBeUndefined()
    expect(getStudioFrameSource('b')).toBeDefined()
  })

  it('re-registering the same id replaces the previous source', () => {
    const first = stub({ duration: 1 }), second = stub({ duration: 7 })
    registerStudioFrameSource('a', first)
    registerStudioFrameSource('a', second)
    expect(getStudioFrameSource('a')).toBe(second)
  })

  // duration <= 0 means "this is a still" — the spec's rule for a studio with
  // no motion tracks and zero flow speed.
  it('treats duration > 0 as animated', () => {
    expect(isAnimatedSource(stub({ duration: 4 }))).toBe(true)
  })

  it('treats zero and negative duration as a still', () => {
    expect(isAnimatedSource(stub({ duration: 0 }))).toBe(false)
    expect(isAnimatedSource(stub({ duration: -1 }))).toBe(false)
  })

  it('treats a missing source as a still', () => {
    expect(isAnimatedSource(undefined)).toBe(false)
    expect(isAnimatedSource(null)).toBe(false)
  })
})
