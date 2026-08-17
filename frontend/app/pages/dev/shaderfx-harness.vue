<template>
  <div style="padding: 8px; font: 12px monospace">shaderfx harness ready</div>
</template>

<script setup lang="ts">
import { expandPasses, shaderFx } from '~/lib/shaderfx/renderer'
import { applyPost } from '~/lib/studio/post/chain'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import { POST_EFFECTS } from '~/lib/studio/post/manifest'

interface HarnessJob {
  effectId: string
  source: string
  uniforms: Record<string, number>
  /** dataURL -> uniform name, e.g. { u_glyphs: 'data:image/png;base64,...' } */
  textures: Record<string, string>
  baseDataUrl: string
  width: number
  height: number
  /** Multi-pass ping-pong count (default 1). */
  passes?: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

async function renderJob(job: HarnessJob): Promise<string> {
  const base = await loadImage(job.baseDataUrl)
  const textures: Record<string, TexImageSource> = {}
  for (const [name, url] of Object.entries(job.textures)) textures[name] = await loadImage(url)
  const passes = expandPasses(job.effectId, job.source, job.uniforms, textures, job.passes ?? 1)
  const canvas = shaderFx.render(passes, base, job.width, job.height)
  return canvas.toDataURL('image/png')
}

// Render hand-built passes directly (for verifying the layer-source / captureSource
// path). base is a solid-color dataURL; returns the center pixel [r,g,b,a] 0..255.
async function renderPassesProbe(passes: any[], baseDataUrl: string, w: number, h: number): Promise<number[]> {
  const base = await loadImage(baseDataUrl)
  const glCanvas = shaderFx.render(passes, base, w, h)
  // shaderFx's canvas is WebGL — copy into a 2D canvas to sample a pixel.
  const probe = document.createElement('canvas'); probe.width = w; probe.height = h
  const ctx = probe.getContext('2d')!
  ctx.drawImage(glCanvas, 0, 0)
  const px = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data
  return [px[0]!, px[1]!, px[2]!, px[3]!]
}

// Alpha probe for the shared post chain (Task 4). Builds a frame that is
// opaque on the left, fully transparent on the right (with an unsampled gap
// between so a blur-ish effect's radius can't bleed a measurement across the
// seam), runs applyPost with the named effects enabled, and reports whether
// transparency and its colour survived the whole chain.
async function sailorPostAlphaProbe(opts: { effects: string[] }): Promise<{
  transparentMaxAlpha: number
  transparentMaxLuma: number
  opaqueMinAlpha: number
}> {
  const W = 256
  const H = 128
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sctx = src.getContext('2d')!
  // Left band [0,96): opaque mid-grey, so grain/bloom have something visible to
  // act on. Right of x=160 stays canvas-default transparent black — untouched.
  sctx.fillStyle = 'rgb(128,128,128)'
  sctx.fillRect(0, 0, 96, H)

  const post = { ...DEFAULT_POST } as typeof DEFAULT_POST
  for (const id of opts.effects) {
    const def = POST_EFFECTS.find(e => e.id === id)
    if (def) (post as unknown as Record<string, boolean>)[def.enableKey] = true
  }

  const result = applyPost(src, post, W, H, 0)
  const probe = document.createElement('canvas')
  probe.width = W
  probe.height = H
  const pctx = probe.getContext('2d')!
  pctx.drawImage(result as CanvasImageSource, 0, 0)

  // Sampled well inside each band, clear of the [96,160) buffer zone.
  const opaque = pctx.getImageData(16, 16, 48, H - 32).data
  const transparent = pctx.getImageData(192, 16, 48, H - 32).data

  let opaqueMinAlpha = 255
  for (let i = 3; i < opaque.length; i += 4) opaqueMinAlpha = Math.min(opaqueMinAlpha, opaque[i]!)

  let transparentMaxAlpha = 0
  let transparentMaxLuma = 0
  for (let i = 0; i < transparent.length; i += 4) {
    transparentMaxAlpha = Math.max(transparentMaxAlpha, transparent[i + 3]!)
    transparentMaxLuma = Math.max(transparentMaxLuma, transparent[i]!, transparent[i + 1]!, transparent[i + 2]!)
  }

  return { transparentMaxAlpha, transparentMaxLuma, opaqueMinAlpha }
}

// Grain-gate probe for post_grain (Task 4 fix pass, Finding 5). The alpha
// probe above draws the result canvas into a 2D canvas and calls
// getImageData — but Chromium's 2D backing store is PREMULTIPLIED 8-bit, so
// once alpha hits 0 the RGB channels are destroyed by the premultiply itself,
// not by the shader. That test can only prove "alpha==0 pixels read back as
// 0,0,0,0"; it says nothing about whether the grain effect's own gate is
// doing real work at a PARTIAL alpha, which is the antialiased-edge case the
// gate exists for. This probe instead reads straight, unpremultiplied pixels
// directly off the WebGL canvas via gl.readPixels (the chain's context is
// created with premultipliedAlpha: false, preserveDrawingBuffer: true), and
// builds three vertical bands at alpha 1 / 0.5 / 0 so grain amplitude can be
// compared across all three in one pass.
async function sailorPostGrainGateProbe(): Promise<{
  opaqueDev: number
  halfDev: number
  transparentDev: number
}> {
  const W = 240
  const H = 64
  const BAND = 64 // band width; gaps between bands avoid any cross-seam bleed
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sctx = src.getContext('2d')!
  sctx.clearRect(0, 0, W, H)
  sctx.fillStyle = 'rgba(128,128,128,1)'
  sctx.fillRect(0, 0, BAND, H) // opaque band
  sctx.fillStyle = 'rgba(128,128,128,0.5)'
  sctx.fillRect(88, 0, BAND, H) // half-alpha band
  sctx.fillStyle = 'rgba(128,128,128,0)'
  sctx.fillRect(176, 0, BAND, H) // fully transparent band

  const post = { ...DEFAULT_POST, grain: true, grainAmount: 1, grainSize: 1 } as typeof DEFAULT_POST
  const result = applyPost(src, post, W, H, 0) as HTMLCanvasElement
  const gl = result.getContext('webgl2')!
  const pixels = new Uint8Array(W * H * 4)
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

  // Standard deviation of R WITHIN the band (against the band's own mean, not
  // a fixed baseline) — deliberately NOT "deviation from 128". The fully-
  // transparent band's true 128-grey never survives the 2D source canvas: a
  // premultiplied 8-bit backing store destroys RGB at alpha=0 regardless of
  // how the pixel was written (fillStyle or putImageData alike), so that
  // band's pixels arrive at the shader already ~(0,0,0) — comparing against
  // 128 there would measure the canvas's premultiply, not the shader. Local
  // stddev sidesteps that: it measures how much pixel-to-pixel NOISE the
  // grain effect added on top of whatever flat base each band actually has,
  // which is 0 when the gate correctly suppresses grain and clearly nonzero
  // (~3-4 at these settings) when it doesn't. Sampled well inside each band
  // (clear of its own edges) and over the full height (readPixels' bottom-up
  // vs canvas top-down orientation only flips rows, never columns, so it
  // doesn't matter which rows land where for a purely x-banded probe).
  function bandDev(x0: number, x1: number): number {
    let sum = 0
    let sumSq = 0
    let n = 0
    for (let y = 0; y < H; y++) {
      for (let x = x0 + 8; x < x1 - 8; x++) {
        const i = (y * W + x) * 4
        const v = pixels[i]!
        sum += v
        sumSq += v * v
        n++
      }
    }
    if (n === 0) return 0
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    return Math.sqrt(Math.max(0, variance))
  }

  return {
    opaqueDev: bandDev(0, BAND),
    halfDev: bandDev(88, 88 + BAND),
    transparentDev: bandDev(176, 176 + BAND),
  }
}

// Renders `effectId` alone, at the catalog's default parameters, over a
// non-flat OPAQUE test pattern (alpha 1 throughout, so the 2D canvas'
// premultiply round-trip used by drawImage/getImageData below is lossless —
// unlike the grain-gate probe above, this test has no partial-alpha pixels to
// worry about), and reports whether ANY pixel differs from the untouched
// input. Would have caught Critical 1 (Task 4 fix pass): before chain.ts
// seeded catalog defaults, an effect with no Sailor-mapped params (glitch:
// `params: []`) rendered a byte-exact no-op, because every one of its
// uniforms sat at GL's implicit 0 for an unset uniform.
async function sailorPostChangesPixels(effectId: string): Promise<boolean> {
  const W = 64
  const H = 64
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sctx = src.getContext('2d')!
  const grad = sctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#204060')
  grad.addColorStop(1, '#f0a020')
  sctx.fillStyle = grad
  sctx.fillRect(0, 0, W, H)
  const inData = sctx.getImageData(0, 0, W, H).data

  const post = { ...DEFAULT_POST } as typeof DEFAULT_POST
  const def = POST_EFFECTS.find(e => e.id === effectId)
  if (def) (post as unknown as Record<string, boolean>)[def.enableKey] = true

  const result = applyPost(src, post, W, H, 0.7)
  const probe = document.createElement('canvas')
  probe.width = W
  probe.height = H
  const pctx = probe.getContext('2d')!
  pctx.drawImage(result as CanvasImageSource, 0, 0)
  const outData = pctx.getImageData(0, 0, W, H).data

  for (let i = 0; i < inData.length; i++) if (inData[i] !== outData[i]) return true
  return false
}

// Per-effect mask confinement proof. Runs a trivial, unmistakable effect (colour
// invert) over a solid base, confined by a `studio:mask` pass, and reports the
// output at the region centre vs. a far corner alongside the untouched base
// colour. If the mask works: the centre reads the inverted colour (effect
// applied) while the corner reads the base colour (effect masked out). Isolates
// the mask/snapshot/GLSL region path from any specific effect's maths.
async function maskProbe(maskComposite: Record<string, number>): Promise<{
  base: number[]; center: number[]; corner: number[]
}> {
  const W = 128, H = 128
  const R = 60, G = 120, B = 200
  const src = document.createElement('canvas'); src.width = W; src.height = H
  const sctx = src.getContext('2d')!
  sctx.fillStyle = `rgb(${R},${G},${B})`; sctx.fillRect(0, 0, W, H)
  const INVERT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = vec4(1.0 - texture(u_image0, v_texCoord).rgb, 1.0); }`
  const passes = [
    { id: 'mask-probe-invert', source: INVERT_FS, uniforms: { u_pass: 0, u_passCount: 1 }, snapshot: true },
    { id: 'studio:mask', source: '', uniforms: {}, maskComposite },
  ]
  const glCanvas = shaderFx.render(passes as any, await loadImage(src.toDataURL('image/png')), W, H)
  const probe = document.createElement('canvas'); probe.width = W; probe.height = H
  const ctx = probe.getContext('2d')!
  ctx.drawImage(glCanvas, 0, 0)
  const at = (x: number, y: number) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0]!, d[1]!, d[2]!] }
  return { base: [R, G, B], center: at(W / 2, H / 2), corner: at(6, 6) }
}

if (import.meta.client) {
  ;(window as any).__renderShaderFx = renderJob
  ;(window as any).__maskProbe = maskProbe
  ;(window as any).__renderPassesProbe = renderPassesProbe
  ;(window as any).__sailorPostAlphaProbe = sailorPostAlphaProbe
  ;(window as any).__sailorPostGrainGateProbe = sailorPostGrainGateProbe
  ;(window as any).__sailorPostChangesPixels = sailorPostChangesPixels
}
</script>
