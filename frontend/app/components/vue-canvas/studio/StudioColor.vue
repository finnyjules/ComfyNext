<script setup lang="ts">
// Dark, in-theme color picker for the studios (replaces the OS <input type=color>).
// Swatch trigger + a Teleported popover (saturation/value pad, hue slider, hex field).
// Teleported to <body> + fixed-positioned so it escapes the section cards' overflow:hidden.
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Pipette } from 'lucide-vue-next'
import { clampHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToOklch, oklchToRgb } from './color'

const model = defineModel<string>({ required: true })

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})
const h = ref(0), s = ref(0), v = ref(0)
const MODES = ['hex', 'rgb', 'oklch'] as const
const mode = ref<typeof MODES[number]>('hex')

const inputCls = 'w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 text-center font-mono text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20'

const hueColor = computed(() => { const [r, g, b] = hsvToRgb(h.value, 1, 1); return rgbToHex(r, g, b) })
function pushModel() { const [r, g, b] = hsvToRgb(h.value, s.value, v.value); model.value = rgbToHex(r, g, b) }
function syncFromModel() { const [r, g, b] = hexToRgb(model.value); const [hh, ss, vv] = rgbToHsv(r, g, b); h.value = hh; s.value = ss; v.value = vv }

const hexField = computed({
  get: () => model.value,
  set: (val: string) => { model.value = clampHex(val); syncFromModel() },
})

// RGB channel proxies (0–255).
function rgbChannel(i: number) {
  return computed({
    get: () => hexToRgb(model.value)[i]!,
    set: (val: number) => {
      const c = hexToRgb(model.value)
      c[i] = Math.min(255, Math.max(0, Math.round(Number(val) || 0)))
      model.value = rgbToHex(c[0], c[1], c[2]); syncFromModel()
    },
  })
}
const rCh = rgbChannel(0), gCh = rgbChannel(1), bCh = rgbChannel(2)

// OKLCH channel proxies (L 0–1, C 0–~0.4, H 0–360).
const round = (n: number, d: number) => { const p = 10 ** d; return Math.round(n * p) / p }
function oklchChannel(i: number, decimals: number) {
  return computed({
    get: () => round(rgbToOklch(...hexToRgb(model.value))[i]!, decimals),
    set: (val: number) => {
      const o = rgbToOklch(...hexToRgb(model.value))
      o[i] = Math.max(0, Number(val) || 0)
      const [r, g, b] = oklchToRgb(o[0], o[1], o[2])
      model.value = rgbToHex(r, g, b); syncFromModel()
    },
  })
}
const lCh = oklchChannel(0, 3), cCh = oklchChannel(1, 3), hCh = oklchChannel(2, 1)

const hasEyeDropper = ref(false)
onMounted(() => { hasEyeDropper.value = typeof window !== 'undefined' && 'EyeDropper' in window })
async function pickEye() {
  try {
    const res = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open()
    if (res?.sRGBHex) { model.value = clampHex(res.sRGBHex); syncFromModel() }
  } catch { /* cancelled */ }
}

function reposition() {
  const el = trigger.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 220, est = 300
  const left = Math.min(r.left, window.innerWidth - W - 8)
  const below = r.bottom + 6
  const top = below + est > window.innerHeight ? Math.max(8, r.top - est - 6) : below
  popStyle.value = { left: `${Math.max(8, left)}px`, top: `${top}px`, width: `${W}px` }
}
function openPicker() {
  syncFromModel(); open.value = true
  nextTick(reposition)
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('keydown', onKey)
}
function close() {
  open.value = false
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('keydown', onKey)
}
function onOutside(e: PointerEvent) {
  const t = e.target as Node
  if (trigger.value?.contains(t)) return
  if ((e.target as HTMLElement).closest?.('[data-studio-color-pop]')) return
  close()
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); close() } }
onBeforeUnmount(close)

function dragSv(e: PointerEvent) {
  const pad = (e.currentTarget as HTMLElement)
  const move = (ev: PointerEvent) => {
    const r = pad.getBoundingClientRect()
    s.value = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
    v.value = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height))
    pushModel()
  }
  move(e)
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}
function dragHue(e: PointerEvent) {
  const bar = (e.currentTarget as HTMLElement)
  const move = (ev: PointerEvent) => {
    const r = bar.getBoundingClientRect()
    h.value = Math.min(360, Math.max(0, (ev.clientX - r.left) / r.width * 360))
    pushModel()
  }
  move(e)
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}
</script>

<template>
  <button ref="trigger" type="button" @click="open ? close() : openPicker()"
          class="h-7 w-7 shrink-0 rounded-md border border-white/15"
          :style="{ background: model }" :aria-label="`Color ${model}`"></button>

  <Teleport to="body">
    <div v-if="open" data-studio-color-pop :style="popStyle"
         class="fixed z-[60] rounded-lg border border-white/10 bg-neutral-900 p-2.5 shadow-xl">
      <div class="relative mb-2 h-32 w-full cursor-crosshair rounded-md"
           :style="{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}` }"
           @pointerdown="dragSv">
        <span class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              :style="{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }"></span>
      </div>
      <div class="relative mb-2.5 h-3 w-full cursor-pointer rounded-full"
           style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
           @pointerdown="dragHue">
        <span class="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              :style="{ left: `${h / 360 * 100}%`, background: hueColor }"></span>
      </div>
      <div class="mb-2 flex items-center gap-1.5">
        <button v-if="hasEyeDropper" type="button" @click="pickEye" aria-label="Pick color from screen"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/70 hover:text-white">
          <Pipette class="h-3.5 w-3.5" />
        </button>
        <span class="h-7 w-7 shrink-0 rounded-md border border-white/10" :style="{ background: model }"></span>
        <div class="flex flex-1 rounded-md bg-white/[0.05] p-0.5">
          <button v-for="mo in MODES" :key="mo" type="button" @click="mode = mo"
                  class="flex-1 rounded px-1 py-1 text-[10px] uppercase transition-colors"
                  :class="mode === mo ? 'bg-white text-neutral-900' : 'text-white/55 hover:text-white/80'">{{ mo }}</button>
        </div>
      </div>
      <input v-if="mode === 'hex'" v-model="hexField" spellcheck="false" :class="inputCls" />
      <div v-else-if="mode === 'rgb'" class="grid grid-cols-3 gap-1.5">
        <div><input v-model.number="rCh" type="number" min="0" max="255" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">R</div></div>
        <div><input v-model.number="gCh" type="number" min="0" max="255" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">G</div></div>
        <div><input v-model.number="bCh" type="number" min="0" max="255" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">B</div></div>
      </div>
      <div v-else class="grid grid-cols-3 gap-1.5">
        <div><input v-model.number="lCh" type="number" min="0" max="1" step="0.001" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">L</div></div>
        <div><input v-model.number="cCh" type="number" min="0" max="0.5" step="0.001" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">C</div></div>
        <div><input v-model.number="hCh" type="number" min="0" max="360" step="0.1" :class="inputCls" /><div class="mt-0.5 text-center text-[10px] text-white/35">H</div></div>
      </div>
    </div>
  </Teleport>
</template>
