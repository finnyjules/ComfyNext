import type { EditState } from './types'

// Contract every timeline preview backend implements. The editor and the
// Playwright golden harness talk only to this — the server-frame renderer
// (ground truth, slow) and the Phase-1 WebGL engine (fast) are interchangeable
// behind it. renderFrame() must draw the exact requested frame: no
// "close enough" seeking, that's the whole point.
export interface PreviewRenderer {
  /** Prepare sources for `state`. Call again whenever the state changes. */
  load(state: EditState): Promise<void>
  /** Draw output frame `frame` into `target` at state.canvas resolution. */
  renderFrame(frame: number, target: HTMLCanvasElement): Promise<void>
  dispose(): void
}
