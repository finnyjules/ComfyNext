import { describe, it, expect } from 'vitest'
import { embedSurfaceKinds, isEmbeddable, loadEmbedSurface } from '~/lib/embed/surfaces'

describe('embed surface registry', () => {
  it('lists shader as an embeddable kind', () => {
    expect(embedSurfaceKinds()).toContain('shader')
  })

  it('reports unknown kinds as not embeddable', () => {
    expect(isEmbeddable('shader')).toBe(true)
    expect(isEmbeddable('lipsync')).toBe(false)
    expect(isEmbeddable('')).toBe(false)
  })

  it('returns null for an unknown kind rather than throwing', async () => {
    await expect(loadEmbedSurface('nope')).resolves.toBeNull()
  })
})
