import { describe, it, expect, vi } from 'vitest'
import { ensureSpaceTypeBake, type SpaceTypeBake } from '../../app/lib/spacetype/bake'

const cfg = { effectId: 'ribbon', params: { rows: 11 }, fps: 30, loopDuration: 2, W: 640, H: 360 }

function deps() {
  const renderFrame = vi.fn(async (_i: number) => new Blob(['x'], { type: 'image/png' }))
  const upload = vi.fn(async (blobs: Blob[]) => blobs.map((_, i) => `st_${i}.png`))
  return { renderFrame, upload }
}

describe('ensureSpaceTypeBake', () => {
  it('renders frameCount frames and returns frames + source_key', async () => {
    const { renderFrame, upload } = deps()
    const bake = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    expect(renderFrame).toHaveBeenCalledTimes(60) // 30fps * 2s
    expect(bake.frames.length).toBe(60)
    expect(bake.fps).toBe(30)
    expect(bake.source_key).toBeTruthy()
  })

  it('returns the cached bake without re-rendering when source_key matches', async () => {
    const { renderFrame, upload } = deps()
    const first = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    renderFrame.mockClear(); upload.mockClear()
    const second = await ensureSpaceTypeBake(cfg, first, { renderFrame, upload })
    expect(renderFrame).not.toHaveBeenCalled()
    expect(second).toBe(first)
  })

  it('re-bakes when a param changes', async () => {
    const { renderFrame, upload } = deps()
    const first = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    renderFrame.mockClear()
    const changed = { ...cfg, params: { rows: 12 } }
    const second = await ensureSpaceTypeBake(changed, first, { renderFrame, upload })
    expect(renderFrame).toHaveBeenCalledTimes(60)
    expect(second.source_key).not.toBe(first.source_key)
  })

  it('throws if upload returns fewer frames than rendered', async () => {
    const renderFrame = vi.fn(async () => new Blob(['x']))
    const upload = vi.fn(async (b: Blob[]) => b.slice(1).map((_, i) => `st_${i}.png`))
    await expect(ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })).rejects.toThrow(/uploaded/)
  })
})
