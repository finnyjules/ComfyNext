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

if (import.meta.client) {
  ;(window as any).__renderShaderFx = renderJob
  ;(window as any).__renderPassesProbe = renderPassesProbe
  ;(window as any).__sailorPostAlphaProbe = sailorPostAlphaProbe
}
</script>
