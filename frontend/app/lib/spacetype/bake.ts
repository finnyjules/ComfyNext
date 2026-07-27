import { spaceTypeSourceKey, type SourceKeyInput } from './sourceKey'

export interface SpaceTypeBake {
  source_key: string
  frames: string[]   // input/ filenames, frame order
  fps: number
}

export interface BakeDeps {
  /** Render frame i and return its PNG blob. */
  renderFrame: (index: number) => Promise<Blob>
  /** Upload blobs, returning input/ filenames in order. Defaults to uploadFrameBatch. */
  upload?: (blobs: Blob[]) => Promise<string[]>
  onProgress?: (done: number, total: number) => void
}

/**
 * Produce (or reuse) a baked PNG sequence for a Space Type config. Mirrors
 * lib/engine/motionClipBake's contract: same source_key + same frame count ⇒
 * return the cached bake untouched.
 */
export async function ensureSpaceTypeBake(
  cfg: SourceKeyInput,
  cached: SpaceTypeBake | undefined,
  deps: BakeDeps,
): Promise<SpaceTypeBake> {
  const key = spaceTypeSourceKey(cfg)
  const total = Math.max(1, Math.round(cfg.fps * cfg.loopDuration))
  if (cached && cached.source_key === key && cached.frames.length === total) return cached

  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    blobs.push(await deps.renderFrame(i))
    deps.onProgress?.(i + 1, total)
  }

  const upload = deps.upload ?? (async (b: Blob[]) => {
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    return uploadFrameBatch(b, 'spacetype')
  })
  const frames = await upload(blobs)
  if (frames.length !== blobs.length) {
    throw new Error(`space type bake: uploaded ${frames.length}/${blobs.length} frames — retry`)
  }
  return { source_key: key, frames, fps: cfg.fps }
}
