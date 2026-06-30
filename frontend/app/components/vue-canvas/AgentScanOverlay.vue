<script setup lang="ts">
// White dot-grid "scanning" overlay shown OVER a node while the agent reviews its
// result — a soft white shimmer band swipes across a faint dot grid (under a light
// dark scrim so the dots read over a bright image) so it's clear THIS node is the
// one under review. Self-contained 2D canvas; the rAF loop runs only while active
// and eases out before stopping. Mount inside a position:relative node container.
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ active: boolean }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let amt = 0       // eased 0→1 fade (in while active, out after)
let sweep = -0.3  // normalized shimmer-band position across the node
const GAP = 16, DOT_R = 1.1, BAND = 0.3

function draw() {
  const cv = canvasRef.value
  if (!cv) { raf = 0; return }
  const ctx = cv.getContext('2d')
  if (!ctx) { raf = 0; return }
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth, h = cv.clientHeight
  if (w < 1 || h < 1) { raf = requestAnimationFrame(draw); return }
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  amt += ((props.active ? 1 : 0) - amt) * 0.08
  if (props.active) { sweep += 0.012; if (sweep > 1.3) sweep = -0.3 }

  if (amt > 0.01) {
    // Light scrim so the white dots stay legible over a bright result image.
    ctx.fillStyle = `rgba(10, 12, 16, ${0.3 * amt})`
    ctx.fillRect(0, 0, w, h)
    const sx = sweep * w, band = w * BAND
    for (let x = GAP / 2; x < w; x += GAP) {
      // Shimmer is a vertical band → alpha depends on x only; compute once per column.
      const d = Math.abs(x - sx) / band
      const shimmer = d < 1 ? 0.5 * (1 + Math.cos(d * Math.PI)) * 0.85 * amt : 0
      const a = Math.min(0.95, 0.13 * amt + shimmer)
      for (let y = GAP / 2; y < h; y += GAP) {
        ctx.beginPath(); ctx.arc(x, y, DOT_R, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${a})`; ctx.fill()
      }
    }
  }

  if (props.active || amt > 0.01) raf = requestAnimationFrame(draw)
  else raf = 0
}

// flush:'post' so v-if/v-show has sized the canvas before the first measure.
watch(() => props.active, (on) => {
  if (on) sweep = -0.3
  if (!raf) raf = requestAnimationFrame(draw)
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf); raf = 0 })
</script>

<template>
  <canvas ref="canvasRef" class="pointer-events-none absolute inset-0 z-20 h-full w-full" style="border-radius: inherit" />
</template>
