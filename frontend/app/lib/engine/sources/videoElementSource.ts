import type { FrameSource } from './frameSource'

/** Seek-and-capture fallback for sources WebCodecs can't decode (codec gaps,
 *  Safari quirks — the design doc's failure ladder). Frame accuracy is
 *  best-effort: browsers snap currentTime seeks; expect ±1 frame.
 *  Out-of-range frames WRAP (n % frameCount) to match the Python exporter
 *  (render_frame_np: ct = local_t % src_T) and the old Canvas2D preview —
 *  when a timeline clip outlasts its source, it loops. */
export class VideoElementSource implements FrameSource {
  private frameCount: number

  private constructor(private video: HTMLVideoElement, private fps: number) {
    this.frameCount = Math.max(1, Math.round(video.duration * fps))
  }

  static async load(url: string, fps: number): Promise<VideoElementSource> {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error(`VideoElementSource: failed to load ${url}`))
    })
    return new VideoElementSource(video, fps)
  }

  get width(): number { return this.video.videoWidth }
  get height(): number { return this.video.videoHeight }

  async getFrame(n: number): Promise<TexImageSource> {
    const wrapped = ((Math.trunc(n) % this.frameCount) + this.frameCount) % this.frameCount
    const target = (wrapped + 0.5) / this.fps   // mid-frame avoids boundary snapping
    if (Math.abs(this.video.currentTime - target) > 1e-4) {
      this.video.currentTime = target
      await new Promise<void>((resolve) => {
        this.video.onseeked = () => resolve()
      })
    }
    return this.video
  }

  dispose(): void {
    this.video.removeAttribute('src')
    this.video.load()
  }
}
