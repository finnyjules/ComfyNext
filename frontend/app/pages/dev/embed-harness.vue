<script setup lang="ts">
import { onMounted } from 'vue'
import { loadEmbedSurface } from '~/lib/embed/surfaces'
import { exportEmbedHtml } from '~/lib/embed/export'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { defaultConfig, newLayerId } from '~/lib/shaderstudio/types'
import { shaderFx } from '~/lib/shaderfx/renderer'
import { composePasses } from '~/lib/shaderstudio/passes'
// Same module shader.ts's adapter pulls these from (not resolve.ts, which
// transitively imports Vue) — studioRef below must mirror the adapter's own
// import path, not just its behavior.
import { applyMotion, motionConfigFor } from '~/lib/shaderstudio/motion'
import { gradientFx } from '~/lib/gradientfx/renderer'
// The studio's own default-config builder — the same one GradientStudioNode
// seeds a fresh node from (see GradientStudioNode.vue's defaultConfig import).
// Aliased: shader.ts's defaultConfig (shaderstudio/types) is already imported
// above under the same name.
import { defaultConfig as gradientDefaultConfig } from '~/lib/gradientfx/randomize'
import type { EmbedHandle } from '~/lib/embed/contract'
import type { ShaderEmbedConfig } from '~/lib/embed/surfaces/shader'
import type { GradientEmbedConfig } from '~/lib/embed/surfaces/gradient'

// Test-only page. Exposes mount/snapshot so tests drive the contract directly
// rather than through studio UI.
const handles: Record<string, EmbedHandle> = {}

// Matches defaultConfig().motion.duration. The studio's duration slider is
// min=1 max=12, so the old value of 30 modelled a clock no real export can
// produce — a fixture has to be reachable in the product.
const DURATION = 4

// Matches the adapter's 1x1 opaque black base for generative (texture-free)
// effects — see shader.ts's blackPixel().
function blackBase(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1; c.height = 1
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1)
  return c
}
// Created inside onMounted, not at module scope: this page is SSR-rendered
// (like any Nuxt page) even though it is test-only, and `document` does not
// exist during SSR — a module-scope call here 500s the page before any test
// ever gets to it.
let BASE: HTMLCanvasElement

