import { describe, it, expect } from 'vitest'
import {
  registerWebGLContext, liveWebGLContextCount, liveWebGLContextLabels,
  onWebGLContextChange, WEBGL_CONTEXT_SOFT_CAP,
} from '~/lib/webgl/contextRegistry'

describe('webgl context registry', () => {
  it('counts live contexts and frees them on release', () => {
    const base = liveWebGLContextCount()
    const a = registerWebGLContext('Scene3D')
    const b = registerWebGLContext('Shape')
    expect(liveWebGLContextCount()).toBe(base + 2)
    expect(liveWebGLContextLabels()).toEqual(expect.arrayContaining(['Scene3D', 'Shape']))
    a.release()
    expect(liveWebGLContextCount()).toBe(base + 1)
    b.release()
    expect(liveWebGLContextCount()).toBe(base)
  })

  it('release is idempotent (dispose may run twice)', () => {
    const base = liveWebGLContextCount()
    const h = registerWebGLContext('PoseEditor')
    expect(liveWebGLContextCount()).toBe(base + 1)
    h.release()
    h.release() // must not underflow the count
    expect(liveWebGLContextCount()).toBe(base)
  })

  it('notifies subscribers on register and release', () => {
    const seen: number[] = []
    const off = onWebGLContextChange((n) => seen.push(n))
    const h = registerWebGLContext('Artifact3D')
    h.release()
    off()
    // one bump up, one back down — exact values depend on other live contexts,
    // but the last two observations must differ by exactly 1.
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.at(-2)! - seen.at(-1)!).toBe(1)
  })

  it('exposes a sane soft cap', () => {
    expect(WEBGL_CONTEXT_SOFT_CAP).toBeGreaterThan(0)
    expect(WEBGL_CONTEXT_SOFT_CAP).toBeLessThanOrEqual(16)
  })
})
