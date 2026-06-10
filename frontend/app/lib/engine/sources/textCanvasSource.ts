import type { Clip, TitleClip, LowerThirdClip } from '~~/shared/timeline/types'
import { renderTitleClip, renderLowerThirdClip } from '~/composables/useAnimatedTextRenderer'
import type { FrameSource } from './frameSource'

/** Rasterizes animated text (title / lower_third) per frame onto an offscreen
 *  canvas that the GL layer uploads as a full-canvas texture. Reuses the SAME
 *  pure draws as the Canvas2D preview (useAnimatedTextRenderer) — one text
 *  implementation, two compositors.
 *
 *  Behavior delta vs the old preview (deliberate): the draw list applies
 *  transforms/keyframes/fades to these entries uniformly, matching how BAKED
 *  titles behave in exports. The old preview ignored transforms on live titles. */
export class TextCanvasSource implements FrameSource {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor(
    private clip: TitleClip | LowerThirdClip,
    private canvasW: number,
    private canvasH: number,
    private fps: number,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasW
    this.canvas.height = canvasH
    this.ctx = this.canvas.getContext('2d')!
  }

  static supports(clip: Clip): clip is TitleClip | LowerThirdClip {
    return clip.kind === 'title' || clip.kind === 'lower_third'
  }

  get width(): number { return this.canvasW }
  get height(): number { return this.canvasH }

  async getFrame(n: number): Promise<TexImageSource> {
    this.ctx.clearRect(0, 0, this.canvasW, this.canvasH)
    if (this.clip.kind === 'title') {
      renderTitleClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    } else {
      renderLowerThirdClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    }
    return this.canvas
  }

  dispose(): void {
    this.canvas.width = 0
    this.canvas.height = 0
  }
}
