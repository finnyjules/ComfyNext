import * as THREE from 'three'

/**
 * String effect texture tiles (STG /string textures.js).
 *
 * Each tile is ONE repeat painted to a <canvas> and wrapped as a repeating
 * THREE.CanvasTexture (wrapS = Repeat for the scroll, wrapT = ClampToEdge across
 * the strip). The geometry's U = arcLength / (aspect · stripHeight) drives the
 * repeat, so we return the tile aspect alongside the texture.
 */

export type TextureMode = 'text' | 'grad1' | 'grad2' | 'stripes'

export interface Tile {
  texture: THREE.CanvasTexture
  /** tileWidthPx / tileHeightPx — sets the geometry's U repeat length. */
  aspect: number
}

const TILE_H = 70 // STG pgTextSize

function finish(canvas: HTMLCanvasElement, outline: boolean, outlineColor: string): Tile {
  if (outline) {
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return { texture, aspect: canvas.width / canvas.height }
}

/** Text tile: the word in `fore` on a solid `bg` (knot-1) background (textures.js:51–64). */
export function makeTextTile(opts: {
  text: string; fontFamily: string; fontWeight: number; fore: string; bg: string
  fontSizePx?: number; outline?: boolean
}): Tile {
  const fontPx = opts.fontSizePx ?? TILE_H
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${opts.fontWeight} ${fontPx}px "${opts.fontFamily}", sans-serif`
  ctx.font = font
  const label = opts.text && opts.text.length ? opts.text : ' '
  const textW = Math.max(1, ctx.measureText(label).width)
  const pad = fontPx * 0.6 // fixed padding (replaces STG's self-tuning textureUnit)
  canvas.width = Math.max(2, Math.ceil(textW + pad * 2))
  canvas.height = TILE_H
  ctx.fillStyle = opts.bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = font
  ctx.fillStyle = opts.fore
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, canvas.width / 2, canvas.height / 2)
  return finish(canvas, !!opts.outline, opts.fore)
}

function lerpKnots(knots: string[], t: number): string {
  const c = knots.length >= 2 ? knots : [knots[0] ?? '#ffffff', knots[0] ?? '#ffffff']
  const seg = 1 / (c.length - 1)
  const i = Math.min(c.length - 2, Math.floor(t / seg))
  const local = (t - i * seg) / seg
  const a = new THREE.Color(c[i]!)
  const b = new THREE.Color(c[i + 1]!)
  const r = a.clone().lerp(b, Math.max(0, Math.min(1, local)))
  return `#${r.getHexString()}`
}

/** Gradient 1 (pgGH): 5-knot gradient ACROSS the strip width (textures.js:128). */
export function makeGradient1Tile(knots: string[], outline = false): Tile {
  const W = 256
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = TILE_H
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, TILE_H)
  for (let i = 0; i < knots.length; i++) g.addColorStop(i / Math.max(1, knots.length - 1), knots[i]!)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, TILE_H)
  return finish(canvas, outline, knots[0] ?? '#ffffff')
}

/** Gradient 2 (pgG): 5-knot gradient ALONG the ribbon length (textures.js:94). */
export function makeGradient2Tile(knots: string[], outline = false): Tile {
  const W = 512
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = TILE_H
  const ctx = canvas.getContext('2d')!
  // Run knot0→…→knotN→knot0 so the tile loops seamlessly when repeated.
  const loop = [...knots, knots[0] ?? '#ffffff']
  for (let x = 0; x <= W; x++) { ctx.fillStyle = lerpKnots(loop, x / W); ctx.fillRect(x, 0, 1, TILE_H) }
  return finish(canvas, outline, knots[0] ?? '#ffffff')
}

/** Stripes: `fore` background with horizontal lines in `bg` (textures.js:73). */
export function makeStripesTile(fore: string, bg: string, outline = false): Tile {
  const W = 512
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = TILE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fore
  ctx.fillRect(0, 0, W, TILE_H)
  ctx.strokeStyle = bg
  ctx.lineWidth = 4
  for (let i = 0; i <= 5; i++) {
    const y = (i * TILE_H) / 5
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  return finish(canvas, outline, fore)
}
