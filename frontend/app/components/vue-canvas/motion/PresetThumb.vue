<script setup lang="ts">
/** Live preset preview: loops the REAL evaluate() math on a sample card in a
 *  tiny canvas — previews are true to the engine, not canned GIFs. 2s cycle:
 *  in-presets play then hold; out-presets hold then play; loops run 1.5s cycles. */
import { evaluateAnimation, type PresetCapability } from '~/lib/motion/evaluate'
import { registerThumb } from '~/lib/motion/thumbClock'

const props = defineProps<{
  presetId: string
  slotKind: 'in' | 'out' | 'loop'
  params?: Record<string, number>
  /** What the CONSUMER this thumb stands for can render. The tile must promise
   *  only what the real surface will do, so blur is drawn only when the
   *  consumer supports it. Omitted = conservative (no blur), which is right for
   *  the Compositor: its painters ignore UnitState.blur. */
  capabilities?: PresetCapability[]
}>()

const W = 72, H = 54
const canvasEl = ref<HTMLCanvasElement | null>(null)
let unregister: (() => void) | null = null
let ctx2d: CanvasRenderingContext2D | null = null

const anim = computed(() => {
  const spec = { presetId: props.presetId, duration: 0.9, stagger: 0, params: props.params }
  if (props.slotKind === 'in') return { offset: 0.2, in: spec }
  if (props.slotKind === 'out') return { offset: 0, duration: 1.6, out: spec }
  return { offset: 0, loop: { ...spec, duration: 1.5 } }
})

function draw(clockSec: number) {
  if (!ctx2d) return
  const c = ctx2d
  const cycle = props.slotKind === 'loop' ? 1.5 : 2
  const t = clockSec % cycle
  const st = evaluateAnimation(anim.value, t, { fps: 30, duration: 2 }, 1)
  c.clearRect(0, 0, W, H)
  c.fillStyle = 'rgba(255,255,255,0.05)'
  c.fillRect(0, 0, W, H)
  if (!st.visible) return
  const un = st.units?.[0] ?? { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
  const box = 20                                    // sample card px (the unit box)
  const cx = W / 2 + un.dx * box, cy = H / 2 + un.dy * box
  // UnitState.blur is in unit-box heights (like dx/dy) → multiply by the box.
  const blurPx = props.capabilities?.includes('blur') ? (un.blur ?? 0) * box : 0
  const drawCard = (dx: number, dy: number, s: number, alpha: number, rot = 0) => {
    c.save()
    // Set before the transform so the radius stays in canvas px at any scale.
    if (blurPx > 0.01) c.filter = `blur(${blurPx.toFixed(2)}px)`
    c.globalAlpha = Math.max(0, Math.min(1, alpha))
    c.translate(cx + dx * box, cy + dy * box)
    c.rotate(((un.rotation + rot) * Math.PI) / 180)
    c.scale(
      Math.max(0.001, un.scale * (un.scaleX ?? 1) * s),
      Math.max(0.001, un.scale * (un.scaleY ?? 1) * s),
    )
    if (un.clip && un.clip.amount > 0.001) {
      const a = un.clip.amount
      c.beginPath()
      if (un.clip.side === 'top') c.rect(-box, -box + 2 * box * a, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'bottom') c.rect(-box, -box, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'left') c.rect(-box + 2 * box * a, -box, 2 * box * (1 - a), 2 * box)
      else c.rect(-box, -box, 2 * box * (1 - a), 2 * box)
      c.clip()
    }
    c.fillStyle = 'rgba(255,255,255,0.9)'
    const r = 3, w = box, h = box * 0.75
    c.beginPath()
    c.roundRect(-w / 2, -h / 2, w, h, r)
    c.fill()
    c.fillStyle = 'rgba(0,0,0,0.75)'
    c.font = '600 9px Inter, system-ui, sans-serif'
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText('Aa', 0, 0.5)
    c.restore()
  }
  for (const c of [...(un.copies ?? [])])
    drawCard(c.dx, c.dy, c.scale, un.opacity * c.opacity, c.rotation ?? 0)
  drawCard(0, 0, 1, un.opacity)
}

onMounted(() => {
  if (canvasEl.value) {
    ctx2d = canvasEl.value.getContext('2d')
    unregister = registerThumb(canvasEl.value, draw)
  }
})
onBeforeUnmount(() => unregister?.())
</script>

<template>
  <canvas ref="canvasEl" :width="W" :height="H" class="w-full h-auto rounded bg-white/[0.02]" />
</template>
