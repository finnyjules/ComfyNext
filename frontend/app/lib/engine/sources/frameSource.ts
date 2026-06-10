// Frame acquisition contract for the engine. The compositor/GL layer never
// know which implementation produced a texture. M2 adds WebCodecsSource and
// VideoElementSource behind this same interface (see the Phase-1 design doc).
export interface FrameSource {
  /** Natural pixel size of the source (drives aspect-fit quantization). */
  readonly width: number
  readonly height: number
  /** The image for clip-local source frame `n`. Static sources ignore `n`. */
  getFrame(n: number): Promise<TexImageSource>
  dispose(): void
}
