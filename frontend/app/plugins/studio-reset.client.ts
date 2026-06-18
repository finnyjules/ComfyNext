// Global `v-studio-reset` directive: double-clicking a range input resets it to a
// neutral value and notifies its v-model. The neutral is `data-default` when present,
// else 0 for bidirectional sliders (min<0<max), else the minimum. Used by the studio
// sliders (StudioSlider + the surfaces' native .studio-range inputs).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('studio-reset', {
    mounted(el: HTMLInputElement) {
      el.addEventListener('dblclick', () => {
        const min = Number(el.min)
        const max = Number(el.max)
        const d = el.dataset.default
        const neutral = d != null && d !== '' ? Number(d) : (min < 0 && max > 0 ? 0 : min)
        if (!Number.isFinite(neutral)) return
        el.value = String(neutral)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    },
  })
})
