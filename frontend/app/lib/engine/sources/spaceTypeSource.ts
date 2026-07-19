// frontend/app/lib/engine/sources/spaceTypeSource.ts
/** Renders a Space Type clip per frame through the shared pooled engine and
 *  hands the WebGL canvas straight to GlRenderer.setSource — no pixel readback,
 *  since a WebGL canvas is a valid TexImageSource.
 *
 *  Safe to share one engine across every instance: getFrame's contract is that
 *  the returned image is valid only until the next getFrame call, and
 *  WebGLPreviewRenderer.renderFrame uploads to a texture before advancing. */
import type { Clip, SpaceTypeClip } from '~~/shared/timeline/types'
import { dimsFromKey } from '~/lib/spacetype/state'
import { renderSpaceTypeClipToCanvas } from '~/lib/engine/spaceTypeClipRenderer'
import { acquireSpaceTypeEngine, releaseSpaceTypeEngine, type SpaceTypeEngineHandle } from '~/lib/engine/spaceTypeEnginePool'
import type { FrameSource } from './frameSource'

export class SpaceTypeSource implements FrameSource {
  private w: number
  private h: number
  private fallback: HTMLCanvasElement | null = null
  private released = false
  private handle: SpaceTypeEngineHandle | null

  constructor(private clip: SpaceTypeClip, private fps: number) {
    const [W, H] = dimsFromKey(clip.state.dimsKey)
    this.w = W
    this.h = H
    // Acquire ONCE per source, at construction — never per frame. See the
    // ownership contract at the top of spaceTypeEnginePool.ts. Null means
    // WebGL2 is permanently unavailable; getFrame then emits transparent.
    this.handle = acquireSpaceTypeEngine()
  }

  static supports(clip: Clip): clip is SpaceTypeClip {
    return clip.kind === 'spacetype'
  }

  get width(): number { return this.w }
  get height(): number { return this.h }

  async getFrame(n: number): Promise<TexImageSource> {
    const canvas = this.handle && renderSpaceTypeClipToCanvas(this.handle, this.clip, n, this.fps)
    if (canvas) return canvas
    // No WebGL2, or a render error: emit a transparent frame so one bad clip
    // never fails the whole composite.
    if (!this.fallback) {
      this.fallback = document.createElement('canvas')
      this.fallback.width = this.w
      this.fallback.height = this.h
    }
    return this.fallback
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    releaseSpaceTypeEngine(this.handle)
    this.handle = null
    if (this.fallback) {
      this.fallback.width = 0
      this.fallback.height = 0
      this.fallback = null
    }
  }
}
