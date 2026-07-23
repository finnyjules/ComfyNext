<script setup lang="ts">
/** Live preset preview: loops the REAL evaluate() math on a sample card in a
 *  tiny canvas — previews are true to the engine, not canned GIFs. 2s cycle:
 *  in-presets play then hold; out-presets hold then play; loops run 1.5s cycles. */
import { evaluateAnimation } from '~/lib/motion/evaluate'
import type { LayerAnimation } from '~/lib/motion/types'
import { registerThumb } from '~/lib/motion/thumbClock'

const props = defineProps<{
  presetId: string
  slotKind: 'in' | 'out' | 'loop'
  params?: Record<string, number>
}>()

const W = 72, H = 54
const canvasEl = ref<HTMLCanvasElement | null>(null)
let unregister: (() => void) | null = null

function animFor(): LayerAnimation {
  const spec = { presetId: props.presetId, duration: 0.9, stagger: 0, params: props.params }
  if (props.slotKind === 'in') return { offset: 0.2, in: spec }
  if (props.slotKind === 'out') return { offset: 0, duration: 1.6, out: spec }
  return { offset: 0, loop: { ...spec, duration: 1.5 } }
}

function draw(clockSec: number) {
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  const t = clockSec % 2
  const st = evaluateAnimation(animFor(), t, { fps: 30, duration: 2 }, 1)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, 0, W, H)
  if (!st.visible) return
  const un = st.units?.[0] ?? { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
  const box = 20                                    // sample card px (the unit box)
  const cx = W / 2 + un.dx * box, cy = H / 2 + un.dy * box
  const drawCard = (dx: number, dy: number, s: number, alpha: number, rot = 0) => {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    ctx.translate(cx + dx * box, cy + dy * box)
    ctx.rotate(((un.rotation + rot) * Math.PI) / 180)
    ctx.scale(
      Math.max(0.001, un.scale * (un.scaleX ?? 1) * s),
      Math.max(0.001, un.scale * (un.scaleY ?? 1) * s),
    )
    if (un.clip && un.clip.amount > 0.001) {
      const a = un.clip.amount
      ctx.beginPath()
      if (un.clip.side === 'top') ctx.rect(-box, -box + 2 * box * a, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'bottom') ctx.rect(-box, -box, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'left') ctx.rect(-box + 2 * box * a, -box, 2 * box * (1 - a), 2 * box)
      else ctx.rect(-box, -box, 2 * box * (1 - a), 2 * box)
      ctx.clip()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    const r = 3, w = box, h = box * 0.75
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.font = '600 9px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Aa', 0, 0.5)
    ctx.restore()
  }
  for (const c of [...(un.copies ?? [])])
    drawCard(c.dx, c.dy, c.scale, un.opacity * c.opacity, c.rotation ?? 0)
  drawCard(0, 0, 1, un.opacity)
}

onMounted(() => { if (canvasEl.value) unregister = registerThumb(canvasEl.value, draw) })
onBeforeUnmount(() => unregister?.())
</script>

<template>
  <canvas ref="canvasEl" :width="W" :height="H" class="w-full h-auto rounded bg-white/[0.02]" />
</template>
