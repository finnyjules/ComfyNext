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

if (import.meta.client) {
  ;(window as any).__renderShaderFx = renderJob
}
</script>
