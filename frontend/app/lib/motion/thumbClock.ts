/** One RAF loop drives every visible preset thumbnail (the gallery can show
 *  ~30 at once — per-thumb RAFs would thrash). Thumbs unsubscribe on unmount;
 *  an IntersectionObserver pauses the ones scrolled out of view. */

type DrawFn = (clockSec: number) => void
const subs = new Map<HTMLCanvasElement, { draw: DrawFn; visible: boolean }>()
let rafId: number | null = null
let epoch = 0

const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = subs.get(e.target as HTMLCanvasElement)
        if (s) s.visible = e.isIntersecting
      }
    })
  : null

function tick(nowMs: number) {
  if (!epoch) epoch = nowMs
  const clockSec = (nowMs - epoch) / 1000
  for (const { draw, visible } of subs.values()) if (visible) draw(clockSec)
  rafId = subs.size ? requestAnimationFrame(tick) : null
}

export function registerThumb(canvas: HTMLCanvasElement, draw: DrawFn): () => void {
  subs.set(canvas, { draw, visible: true })
  io?.observe(canvas)
  if (rafId == null) rafId = requestAnimationFrame(tick)
  return () => {
    subs.delete(canvas)
    io?.unobserve(canvas)
    if (!subs.size && rafId != null) { cancelAnimationFrame(rafId); rafId = null }
  }
}
