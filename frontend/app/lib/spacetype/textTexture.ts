import * as THREE from 'three'

export interface TextTextureOptions {
  label: string                 // already includes the trailing gap (buildRibbonLabel)
  fontFamily: string
  fontWeight: number
  axes: Record<string, number>  // variable-font axes, e.g. { wght: 700 }
  typeColor: string
  /** Texture pixel height; width is derived to fit ONE tile of the label. */
  heightPx?: number
  fontSizePx?: number
}

/** Format axes as a CSS font-variation-settings value. Pure + unit-tested. */
export function axesToVariation(axes: Record<string, number>): string {
  const parts = Object.entries(axes).map(([tag, v]) => `"${tag}" ${v}`)
  return parts.join(', ')
}

/**
 * Render ONE tile of the label to a transparent canvas and return a repeating
 * THREE.CanvasTexture. The ribbon geometry repeats this texture along its
 * length; scrolling is done by offsetting texture.offset.x in the effect.
 */
export function makeTextTexture(opts: TextTextureOptions): THREE.CanvasTexture {
  const h = opts.heightPx ?? 256
  const fontPx = opts.fontSizePx ?? Math.round(h * 0.7)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${opts.fontWeight} ${fontPx}px "${opts.fontFamily}", sans-serif`

  // Measure with a temporary context state.
  ctx.font = font
  const variation = axesToVariation(opts.axes)
  if (variation && 'fontVariationSettings' in ctx) {
    ;(ctx as CanvasRenderingContext2D & { fontVariationSettings: string }).fontVariationSettings = variation
  }
  const w = Math.max(2, Math.ceil(ctx.measureText(opts.label).width))

  canvas.width = w
  canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.font = font
  if (variation && 'fontVariationSettings' in ctx) {
    ;(ctx as CanvasRenderingContext2D & { fontVariationSettings: string }).fontVariationSettings = variation
  }
  ctx.fillStyle = opts.typeColor
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(opts.label, 0, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}
