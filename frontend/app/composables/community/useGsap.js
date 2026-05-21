import { onMounted, onUnmounted } from 'vue'
import { gsap, ScrollTrigger } from '~/lib/community/gsap.js'

export function useGsap() {
  let ctx = null

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  onMounted(() => {
    ctx = gsap.context(() => {})
  })

  onUnmounted(() => {
    ctx?.revert()
  })

  function animate(callback) {
    if (prefersReducedMotion) return
    if (ctx) {
      ctx.add(callback)
    }
  }

  return { gsap, ScrollTrigger, animate, prefersReducedMotion }
}
