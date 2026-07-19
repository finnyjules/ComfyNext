// frontend/app/lib/studio/frameSource.ts
// Cross-studio frame-puller registry. Studios are time-parameterized renderers,
// so a downstream consumer (Shader Studio) can pull any frame at any size rather
// than waiting for a baked file. Sibling of cascade.ts's StudioBaker registry,
// which stays as-is for the single-still bake path.

/**
 * A studio's live frame puller.
 *
 * `getFrame` renders at normalized loop time `t01` (0..1) at the requested pixel
 * size and returns a texture-uploadable surface — usually the studio's own
 * canvas. The returned surface is only valid until the next `getFrame` call on
 * the same source (renderers reuse one canvas), so consumers must upload it to a
 * texture before pulling again.
 *
 * `duration` is the source's natural clock in seconds; `<= 0` means "still".
 */
export interface StudioFrameSource {
  getFrame: (t01: number, w: number, h: number) => Promise<TexImageSource>
  duration: number
  fps: number
  width: number
  height: number
}

const _frameSources = new Map<string, StudioFrameSource>()

export function registerStudioFrameSource(id: string, src: StudioFrameSource): void {
  _frameSources.set(id, src)
}

export function unregisterStudioFrameSource(id: string): void {
  _frameSources.delete(id)
}

export function getStudioFrameSource(id: string): StudioFrameSource | undefined {
  return _frameSources.get(id)
}

/** True when a source has a real clock — drives whether consumers run a preview loop. */
export function isAnimatedSource(src: StudioFrameSource | undefined | null): boolean {
  return !!src && src.duration > 0
}
