<template>
  <div style="padding: 8px; font: 12px monospace">shaderfx harness ready</div>
</template>

<script setup lang="ts">
import { expandPasses, shaderFx } from '~/lib/shaderfx/renderer'

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

if (import.meta.client) {
  ;(window as any).__renderShaderFx = renderJob
  ;(window as any).__renderPassesProbe = renderPassesProbe
}
</script>
