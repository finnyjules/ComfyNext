import type { FrameSource } from './frameSource'

/** A still image fetched from a URL, decoded once. */
export class ImageSource implements FrameSource {
  private constructor(private bitmap: ImageBitmap) {}

  static async load(url: string): Promise<ImageSource> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`ImageSource: ${res.status} fetching ${url}`)
    return new ImageSource(await createImageBitmap(await res.blob()))
  }

  get width(): number { return this.bitmap.width }
  get height(): number { return this.bitmap.height }

  async getFrame(): Promise<TexImageSource> {
    return this.bitmap
  }

  dispose(): void {
    this.bitmap.close()
  }
}
