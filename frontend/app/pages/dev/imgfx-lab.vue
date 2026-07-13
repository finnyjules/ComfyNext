<script setup lang="ts">
// Dev harness for the img-fx "image generation" effect (useImgFx). Not shipped
// (pages/dev/** is stripped from production). Drives the churn / boil / reveal
// lifecycle in isolation so the effect can be verified without a full ComfyUI
// generation. Visit /dev/imgfx-lab.
import { useImgFx, type ImgFxController } from '~/composables/useImgFx'
import type { PresetName } from 'img-fx'

definePageMeta({ layout: false })

const frameRef = ref<HTMLElement | null>(null)
const shaderRef = ref<HTMLCanvasElement | null>(null)
const revealRef = ref<HTMLCanvasElement | null>(null)
const preset = ref<PresetName>('pixels-organic')
const status = ref('idle')

let fx: ImgFxController | null = null
let testUrl = ''

function makeTestImage(): string {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 512
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 512, 512)
  grd.addColorStop(0, '#ff6b6b'); grd.addColorStop(0.5, '#4ecdc4'); grd.addColorStop(1, '#ffe66d')
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(0,0,0,0.85)'; g.font = 'bold 96px sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('IMG', 256, 256)
  return c.toDataURL()
}

function boot() {
  if (!shaderRef.value || !revealRef.value || !frameRef.value) {
    status.value = 'no refs'
    return
  }
  fx?.dispose()
  fx = useImgFx()
  fx.mount(shaderRef.value, revealRef.value, frameRef.value, { preset: preset.value, theme: 'dark' })
  fx.churn()
  cardBg.value = fx.cardBg()
  status.value = fx.isMounted() ? 'churning' : 'mount failed (no WebGL?)'
  console.log('[imgfx-lab] boot; mounted =', fx.isMounted(), 'cardBg =', cardBg.value)
}

const cardBg = ref('#0f0f0f')

// Distinct second test image (blue) so a reveal after a boil is obvious.
function makeTestImage2(): string {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 512
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 512, 512)
  grd.addColorStop(0, '#4d7cff'); grd.addColorStop(0.5, '#a04dff'); grd.addColorStop(1, '#4dffe0')
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = 'bold 96px sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NEW', 256, 256)
  return c.toDataURL()
}
let testUrl2 = ''

const currentImg = ref('')

function restart() { fxActive.value = true; boot() }

onMounted(() => {
  testUrl = makeTestImage()
  testUrl2 = makeTestImage2()
  currentImg.value = testUrl
  boot()
  // Expose for real-browser (claude-in-chrome) driving + pixel sampling.
  ;(window as any).__lab = {
    fx: () => fx,
    shader: () => shaderRef.value,
    reveal: () => revealRef.value,
    frame: () => frameRef.value,
    a: testUrl, b: testUrl2,
    setFxActive: (v: boolean) => { fxActive.value = v },
    fxActive: () => fxActive.value,
  }
})
onUnmounted(() => fx?.dispose())

// The fx wrapper opacity, mirroring the node.
const fxActive = ref(true)

async function doReveal() {
  status.value = 'revealing…'
  await fx?.revealResult(testUrl)
  status.value = 'revealed (held)'
}
function doBoil() {
  status.value = 'boiling…'
  fx?.boilFrom(testUrl, () => {})
  status.value = 'boiled → churn'
}
function changePreset(p: PresetName) { preset.value = p; boot() }

// Mirror the node's re-roll EXACTLY: hide fx, reset, churn, boil the current
// image (fxActive turns on when held), then a new result arrives → reveal it.
async function rerollSim() {
  status.value = 're-roll: boiling old…'
  fxActive.value = false
  if (fx?.isMounted()) fx.reset()
  fx?.churn()
  fx?.boilFrom(testUrl, () => { fxActive.value = true })
  window.setTimeout(() => { fxActive.value = true }, 300)
  await new Promise((r) => window.setTimeout(r, 2600))
  status.value = 're-roll: revealing new…'
  await fx?.revealResult(testUrl2)
  status.value = 're-roll: done (new held)'
}
</script>

<template>
  <div style="min-height:100vh;background:#0b0b0b;color:#eee;font-family:Inter,system-ui,sans-serif;padding:32px">
    <h1 style="font-size:16px;margin:0 0 4px">img-fx lab — {{ preset }} · <span style="opacity:.6">{{ status }}</span></h1>
    <p style="opacity:.5;margin:0 0 20px;font-size:13px">Churn is live on mount. “Reveal” dissolves the test image out of it; “Boil” dissolves it back in.</p>

    <div style="display:flex;gap:24px;align-items:flex-start">
      <!-- The node frame analogue. Frame bg is deliberately BRIGHT so we can
           confirm the dither reads full-opaque via the shader canvas's own
           cardBg backdrop (nothing bright should bleed through the churn). -->
      <div ref="frameRef" style="position:relative;width:320px;height:320px;border-radius:14px;overflow:hidden;background:#0f0f0f;border:1px solid #ffffff18">
        <!-- Current image (the node's <img>) — under the fx. -->
        <img :src="currentImg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />
        <!-- fx wrapper: opacity mirrors the node's fxActive; canvases have NO opacity binding. -->
        <div :style="{ position:'absolute', inset:0, opacity: fxActive ? 1 : 0, transition:'opacity 260ms ease' }">
          <canvas ref="shaderRef" :style="{ position:'absolute', inset:0, width:'100%', height:'100%', background: cardBg }" />
          <canvas ref="revealRef" style="position:absolute;inset:0;width:100%;height:100%" />
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;width:200px">
        <button style="height:38px;border-radius:8px;background:#4d7cff;color:#fff;font-weight:700;cursor:pointer;border:0" @click="rerollSim">▶ Simulate re-roll</button>
        <button style="height:34px;border-radius:8px;background:#fff;color:#111;font-weight:600;cursor:pointer;border:0" @click="doReveal">Reveal new →</button>
        <button style="height:34px;border-radius:8px;background:#ffffff14;color:#eee;cursor:pointer;border:1px solid #ffffff22" @click="doBoil">Boil existing ←</button>
        <button style="height:34px;border-radius:8px;background:#ffffff0a;color:#bbb;cursor:pointer;border:1px solid #ffffff18" @click="restart">Restart churn</button>
        <div style="height:1px;background:#ffffff18;margin:6px 0" />
        <button v-for="p in (['pixels-organic','pixels-mechanic','sweep-gradient'] as PresetName[])" :key="p"
          style="height:30px;border-radius:8px;cursor:pointer;border:1px solid #ffffff18;font-size:12px"
          :style="p === preset ? 'background:#ffffff22;color:#fff' : 'background:transparent;color:#aaa'"
          @click="changePreset(p)">{{ p }}</button>
      </div>
    </div>
  </div>
</template>
