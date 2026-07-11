import type { EditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'

// PreviewRenderer that asks the Python exporter for each frame
// (/sailor/timeline/render_frame → render_frame_np). Slow by design — it
// exists as ground truth: it validates the harness pipeline in Phase 0 and is
// the reference the WebGL engine gets diffed against during Phase-1 bring-up.
export class ServerFrameRenderer implements PreviewRenderer {
  private state: EditState | null = null

  async load(state: EditState): Promise<void> {
    this.state = state
  }

  async renderFrame(frame: number, target: HTMLCanvasElement): Promise<void> {
    if (!this.state) throw new Error('ServerFrameRenderer: load() first')
    const res = await fetch('/sailor/timeline/render_frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: this.state, frame }),
    })
    if (!res.ok) throw new Error(`render_frame failed: ${res.status}`)
    const bmp = await createImageBitmap(await res.blob())
    target.width = bmp.width
    target.height = bmp.height
    target.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
  }

  dispose(): void {
    this.state = null
  }
}
