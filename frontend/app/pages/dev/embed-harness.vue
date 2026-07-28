<script setup lang="ts">
import { onMounted } from 'vue'
import { loadEmbedSurface } from '~/lib/embed/surfaces'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { defaultConfig, newLayerId } from '~/lib/shaderstudio/types'
import type { EmbedHandle } from '~/lib/embed/contract'
import type { ShaderEmbedConfig } from '~/lib/embed/surfaces/shader'

// Test-only page. Exposes mount/snapshot so tests drive the contract directly
// rather than through studio UI.
const handles: Record<string, EmbedHandle> = {}

const DURATION = 30

onMounted(async () => {
  const cat = await fetchShaderFxCatalog()
  // Generative AND texture-free: needs no input image and no asset payload,
  // which is exactly what the v1 adapter supports.
  const effect = cat.effects.find(e => e.generative && !e.textures?.length)
    ?? cat.effects.find(e => !e.textures?.length)!

  const cfg = defaultConfig()
  cfg.effects = [{
    id: effect.id,
    params: {},          // resolveUniforms fills catalog defaults
    enabled: true,
    blend: 'normal',
    opacity: 1,
    layerId: newLayerId(),
  }]

  // baseDataUrl null: the harness deliberately uses a generative effect so the
  // contract tests carry no image payload.
  const config: ShaderEmbedConfig = { cfg, defs: [effect], duration: DURATION, baseDataUrl: null }

  ;(window as any).__embedHarness = {
    config,
    async mount(slot: string) {
      const surface = await loadEmbedSurface('shader')
      if (!surface) return null
      const el = document.getElementById(`slot-${slot}`)!
      const h = await surface.mount(el, config)
      handles[slot] = h
      return h
    },
    snapshot(slot: string): string {
      const c = document.querySelector(`#slot-${slot} canvas`) as HTMLCanvasElement | null
      return c ? c.toDataURL('image/png') : ''
    },
  }
  ;(window as any).__embedHarnessReady = true
})
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-sm opacity-60">embed harness (test only)</h1>
    <div id="slot-a" class="w-[512px] h-[512px] bg-black" />
    <div id="slot-b" class="w-[512px] h-[512px] bg-black" />
  </div>
</template>
