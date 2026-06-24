// glimm — WebGL "sweep" page transitions, wired into Nuxt.
//
// glimm ships React/Next adapters (`glimm/react`, `glimm/next`) that don't run in
// Vue, so this is a faithful port of its `GlimmProvider` + `InterceptLinks` built on
// the framework-agnostic core (`glimm`):
//   • GlimmProvider  -> a fixed full-screen <canvas> overlay (z 9999, pointer-events:none)
//                       driven by createShader(), with a sweep(navigate, opts) helper.
//   • InterceptLinks -> a vue-router global guard. It catches EVERY navigation
//                       (NuxtLink, programmatic, back/forward) and defers the actual
//                       page swap to the band's midpoint, so the new page appears under
//                       the band exactly like glimm/next — without fighting NuxtLink.
//
// Reduced-motion is respected (no sweep, instant nav) and WebGL failure degrades
// gracefully (createShader returns null -> nav proceeds untouched).
import { createShader, playSweep, resolvePalette, type ShaderController, type SweepHandle } from 'glimm'

const PALETTE = 'citrus' as const
const Z_INDEX = 9999

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()

  // --- GlimmProvider: fixed full-screen overlay host, canvas created lazily ---------
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: String(Z_INDEX),
  })
  document.body.appendChild(host)

  let ctrl: ShaderController | null = null
  let ctrlTried = false
  let active: SweepHandle | null = null

  const ensureController = (): ShaderController | null => {
    if (ctrl || ctrlTried) return ctrl
    ctrlTried = true
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    })
    host.appendChild(canvas)
    // createShader sizes itself to the canvas via devicePixelRatio internally.
    ctrl = createShader({ canvas, palette: resolvePalette(PALETTE) })
    return ctrl
  }

  // sweep(navigate, opts): mirror of GlimmProvider.sweep — reduced-motion guard,
  // cancel any in-flight sweep, run `navigate` at the band midpoint.
  const sweep = (navigate: () => void | Promise<void>): SweepHandle => {
    if (prefersReducedMotion()) {
      const p = Promise.resolve(navigate()).then(() => {})
      return { midpoint: p, done: p, cancel: () => {} }
    }
    const c = ensureController()
    if (!c) {
      const p = Promise.resolve(navigate()).then(() => {})
      return { midpoint: p, done: p, cancel: () => {} }
    }
    active?.cancel()
    const handle = playSweep(c, {
      palette: PALETTE,
      onMidpoint: () => navigate(),
    })
    active = handle
    handle.done.finally(() => {
      if (active === handle) active = null
    })
    return handle
  }

  // --- InterceptLinks: router-level. Defer the real nav to the sweep midpoint -------
  // `releasing` lets the deferred navigation through on its second pass.
  let releasing = false
  router.beforeEach((to, from) => {
    if (releasing) {
      releasing = false
      return true
    }
    if (!from.matched.length) return true // initial page load — no sweep
    if (to.fullPath === from.fullPath) return true
    if (prefersReducedMotion()) return true

    sweep(() => {
      releasing = true
      router.push(to.fullPath)
    })
    return false // hold this navigation; the sweep re-issues it at midpoint
  })

  // Expose for manual sweeps / debugging: const { $glimm } = useNuxtApp()
  return {
    provide: {
      glimm: { sweep, controller: () => ensureController() },
    },
  }
})
