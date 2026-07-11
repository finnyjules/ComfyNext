<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, reactive } from 'vue'
import { ShapeEngine } from '~/lib/shapefx/engine'
import { DEFAULT_CONFIG, type ShapeConfig } from '~/lib/shapefx/config'
import { reroll } from '~/lib/shapefx/randomize'
import { detectWebGL } from '~/lib/spacetype/webgl'

definePageMeta({ layout: false })

const canvas = ref<HTMLCanvasElement | null>(null)
const ok = ref(true)
let engine: ShapeEngine | null = null
const orbit = reactive({ yaw: 0.5, pitch: 0.3, zoom: 1 })
const config = ref<ShapeConfig>({ ...DEFAULT_CONFIG })

function draw() { engine?.setConfig(config.value); engine?.render(orbit) }
function setMode(m: 'primitive' | 'gem', primitive?: ShapeConfig['shape']['primitive']) {
  config.value = { ...config.value, shape: { ...config.value.shape, mode: m, ...(primitive ? { primitive } : {}) } }; draw()
}
function setFill(fillMode: ShapeConfig['fillMode']) { config.value = { ...config.value, fillMode }; draw() }
function setColoring(coloring: ShapeConfig['palette']['coloring']) { config.value = { ...config.value, palette: { ...config.value.palette, coloring } }; draw() }
function setDirection(direction: ShapeConfig['palette']['direction']) { config.value = { ...config.value, palette: { ...config.value.palette, direction } }; draw() }
function roll() { config.value = reroll(config.value); draw() }

onMounted(() => {
  if (!detectWebGL()) { ok.value = false; return }
  engine = new ShapeEngine(canvas.value!, 512, 512)
  draw()
})
onBeforeUnmount(() => engine?.dispose())
</script>

<template>
  <div style="min-height:100vh;background:#0a0a0a;color:#eee;padding:24px;display:flex;gap:24px;">
    <canvas ref="canvas" width="512" height="512" style="background:#000;border-radius:12px;" />
    <div style="display:flex;flex-direction:column;gap:8px;">
      <p v-if="!ok" style="color:#f66">WebGL unavailable</p>
      <button @click="setMode('primitive','cube')">Cube</button>
      <button @click="setMode('primitive','sphere')">Sphere</button>
      <button @click="setMode('gem')">Gem</button>
      <button @click="setFill('facets')">Fill: Facets</button>
      <button @click="setFill('surface')">Fill: Surface</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button @click="setColoring('smooth')">Smooth</button>
        <button @click="setColoring('faceted')">Faceted</button>
        <button @click="setColoring('scatter')">Scatter</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button @click="setDirection('vertical')">Vertical</button>
        <button @click="setDirection('depth')">Depth</button>
        <button @click="setDirection('radial')">Radial</button>
        <button @click="setDirection('angular')">Angular</button>
      </div>
      <button @click="roll">Re-roll</button>
      <pre style="font-size:11px;max-width:280px;white-space:pre-wrap;">{{ config }}</pre>
    </div>
  </div>
</template>
