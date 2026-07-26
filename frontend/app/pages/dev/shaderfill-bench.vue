<template>
  <div class="bench">
    <h1>Shader fill readback bench (Task 0)</h1>
    <p class="note">
      Reproduces the real cross-context handoff a shader fill needs: shaderFx renders each
      field into its own WebGL2 context, gets blitted with <code>drawImage</code> into a 2D
      canvas, then re-uploaded as a <code>THREE.CanvasTexture</code> on a quad in a SEPARATE
      three.js renderer. Answers "how many live 512² fields can we afford per frame?"
    </p>

    <div class="controls">
      <div class="group">
        <span class="label">fields/frame</span>
        <button
          v-for="n in FIELD_OPTIONS" :key="n"
          :class="{ active: fieldsCount === n }"
          @click="fieldsCount = n"
        >{{ n }}</button>
      </div>
      <label class="group"><input v-model="distinct" type="checkbox"> distinct descriptors (vary u_seed per field)</label>
      <span class="status">{{ status }}</span>
    </div>

    <div class="stats">
      <div class="stat"><span class="k">effect</span><span class="v">{{ effectId || '—' }}</span></div>
      <div class="stat"><span class="k">frame (120f avg)</span><span class="v">{{ stats.frameMs.toFixed(2) }} ms</span></div>
      <div class="stat"><span class="k">blit (120f avg)</span><span class="v">{{ stats.blitMs.toFixed(2) }} ms</span></div>
      <div class="stat"><span class="k">fps</span><span class="v" :class="{ bad: stats.fps > 0 && stats.fps < 30 }">{{ stats.fps.toFixed(1) }}</span></div>
    </div>

    <p class="pass-note">
      Pass condition (Task 0 spec): 2 distinct 512² fields sustain ≥30fps with total frame time
      under 33ms. Read the numbers above at fields=2 with "distinct descriptors" checked.
    </p>

    <canvas ref="canvasEl" :width="CANVAS_W" :height="CANVAS_H" class="stage" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { expandPasses, shaderFx } from '~/lib/shaderfx/renderer'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { DEFAULT_FILL, fillTileBox } from '~/lib/spacetype/fillTile'
import type { EffectDef } from '~/lib/shaderfx/types'

definePageMeta({ layout: false })

// Preferred generative-ish effect for the bench (needs no uploaded image — its
// input is the synthetic gradient fill built below). Falls back to the first
// catalog effect flagged `generative` if this id isn't present.
const PREFERRED_EFFECT_ID = 'fbm_warp'

const FIELD_SIZE = 512
const FIELD_OPTIONS = [1, 2, 4, 8] as const
const MAX_FIELDS = 8
const FRAME_WINDOW = 120
const CANVAS_W = 960
const CANVAS_H = 480

const fieldsCount = ref<number>(1)
const distinct = ref(false)
const status = ref('loading catalog…')
const effectId = ref('')
const stats = ref({ frameMs: 0, blitMs: 0, fps: 0 })

const canvasEl = ref<HTMLCanvasElement | null>(null)

let effectDef: EffectDef | null = null
let baseFill: HTMLCanvasElement | null = null

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let raf = 0
let startedAt = 0

interface FieldState {
  canvas2d: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  mesh: THREE.Mesh
}
const fieldStates: FieldState[] = []

const frameTimes: number[] = []
const blitTimes: number[] = []

function pushRolling(arr: number[], v: number): void {
  arr.push(v)
  if (arr.length > FRAME_WINDOW) arr.shift()
}

function avg(arr: number[]): number {
  if (!arr.length) return 0
  let sum = 0
  for (const v of arr) sum += v
  return sum / arr.length
}

/** Arrange up to 8 quads in a 4-wide grid, hide the rest. */
function layoutFields(): void {
  const n = fieldsCount.value
  const cols = Math.min(4, n)
  const rows = Math.ceil(n / 4)
  const spacing = 1.3
  for (let i = 0; i < MAX_FIELDS; i++) {
    const st = fieldStates[i]
    if (!st) continue
    const visible = i < n
    st.mesh.visible = visible
    if (!visible) continue
    const col = i % 4
    const row = Math.floor(i / 4)
    st.mesh.position.set((col - (cols - 1) / 2) * spacing, -(row - (rows - 1) / 2) * spacing, 0)
  }
}

watch(fieldsCount, () => layoutFields())