onMounted(async () => {
  BASE = blackBase()
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
    // Mounts with a caller-supplied ShaderEmbedConfig rather than the fixed
    // default — lets tests exercise shapes the default (generative, no motion)
    // config can't, e.g. a config with motion tracks.
    async mountConfig(slot: string, cfg: ShaderEmbedConfig) {
      const surface = await loadEmbedSurface('shader')
      if (!surface) return null
      const el = document.getElementById(`slot-${slot}`)!
      const h = await surface.mount(el, cfg)
      handles[slot] = h
      return h
    },
    snapshot(slot: string): string {
      const c = document.querySelector(`#slot-${slot} canvas`) as HTMLCanvasElement | null
      return c ? c.toDataURL('image/png') : ''
    },
    async exportHtml() {
      return await exportEmbedHtml({
        kind: 'shader',
        config,
        duration: DURATION,
        width: 512,
        height: 512,
      })
    },

    // Exports at a caller-chosen size so a test can load the result in a
    // viewport with a DIFFERENT aspect ratio and check the piece keeps the
    // exported one instead of stretching to the window.
    async exportHtmlAt(width: number, height: number) {
      return await exportEmbedHtml({ kind: 'shader', config, duration: DURATION, width, height })
    },

    // Exports a caller-supplied config — used to measure payload size against a
    // realistic (image-backed) config rather than the generative fixture, which
    // carries no image at all.
    async exportWith(cfg: ShaderEmbedConfig, width: number, height: number) {
      return await exportEmbedHtml({ kind: 'shader', config: cfg, duration: DURATION, width, height })
    },

    /**
     * Renders through the STUDIO path — the shaderFx singleton plus
     * composePasses — exactly as ShaderStudioSurface.vue's renderFrame does,
     * motion included. This is the parity reference: if the adapter diverges
     * from this, the adapter has drifted.
     *
     * Motion must be applied here too: shader.ts's draw() runs a config with
     * motion tracks through applyMotion(motionConfigFor(...)) before
     * composePasses ever sees it (mirroring renderFrame). A studioRef that
     * skipped this would diverge from the adapter the moment a config has
     * motion — the reference has to be the studio, not a simplification of it.
     */
    studioRef(t01: number): string {
      const t = t01 * DURATION
      const animated = (config.cfg.motion?.tracks?.length ?? 0) > 0
      const cfg = animated ? applyMotion(motionConfigFor(config.cfg, DURATION), t) : config.cfg
      const passes = composePasses(cfg, (id: string) => config.defs.find(d => d.id === id) ?? null, t)
      return shaderFx.render(passes, BASE, 512, 512).toDataURL('image/png')
    },

    /**
     * Test-only: perturb the config so the parity diff MUST fail. Changes a real
     * float uniform rather than opacity — a single base layer takes no composite
     * pass (`stacked` is false in composePasses), so opacity alone can be a no-op.
     */
    corrupt() {
      const p = config.defs[0]!.params.find(x => x.type === 'float')
      if (!p) throw new Error('harness: chosen effect has no float param to corrupt')
      const bad = p.max ?? (p.default + 1)
      for (const layer of config.cfg.effects) {
        layer.params = { ...layer.params, [p.uniform]: bad === p.default ? p.min ?? 0 : bad }
      }
    },
  }
  ;(window as any).__embedHarnessReady = true

  // --- Gradient embed harness ---
  // Started minimal (loop-duration reconciliation only); this block now also
  // carries the default contract/parity fixture for embed-gradient.spec.ts's
  // full suite. Built from the studio's OWN defaults (gradientDefaultConfig,
  // i.e. gradientfx/randomize.ts's defaultConfig — the same builder
  // GradientStudioNode seeds a fresh node from) rather than a hand-authored
  // shape, plus one motion track so time genuinely moves the render.
  const gradientHandles: Record<string, EmbedHandle> = {}
  const GRADIENT_DURATION = 4
  const gradientCfg = gradientDefaultConfig('embed-gradient-task3')
  // relief.grain 0->1, delay: 0 — visually obvious and, like the
  // loop-duration fixture above, depends only on t/duration.
  gradientCfg.motion = {
    tracks: [{ path: 'relief.grain', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }],
    duration: GRADIENT_DURATION, fps: 30, size: 1080,
  }
  const gradientConfig: GradientEmbedConfig = { cfg: gradientCfg, duration: GRADIENT_DURATION }

  ;(window as any).__embedHarnessGradient = {
    config: gradientConfig,
    async mount(slot: string) {
      const surface = await loadEmbedSurface('gradient')
      if (!surface) return null
      const el = document.getElementById(`slot-${slot}`)!
      const h = await surface.mount(el, gradientConfig)
      gradientHandles[slot] = h
      return h
    },
    // Mounts with a caller-supplied GradientEmbedConfig rather than the fixed
    // default — lets tests exercise shapes the default fixture can't (e.g. a
    // different motion.duration than the embed's own).
    async mountConfig(slot: string, cfg: GradientEmbedConfig) {
      const surface = await loadEmbedSurface('gradient')
      if (!surface) return null
      const el = document.getElementById(`slot-${slot}`)!
      const h = await surface.mount(el, cfg)
      gradientHandles[slot] = h
      return h
    },
    snapshot(slot: string): string {
      const c = document.querySelector(`#slot-${slot} canvas`) as HTMLCanvasElement | null
      return c ? c.toDataURL('image/png') : ''
    },
    async exportHtml() {
      return await exportEmbedHtml({
        kind: 'gradient',
        config: gradientConfig,
        duration: GRADIENT_DURATION,
        width: 512,
        height: 512,
      })
    },
    /**
     * Renders through the STUDIO path — the gradientFx singleton, exactly as
     * GradientStudioNode.vue / frameSource.ts call it — at t01. frameSource.ts
     * always derives its clock from `cfg.motion.duration` (never a separately
     * chosen export duration), so that field IS the studio's duration; this is
     * the parity reference the gradient embed adapter's reconciliation must
     * match regardless of what `duration` an export was told to use.
     */
    studioRef(cfg: any, t01: number, w = 512, h = 512): string {
      const duration = cfg.motion?.duration || 4
      return gradientFx.render(cfg, w, h, t01 * duration).toDataURL('image/png')
    },
    /**
     * Test-only: perturb the fixture so a parity diff MUST fail. Changes the
     * first layer's first color stop — the ramp LUT built from `stops` feeds
     * pixels directly (buildRampLut in gradientfx/ramp.ts), so this is visible
     * regardless of which flow/motion params happen to be active. Unlike e.g.
     * flow.intensity, which is a no-op while flow.speed is 0 in this fixture,
     * a color-stop change can never be a no-op.
     */
    corrupt() {
      const stop = gradientCfg.layers[0]?.color?.stops?.[0]
      if (!stop) throw new Error('harness: gradient fixture has no color stop to corrupt')
      stop.color = stop.color === '#00ff00' ? '#f9d9f0' : '#00ff00'
    },
  }
  ;(window as any).__embedHarnessGradientReady = true
})
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-sm opacity-60">embed harness (test only)</h1>
    <div id="slot-a" class="w-[512px] h-[512px] bg-black" />
    <div id="slot-b" class="w-[512px] h-[512px] bg-black" />
    <div id="slot-g" class="w-[512px] h-[512px] bg-black" />
    <div id="slot-g2" class="w-[512px] h-[512px] bg-black" />
  </div>
</template>
