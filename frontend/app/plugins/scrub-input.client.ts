import { scrubInputValue, SCRUB_THRESHOLD_PX } from '~/lib/studio/scrub'

/**
 * `v-scrubnum` — drag-to-scrub for a plain `<input type="number">`.
 *
 * Distinct from the older `v-scrub` directive (plugins/scrub.client.ts, used by
 * GridPropertyPanel): that one is a drag HANDLE — it `preventDefault`s the press and
 * captures immediately, which would make a text field impossible to click-and-type. This
 * one leaves the click alone and only takes over once the pointer has crossed
 * `SCRUB_THRESHOLD_PX`, so a plain click still focuses the field for typing.
 *
 * It reuses the input's OWN `min`/`max`/`step` attributes and writes back by setting
 * `el.value` and dispatching a native `input` event, so every field's existing
 * `@input` handler (px→normalized, percent→fraction, setDimPx, …) runs unchanged — the
 * directive never needs to know what a given field means. A `change` fires on release for
 * any commit-style handler.
 *
 * Tradeoff, chosen deliberately (see spec §B7): scrubbing lives ON the field, so an
 * in-field drag scrubs the value instead of selecting the field's text — the
 * Blender/Photoshop numeric-field convention. Click places the caret; double-click still
 * selects-all for typing.
 */

interface ScrubNumBinding {
  /** Pixels of travel per step. Omit for Figma's 1:1. */
  pxPerStep?: number
  /** Steps Shift snaps to. Omit for ×10. */
  coarseMultiplier?: number
  /** Set false to turn scrubbing off for this field (still typeable). */
  enabled?: boolean
}

function num(v: string | null): number {
  if (v == null || v === '' || v === 'any') return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('scrubnum', {
    mounted(el: HTMLInputElement, node) {
      const state = { b: (node.value ?? {}) as ScrubNumBinding }
      ;(el as any).__scrubnum = state

      const onPointerDown = (e: PointerEvent) => {
        const b = state.b
        if (b?.enabled === false) return
        if (e.button !== 0) return
        if (el.disabled || el.readOnly) return

        const startX = e.clientX
        const min = num(el.getAttribute('min'))
        const max = num(el.getAttribute('max'))
        const step = num(el.getAttribute('step')) || 1
        let startValue = parseFloat(el.value)
        // Empty / placeholder fields ("auto", "to end") start from the floor, or 0.
        if (!Number.isFinite(startValue)) startValue = Number.isFinite(min) ? min : 0

        let scrubbing = false

        const apply = (ev: PointerEvent) => {
          const next = scrubInputValue({
            startValue, deltaPx: ev.clientX - startX,
            min, max, step,
            coarse: ev.shiftKey,
            pxPerStep: b?.pxPerStep,
            coarseMultiplier: b?.coarseMultiplier,
          })
          if (String(next) === el.value) return
          el.value = String(next)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }

        const move = (ev: PointerEvent) => {
          if (!scrubbing) {
            if (Math.abs(ev.clientX - startX) < SCRUB_THRESHOLD_PX) return
            // Cross the threshold: this is a scrub, not a click. Drop focus so the
            // browser's own drag-select never fights the value writes, and paint the
            // whole document ew-resize so the cursor does not flicker off the field.
            scrubbing = true
            el.blur()
            document.body.style.cursor = 'ew-resize'
            el.setPointerCapture?.(e.pointerId)
          }
          ev.preventDefault()
          apply(ev)
        }

        const suppressClick = (ce: MouseEvent) => {
          ce.preventDefault()
          ce.stopPropagation()
        }

        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
          if (scrubbing) {
            document.body.style.cursor = ''
            // Commit for any `@change`-style handler, then swallow the click this drag
            // would otherwise deliver (which would re-focus and place a caret).
            el.dispatchEvent(new Event('change', { bubbles: true }))
            el.addEventListener('click', suppressClick, { capture: true, once: true })
            // A drag can end without ever producing a click; clear the guard next tick so
            // it can never eat a genuine later click.
            setTimeout(() => el.removeEventListener('click', suppressClick, { capture: true } as any), 0)
          }
        }

        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }

      el.addEventListener('pointerdown', onPointerDown)
      el.style.cursor = 'ew-resize'
      ;(state as any).__off = () => el.removeEventListener('pointerdown', onPointerDown)
    },
    updated(el: HTMLInputElement, node) {
      const s = (el as any).__scrubnum
      if (s) s.b = (node.value ?? {}) as ScrubNumBinding
    },
    unmounted(el: HTMLInputElement) {
      const s = (el as any).__scrubnum
      s?.__off?.()
    },
  })
})
