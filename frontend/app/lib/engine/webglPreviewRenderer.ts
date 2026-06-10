import type { EditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'
import { buildDrawList, hexToRgb } from './compositor'
import { GlRenderer } from './gl/glRenderer'
import { ImageSource } from './sources/imageSource'
import { WebCodecsSource, UnsupportedSourceError } from './sources/webCodecsSource'
import { VideoElementSource } from './sources/videoElementSource'
import type { FrameSource } from './sources/frameSource'

// Deterministic WebGL implementation of the PreviewRenderer seam: load()
// fetches every image/video clip's source (clip.path must be a fetchable URL
// in this context — the golden spec rewrites fixture paths to routed URLs),
// renderFrame() composites exactly frame n. Video uses the source ladder:
// WebCodecs (frame-exact) with video-element fallback when unsupported.
export class WebGLPreviewRenderer implements PreviewRenderer {
  private state: EditState | null = null
  private gl: GlRenderer | null = null
  private sources = new Map<string, FrameSource>()

  async load(state: EditState): Promise<void> {
    this.disposeSources()
    this.gl ??= new GlRenderer()
    this.state = state

    const loads: Promise<void>[] = []
    for (const track of state.tracks) {
      if (track.kind === 'audio') continue
      for (const clip of track.clips) {
        if ((clip.kind !== 'image' && clip.kind !== 'video') || !clip.path) {
          if (clip.kind !== 'image' && clip.kind !== 'video') {
            console.warn(`WebGLPreviewRenderer: skipping unsupported clip kind '${clip.kind}' (M2)`)
          }
          continue
        }
        const url = clip.path
        if (clip.kind === 'video') {
          loads.push(
            WebCodecsSource.load(url)
              .catch((e) => {
                if (e instanceof UnsupportedSourceError) {
                  console.warn(`WebGLPreviewRenderer: WebCodecs unavailable for ${url} (${e.message}) — video-element fallback`)
                  return VideoElementSource.load(url, state.canvas.fps)
                }
                throw e
              })
              .then((src) => { this.sources.set(clip.id, src) }),
          )
        } else {
          loads.push(ImageSource.load(url).then(src => { this.sources.set(clip.id, src) }))
        }
      }
    }
    await Promise.all(loads)
  }

  async renderFrame(frame: number, target: HTMLCanvasElement): Promise<void> {
    if (!this.state || !this.gl) throw new Error('WebGLPreviewRenderer: load() first')
    const W = this.state.canvas.width
    const H = this.state.canvas.height

    const dims = new Map<string, { w: number; h: number }>()
    for (const [id, src] of this.sources) dims.set(id, { w: src.width, h: src.height })
    const entries = buildDrawList(this.state, frame, dims)

    for (const e of entries) {
      const frameImg = await this.sources.get(e.clipId)!.getFrame(e.sourceFrame)
      this.gl.setSource(e.clipId, frameImg, e.sourceFrame)
    }
    this.gl.render(entries, hexToRgb(this.state.canvas.bg_color), W, H)

    target.width = W
    target.height = H
    target.getContext('2d')!.drawImage(this.gl.canvas, 0, 0)
  }

  private disposeSources(): void {
    for (const s of this.sources.values()) s.dispose()
    this.sources.clear()
    this.gl?.clearSources()
  }

  dispose(): void {
    this.disposeSources()
    this.gl?.dispose()
    this.gl = null
    this.state = null
  }
}
