import { describe, it, expect } from 'vitest'
import { depthCacheKey, depthCacheName } from '~~/server/utils/depthCache'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('depthCacheKey', () => {
  it('is stable for identical content', () => {
    expect(depthCacheKey(bytes('abc'))).toBe(depthCacheKey(bytes('abc')))
  })
  it('differs for different content', () => {
    expect(depthCacheKey(bytes('abc'))).not.toBe(depthCacheKey(bytes('abd')))
  })
  it('is filename-safe hex of fixed length', () => {
    expect(depthCacheKey(bytes('x'))).toMatch(/^[0-9a-f]{16}$/)
  })
  it('keys content, not identity — the same photo under two names shares a key', () => {
    expect(depthCacheKey(bytes('same-pixels'))).toBe(depthCacheKey(bytes('same-pixels')))
  })
})

describe('depthCacheName', () => {
  it('derives a png name from a key', () => {
    expect(depthCacheName('0123456789abcdef')).toBe('depth_0123456789abcdef.png')
  })
})
