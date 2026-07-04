import { scrubValue } from '~/lib/studio/scrub'

interface ScrubBinding {
  get: () => number
  set: (v: number) => void
  min: number
  max: number
  step?: number
  scrubPx?: number
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('scrub', {
    mounted(el: HTMLElement, node) {
      const state = { b: node.value as ScrubBinding }
      ;(el as any).__scrub = state
      el.style.cursor = 'ew-resize'
      el.addEventListener('pointerdown', (e: PointerEvent) => {
        const b = state.b
        if (!b) return
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        const startX = e.clientX
        const startValue = Number(b.get())
        const move = (ev: PointerEvent) => {
          b.set(scrubValue({
            startValue, deltaPx: ev.clientX - startX,
            min: b.min, max: b.max, step: b.step ?? 1,
            scrubPx: b.scrubPx, fine: ev.shiftKey,
          }))
        }
        const up = () => {
          el.releasePointerCapture(e.pointerId)
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      })
    },
    updated(el: HTMLElement, node) {
      const s = (el as any).__scrub
      if (s) s.b = node.value as ScrubBinding
    },
  })
})
