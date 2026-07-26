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
        <span class="hint">(0 = vsync baseline, no shader work)</span>
      </div>
      <label class="group"><input v-model="distinct" type="checkbox"> distinct descriptors (vary u_seed per field)</label>
      <span class="status">{{ status }}</span>
    </div>

    <div class="stats">
      <div class="stat"><span class="k">effect</span><span class="v">{{ effectId || '—' }}</span></div>
      <div class="stat"><span class="k">frame (wall, 120f avg)</span><span class="v">{{ stats.wallMs.toFixed(2) }} ms</span></div>
      <div class="stat"><span class="k">cpu submit (120f avg)</span><span class="v">{{ stats.cpuMs.toFixed(2) }} ms</span></div>
      <div class="stat"><span class="k">blit (120f avg)</span><span class="v">{{ stats.blitMs.toFixed(2) }} ms</span></div>
      <div class="stat"><span class="k">fps (wall)</span><span class="v" :class="{ bad: stats.fps > 0 && stats.fps < 30 }">{{ stats.fps.toFixed(1) }}</span></div>
    </div>

    <p class="verdict">{{ verdictText }}</p>

    <p class="pass-note">
      Pass condition (Task 0 spec): 2 distinct 512² fields sustain ≥30fps with total wall frame
      time under 33ms. Load starts at fields=0 to capture the vsync baseline automatically; then
      switch to fields=2 with "distinct descriptors" checked and read the wall fps / verdict above.
      Wait ~1s after any control change — the first 60 frames are discarded while shaders
      compile and FBOs allocate.
    </p>

    <canvas ref="canvasEl" :width="CANVAS_W" :height="CANVAS_H" class="stage" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const FIELD_OPTIONS = [0, 1, 2, 4, 8] as const
const MAX_FIELDS = 8
const FRAME_WINDOW = 120
// Frames to discard after any control change (fields/distinct) before averaging —
// shader compile + FBO allocation on the first frames otherwise swamp the signal
// (a switch to N=1 could read as costlier than N=2 purely from warm-up jitter).
const WARMUP_FRAMES = 60
const CANVAS_W = 960
const CANVAS_H = 480

// Bench starts at fields=0 on load specifically so the vsync-ceiling baseline for
// THIS display gets captured automatically before any shader work runs — without
// it, "60fps at 8 fields" is ambiguous between "plenty of headroom" and "exactly
// saturated" (see verdictText below).
const fieldsCount = ref<number>(0)
const distinct = ref(false)
const status = ref('loading catalog…')
const effectId = ref('')
const stats = ref({ cpuMs: 0, blitMs: 0, wallMs: 0, fps: 0 })
/** Wall fps at fields=0, captured once (the first time the rolling window fills at
 *  fields=0 post-warmup). Never recaptured — later 0-field visits don't overwrite it. */
const baselineFps = ref<number | null>(null)

const verdictText = computed(() => {
  if (baselineFps.value == null) return 'measuring fields=0 baseline…'
  const fps = stats.value.fps
  if (fps <= 0) return 'measuring…'
  const ratio = fps / baselineFps.value
  return ratio >= 0.9
    ? `vsync-capped (headroom) — ${fps.toFixed(1)} fps vs ${baselineFps.value.toFixed(1)} fps baseline`
    : `GPU-bound: ${fps.toFixed(1)} fps — baseline ${baselineFps.value.toFixed(1)} fps`
})

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

// CPU-submit timing (command-submission cost — how long shaderFx.render/drawImage
// take to RETURN, not how long the GPU takes to finish). Useful for telling "we're
// submitting too much work" apart from "the GPU can't keep up", but both render()
// and drawImage() are async on the GPU side, so this must NOT drive fps.
const frameTimes: number[] = []
const blitTimes: number[] = []
// Wall-clock rAF-to-rAF deltas — the only honest frame-cost signal, since the
// browser can't start the next frame until the current one's GPU work is done.
const wallTimes: number[] = []
let lastNow: number | null = null
let warmupRemaining = WARMUP_FRAMES

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

/** Discard the rolling windows and restart the warm-up count — called on load and
 *  after any fields/distinct change, so shader-compile/FBO-alloc jitter from the
 *  first frames never pollutes the averages. */
function resetWarmup(): void {
  warmupRemaining = WARMUP_FRAMES
  frameTimes.length = 0
  blitTimes.length = 0
  wallTimes.length = 0
}

watch([fieldsCount, distinct], () => resetWarmup())

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

  // Wall-clock rAF-to-rAF delta — the ONLY honest frame-cost signal. Both
  // shaderFx.render() and drawImage() submit GPU work asynchronously, so timing
  // around them (below) measures command submission, not frame cost. The browser
  // can't schedule the next rAF until the current frame's GPU work is actually
  // done, so if GPU work exceeds budget, this delta is what stretches.
  if (lastNow != null) {
    const wallDelta = now - lastNow
    if (warmupRemaining <= 0) pushRolling(wallTimes, wallDelta)
  }
  lastNow = now

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

  // CPU submit time only — how long it took shaderFx.render/drawImage to RETURN,
  // not how long the GPU took to finish. Still useful for isolating "we're
  // submitting too much work" from "the GPU can't keep up", but must not drive fps.
  const cpuMs = performance.now() - t0

  if (warmupRemaining > 0) {
    warmupRemaining--
  } else {
    pushRolling(frameTimes, cpuMs)
    pushRolling(blitTimes, blitAccum)
  }

  const wallAvg = avg(wallTimes)
  const wallFps = wallAvg > 0 ? 1000 / wallAvg : 0
  stats.value = {
    cpuMs: avg(frameTimes),
    blitMs: avg(blitTimes),
    wallMs: wallAvg,
    fps: wallFps,
  }

  // Capture the fields=0 vsync-ceiling baseline exactly once — the first time the
  // wall-clock window fills post-warmup while fields=0. Never recaptured after
  // that, even if the user revisits fields=0 later.
  if (baselineFps.value == null && fieldsCount.value === 0 && warmupRemaining <= 0 && wallTimes.length >= FRAME_WINDOW) {
    baselineFps.value = wallFps
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
.hint { color: #666; font-size: 11px }
button { background: #222; color: #ddd; border: 1px solid #444; padding: 4px 10px; cursor: pointer; font: inherit }
button.active { background: #2a5; color: #000; border-color: #2a5; font-weight: 700 }
.status { color: #fa0 }
.stats { display: flex; gap: 18px; margin-bottom: 8px; flex-wrap: wrap }
.stat { display: flex; flex-direction: column; background: #161616; border: 1px solid #333; padding: 6px 12px; min-width: 110px }
.stat .k { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: .04em }
.stat .v { color: #fff; font-size: 16px; font-weight: 700 }
.stat .v.bad { color: #f66 }
.verdict { color: #fd0; font-weight: 700; margin: 0 0 10px }
.pass-note { color: #9c9; max-width: 80ch; line-height: 1.5; margin: 0 0 14px }
.stage { display: block; background: #000; border: 1px solid #333 }
code { color: #9cf }
</style>
