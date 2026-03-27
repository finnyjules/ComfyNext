<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'

const props = defineProps<{
  running?: boolean
  gap?: number
  dotRadius?: number
  baseColor?: string
  glowColor?: string
}>()

const gap = computed(() => props.gap ?? 24)
const dotRadius = computed(() => props.dotRadius ?? 1.2)
const baseAlpha = 0.12
const glowAlpha = 0.6

const canvasRef = ref<HTMLCanvasElement | null>(null)
const { viewport } = useVueFlow()

let animFrame = 0
let sweepX = -0.3 // normalized 0-1 sweep position across viewport
let sweepDirection = 1

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight

  // Resize canvas for crisp rendering
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)

  const vp = viewport.value
  const scale = vp.zoom
  const offsetX = vp.x
  const offsetY = vp.y
  const g = gap.value * scale

  if (g < 4) { ctx.setTransform(1, 0, 0, 1, 0, 0); return } // too zoomed out, skip

  // Calculate dot grid bounds in screen space
  const startX = ((offsetX % g) + g) % g
  const startY = ((offsetY % g) + g) % g

  const r = Math.max(0.5, dotRadius.value * Math.min(scale, 1.5))

  // Update sweep position when running
  if (props.running) {
    sweepX += 0.012 * sweepDirection
    if (sweepX > 1.3) {
      sweepX = -0.3
    }
  } else {
    // Fade sweep offscreen when stopped
    sweepX = -0.5
  }

  const sweepScreenX = sweepX * w
  const sweepWidth = w * 0.25 // width of the glow band

  for (let x = startX; x < w; x += g) {
    for (let y = startY; y < h; y += g) {
      let alpha = baseAlpha

      if (props.running) {
        // Distance from sweep center, normalized to sweep width
        const dist = Math.abs(x - sweepScreenX) / sweepWidth
        if (dist < 1) {
          // Smooth falloff: cos curve for natural glow
          const intensity = 0.5 * (1 + Math.cos(dist * Math.PI))
          alpha = baseAlpha + (glowAlpha - baseAlpha) * intensity
        }
      }

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (alpha > baseAlpha) {
        // Glowing dot: indigo tint
        const t = (alpha - baseAlpha) / (glowAlpha - baseAlpha)
        const rr = Math.round(255 * (1 - t) + 129 * t)
        const gg = Math.round(255 * (1 - t) + 140 * t)
        const bb = Math.round(255 * (1 - t) + 248 * t)
        ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha})`
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      }
      ctx.fill()
    }
  }

  // Reset transform for next frame
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  animFrame = requestAnimationFrame(draw)
}

onMounted(() => {
  animFrame = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(animFrame)
})

// Redraw when viewport changes (pan/zoom)
watch(viewport, () => {
  // Animation loop handles redraw continuously when running;
  // when idle, trigger a single redraw
  if (!props.running) {
    cancelAnimationFrame(animFrame)
    animFrame = requestAnimationFrame(draw)
  }
}, { deep: true })

// Start/stop animation loop when running state changes
watch(() => props.running, (running) => {
  if (running) {
    sweepX = -0.3
    cancelAnimationFrame(animFrame)
    animFrame = requestAnimationFrame(draw)
  }
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="absolute inset-0 w-full h-full pointer-events-none"
    style="z-index: 0;"
  />
</template>
