import type { FrameSource } from './frameSource'
import { ImageSource } from './imageSource'

/** Pure index math, mirrors the existing preview's frame-sequence addressing
 *  (clip-local frame + in_frame, wrapped modulo sequence length). */
export function sequenceIndex(localFrame: number, inFrame: number, length: number): number {
  if (length <= 1) return 0
  return ((localFrame + inFrame) % length + length) % length
}

/** A baked frame sequence (e.g. kinetic-title PNGs), preloaded like today's
 *  Canvas2D preview does. */
export class SequenceSource implements FrameSource {
  private constructor(private frames: ImageSource[], private inFrame: number) {}

  static async load(urls: string[], inFrame = 0): Promise<SequenceSource> {
    const frames = await Promise.all(urls.map(u => ImageSource.load(u)))
    if (!frames.length) throw new Error('SequenceSource: empty url list')
    return new SequenceSource(frames, inFrame)
  }

  get width(): number { return this.frames[0]!.width }
  get height(): number { return this.frames[0]!.height }

  getFrame(n: number): Promise<TexImageSource> {
    return this.frames[sequenceIndex(n, this.inFrame, this.frames.length)]!.getFrame()
  }

  dispose(): void {
    for (const f of this.frames) f.dispose()
  }
}
