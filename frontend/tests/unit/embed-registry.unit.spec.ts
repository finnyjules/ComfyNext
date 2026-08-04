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

  it('lists gradient as an embeddable kind', () => {
    expect(embedSurfaceKinds()).toContain('gradient')
  })

  it('loads the gradient surface with the right kind and declared caps', async () => {
    const s = await loadEmbedSurface('gradient')
    expect(s).not.toBeNull()
    expect(s!.kind).toBe('gradient')
    expect(typeof s!.caps.alpha).toBe('boolean')
  })

  it('lists spacetype as an embeddable kind', () => {
    expect(embedSurfaceKinds()).toContain('spacetype')
  })

  it('loads the spacetype surface with the right kind and genuine alpha support', async () => {
    const s = await loadEmbedSurface('spacetype')
    expect(s).not.toBeNull()
    expect(s!.kind).toBe('spacetype')
    // Unlike shader/gradient (both measured opaque), Space Type's engine is
    // constructed with alpha:true and genuinely clears to transparent when
    // opts.alpha is set (engine.ts's applyBackground) — the first real
    // consumer of EmbedCaps.alpha / EmbedSnapshot.transparent.
    expect(s!.caps.alpha).toBe(true)
  })
})
