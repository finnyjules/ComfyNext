import { buildEmbedHtml } from './bundle'
import { loadEmbedSurface } from './surfaces'
import type { EmbedSnapshot } from './contract'

export interface ExportEmbedOptions {
  kind: string
  config: unknown
  duration: number
  width: number
  height: number
  transparent?: boolean
  /** Loop position the still frame is baked from. */
  posterT01?: number
}

/**
 * Bakes the poster using the EMBED adapter rather than the studio's own bake
 * path, so the fallback frame is guaranteed to match what the embed renders.
 */
async function bakePoster(
  kind: string, config: unknown, width: number, height: number, t01: number,
): Promise<string> {
  const surface = await loadEmbedSurface(kind)
  if (!surface) throw new Error(`embed: unknown surface kind "${kind}"`)

  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px`
  document.body.appendChild(box)
  try {
    const handle = await surface.mount(box, config)
    handle.setSize(width, height)
    handle.setTime(t01)
    const canvas = box.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) throw new Error('embed: adapter produced no canvas')
    const url = canvas.toDataURL('image/png')
    handle.destroy()
    return url
  } finally {
    box.remove()
  }
}

export async function exportEmbedHtml(opts: ExportEmbedOptions): Promise<string> {
  const surface = await loadEmbedSurface(opts.kind)
  if (!surface) throw new Error(`embed: unknown surface kind "${opts.kind}"`)

  const transparent = !!opts.transparent && surface.caps.alpha
  const posterDataUrl = await bakePoster(
    opts.kind, opts.config, opts.width, opts.height, opts.posterT01 ?? 0,
  )

  // Emitted by `npm run build:embed`. Same-origin, read once at export time —
  // the produced file itself never fetches anything.
  const res = await fetch(`/embed/${opts.kind}.js`)
  if (!res.ok) {
    throw new Error(`embed: /embed/${opts.kind}.js missing — run \`npm run build:embed\``)
  }
  const adapterJs = await res.text()

  const snapshot: EmbedSnapshot = {
    kind: opts.kind,
    config: opts.config,
    duration: opts.duration,
    width: opts.width,
    height: opts.height,
    posterDataUrl,
    transparent,
  }
  return buildEmbedHtml(snapshot, adapterJs)
}

export function downloadEmbed(filename: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