function buildFieldStates(): void {
  for (let i = 0; i < MAX_FIELDS; i++) {
    const c = document.createElement('canvas')
    c.width = FIELD_SIZE
    c.height = FIELD_SIZE
    const ctx = c.getContext('2d')
    if (!ctx) continue
    const texture = new THREE.CanvasTexture(c)
    const mat = new THREE.MeshBasicMaterial({ map: texture })
    const geo = new THREE.PlaneGeometry(1, 1)
    const mesh = new THREE.Mesh(geo, mat)
    scene!.add(mesh)
    fieldStates.push({ canvas2d: c, ctx2d: ctx, texture, mesh })
  }
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  if (!effectDef || !baseFill || !renderer || !scene || !camera) return

  const t0 = performance.now()
  const timeSec = (now - startedAt) / 1000
  const n = fieldsCount.value
  let blitAccum = 0

  for (let i = 0; i < n; i++) {
    // Same uniforms for every field (identical), or a per-field u_seed offset
    // (distinct) — this is the knob that will later prove/disprove batching.
    const seed = distinct.value ? 42 + i * 7 : 42
    const uniforms = {
      ...resolveUniforms(effectDef, {}),
      u_time: timeSec,
      u_seed: seed,
      u_hasInput: 1,
    }
    const passes = expandPasses(effectDef.id, effectDef.source, uniforms, {}, effectDef.passes ?? 1)
    const rendered = shaderFx.render(passes, baseFill, FIELD_SIZE, FIELD_SIZE)

    const st = fieldStates[i]
    if (!st) continue
    const tb0 = performance.now()
    st.ctx2d.drawImage(rendered, 0, 0)
    blitAccum += performance.now() - tb0
    st.texture.needsUpdate = true
    st.mesh.rotation.y += 0.012
  }

  renderer.render(scene, camera)

  const frameMs = performance.now() - t0
  pushRolling(frameTimes, frameMs)
  pushRolling(blitTimes, blitAccum)
  const frameAvg = avg(frameTimes)
  stats.value = {
    frameMs: frameAvg,
    blitMs: avg(blitTimes),
    fps: frameAvg > 0 ? 1000 / frameAvg : 0,
  }
}

onMounted(async () => {
  try {
    const catalog = await fetchShaderFxCatalog()
    const preferred = catalog.effects.find(e => e.id === PREFERRED_EFFECT_ID)
    const fallback = catalog.effects.find(e => e.generative)
    effectDef = preferred ?? fallback ?? catalog.effects[0] ?? null
    if (!effectDef) {
      status.value = 'no effects in catalog — cannot run bench'
      return
    }
    effectId.value = effectDef.id
    status.value = ''
  } catch (e) {
    status.value = `catalog fetch failed: ${e}`
    console.error('[shaderfill-bench]', e)
    return
  }

  // Synthetic input: a gradient fill tile, same convention as the future shader-fill
  // pipeline (fillTileBox → shaderFx.render base). Static — only u_time animates.
  baseFill = fillTileBox({ ...DEFAULT_FILL, type: 'gradient' }, FIELD_SIZE, FIELD_SIZE)

  if (!canvasEl.value) return
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true })
  renderer.setSize(CANVAS_W, CANVAS_H, false)
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111111)
  camera = new THREE.OrthographicCamera(-3, 3, 1.5, -1.5, 0.1, 100)
  camera.position.z = 5
  camera.lookAt(0, 0, 0)

  buildFieldStates()
  layoutFields()

  startedAt = performance.now()
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  for (const st of fieldStates) {
    st.texture.dispose()
    ;(st.mesh.material as THREE.Material).dispose()
    st.mesh.geometry.dispose()
  }
  renderer?.dispose()
  renderer = null
})
</script>

<style scoped>
.bench { padding: 16px; font: 13px ui-monospace, monospace; color: #ddd; background: #111; min-height: 100vh }
h1 { font-size: 15px; margin: 0 0 4px }
.note { color: #888; margin: 0 0 12px; max-width: 80ch; line-height: 1.5 }
.controls { display: flex; gap: 20px; align-items: center; margin-bottom: 12px; flex-wrap: wrap }
.group { display: flex; gap: 6px; align-items: center }
.label { color: #999 }
button { background: #222; color: #ddd; border: 1px solid #444; padding: 4px 10px; cursor: pointer; font: inherit }
button.active { background: #2a5; color: #000; border-color: #2a5; font-weight: 700 }
.status { color: #fa0 }
.stats { display: flex; gap: 18px; margin-bottom: 8px; flex-wrap: wrap }
.stat { display: flex; flex-direction: column; background: #161616; border: 1px solid #333; padding: 6px 12px; min-width: 110px }
.stat .k { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: .04em }
.stat .v { color: #fff; font-size: 16px; font-weight: 700 }
.stat .v.bad { color: #f66 }
.pass-note { color: #9c9; max-width: 80ch; line-height: 1.5; margin: 0 0 14px }
.stage { display: block; background: #000; border: 1px solid #333 }
code { color: #9cf }
</style>
