<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'

const props = defineProps<{
  running?: boolean
  /** Agent is planning — animate sparks travelling dot-to-dot. */
  thinking?: boolean
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
let rainbowOffset = 0 // horizontal scroll offset for rainbow

// ── "Thinking" sparks: comet segments that wander dot-to-dot along the grid,
//    trailing a flowing rainbow-pastel tail. The trail is kept in world-grid
//    coords so it stays glued to the dots when the canvas pans/zooms. ──
interface Spark { gx: number; gy: number; dx: number; dy: number; p: number; speed: number; hueBase: number; trail: { wx: number; wy: number }[] }
let sparks: Spark[] = []
let sparkHue = 0 // global flowing offset so the rainbow drifts over time
const TRAIL_LEN = 34 // points of history → a long comet spanning a few dots
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
function spawnSpark(gxMin: number, gxMax: number, gyMin: number, gyMax: number): Spark {
  const d = DIRS[Math.floor(Math.random() * 4)]!
  return {
    gx: gxMin + Math.floor(Math.random() * (gxMax - gxMin + 1)),
    gy: gyMin + Math.floor(Math.random() * (gyMax - gyMin + 1)),
    dx: d[0], dy: d[1], p: Math.random(), speed: 0.02 + Math.random() * 0.03,
    hueBase: Math.random() * 360, trail: [],
  }
}

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
    sweepX += 0.007
    if (sweepX > 1.3) {
      sweepX = -0.3
    }
    rainbowOffset += 0.003 // slow horizontal scroll for rainbow
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
        // Rainbow tint based on horizontal position + scrolling offset
        const t = (alpha - baseAlpha) / (glowAlpha - baseAlpha)
        const hue = ((x / w) + rainbowOffset) * 360 % 360
        ctx.fillStyle = `hsla(${hue}, 80%, 75%, ${alpha * t + baseAlpha * (1 - t)})`
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      }
      ctx.fill()
    }
  }

  // Thinking sparks — little segments firing dot-to-dot like synapses.
  if (props.thinking) {
    const gxMin = Math.floor((0 - offsetX) / g) - 1
    const gxMax = Math.ceil((w - offsetX) / g) + 1
    const gyMin = Math.floor((0 - offsetY) / g) - 1
    const gyMax = Math.ceil((h - offsetY) / g) + 1
    if (!sparks.length) {
      const n = Math.min(22, Math.max(10, Math.round((gxMax - gxMin) / 4)))
      sparks = Array.from({ length: n }, () => spawnSpark(gxMin, gxMax, gyMin, gyMax))
    }
    sparkHue = (sparkHue + 0.7) % 360
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of sparks) {
      s.p += s.speed
      if (s.p >= 1) {
        // Keep going straight in the same direction (no swerving). Step to the
        // next dot; respawn only once we've travelled off-screen.
        s.gx += s.dx; s.gy += s.dy; s.p = 0
        if (s.gx < gxMin - 3 || s.gx > gxMax + 3 || s.gy < gyMin - 3 || s.gy > gyMax + 3) {
          Object.assign(s, spawnSpark(gxMin, gxMax, gyMin, gyMax)) // teleport → fresh (empty) trail
        }
      }
      // Record the head (world-grid coords; continuous across dots).
      s.trail.push({ wx: s.gx + s.dx * s.p, wy: s.gy + s.dy * s.p })
      if (s.trail.length > TRAIL_LEN) s.trail.shift()

      // Draw the comet: per-segment rainbow-pastel, fading + thinning toward the tail.
      for (let i = 1; i < s.trail.length; i++) {
        const a = s.trail[i - 1]!, b = s.trail[i]!
        const t = i / s.trail.length // 0 tail → 1 head
        const hue = (sparkHue + s.hueBase + i * 7) % 360
        ctx.strokeStyle = `hsla(${hue}, 75%, 82%, ${(0.1 + 0.8 * t).toFixed(3)})`
        ctx.lineWidth = 0.8 + 2.2 * t
        ctx.beginPath()
        ctx.moveTo(offsetX + a.wx * g, offsetY + a.wy * g)
        ctx.lineTo(offsetX + b.wx * g, offsetY + b.wy * g)
        ctx.stroke()
      }
      // Bright head.
      const head = s.trail[s.trail.length - 1]!
      const headHue = (sparkHue + s.hueBase + s.trail.length * 7) % 360
      ctx.beginPath()
      ctx.arc(offsetX + head.wx * g, offsetY + head.wy * g, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${headHue}, 80%, 90%, 0.95)`
      ctx.fill()
    }
  } else if (sparks.length) {
    sparks = []
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
