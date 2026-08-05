import { resetValue } from '~/lib/studio/row'

// Global `v-studio-reset` directive: double-clicking a range input resets it to a
// neutral value and notifies its v-model. The neutral is `data-default` when present,
// else 0 for bidirectional sliders (min<0<max), else the minimum. Used by the studio
// sliders (StudioSlider + the surfaces' native .studio-range inputs).
//
// The heuristic itself lives in `~/lib/studio/row`'s `resetValue` — this directive
// only converts the DOM's string `data-default` into the number that function wants,
// so an empty or non-numeric attribute falls through to the heuristic instead of
// becoming NaN (resetValue takes `undefined` as "no default", not `''`).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('studio-reset', {
    mounted(el: HTMLInputElement) {
      el.addEventListener('dblclick', () => {
        const min = Number(el.min)
        const max = Number(el.max)
        const d = el.dataset.default
        const parsed = d != null && d !== '' ? Number(d) : undefined
        const neutral = resetValue({ default: parsed, min, max })
        if (!Number.isFinite(neutral)) return
        el.value = String(neutral)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    },
  })
})
