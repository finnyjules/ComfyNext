import { describe, it, expect } from 'vitest'
import { depthCacheKey, depthCacheName, assetType, safeAssetRelPath } from '~~/server/utils/depthCache'

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

describe('assetType', () => {
  it('defaults to input and accepts the three ComfyUI roots', () => {
    expect(assetType(undefined)).toBe('input')
    expect(assetType('')).toBe('input')
    for (const t of ['input', 'output', 'temp']) expect(assetType(t)).toBe(t)
  })
  it('rejects anything else rather than falling back to a default', () => {
    // Silently coercing an unknown root would read the wrong directory.
    expect(assetType('etc')).toBeNull()
    expect(assetType('../output')).toBeNull()
  })
})

describe('safeAssetRelPath', () => {
  it('returns a bare filename unchanged', () => {
    expect(safeAssetRelPath('shot.png')).toBe('shot.png')
  })
  it('joins a subfolder', () => {
    expect(safeAssetRelPath('depth_a.png', 'sailor_depth')).toBe('sailor_depth/depth_a.png')
  })
  it('refuses traversal in either part', () => {
    expect(safeAssetRelPath('../../etc/passwd')).toBeNull()
    expect(safeAssetRelPath('x.png', '../..')).toBeNull()
    expect(safeAssetRelPath('..')).toBeNull()
  })
  it('refuses absolute paths and backslashes', () => {
    expect(safeAssetRelPath('/etc/passwd')).toBeNull()
    expect(safeAssetRelPath('a\\b.png')).toBeNull()
    expect(safeAssetRelPath('x.png', '/abs')).toBeNull()
  })
  it('refuses an empty filename', () => {
    expect(safeAssetRelPath('')).toBeNull()
    expect(safeAssetRelPath('   ')).toBeNull()
  })
})
