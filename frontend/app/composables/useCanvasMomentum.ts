/**
 * useCanvasMomentum — smooth momentum-based panning for the VueFlow canvas.
 *
 * Intercepts pointer events on the canvas viewport and applies physics-based
 * deceleration after a fling gesture. Uses GSAP for the inertia tweening.
 *
 * Usage:
 *   const { enable, disable } = useCanvasMomentum(vueFlowInstance)
 *
 * The composable automatically attaches/detaches on mount/unmount. Call
 * `disable()` to temporarily suspend (e.g. while a modal is open).
 *
 * Architecture note: We don't fight VueFlow's built-in pan handler. Instead,
 * we track pointer velocity during native panning, and when the pointer lifts,
 * we apply a GSAP tween that continues the motion with deceleration.
 */

import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { gsap } from 'gsap'

interface Velocity {
  vx: number
  vy: number
}

interface CanvasMomentumOptions {
  /** Friction coefficient — higher = faster stop. Default 3. */
  friction?: number
  /** Minimum velocity (px/s) to trigger momentum. Default 50. */
  minVelocity?: number
  /** Maximum duration of the momentum coast (seconds). Default 1.5. */
  maxDuration?: number
}

export function useCanvasMomentum(
  /** VueFlow's viewport ref or a container element to observe. */
  containerRef: Ref<HTMLElement | null>,
  /** Function to get the current viewport transform. */
  getViewport: () => { x: number; y: number; zoom: number },
  /** Function to set the viewport transform (pans the canvas). */
  setViewport: (vp: { x: number; y: number; zoom: number }) => void,
  options: CanvasMomentumOptions = {},
) {
  const {
    friction = 3,
    minVelocity = 50,
    maxDuration = 1.5,
  } = options

  const enabled = ref(true)
  let lastPointerX = 0
  let lastPointerY = 0
  let lastPointerTime = 0
  let velocityX = 0
  let velocityY = 0
  let isTracking = false
  let momentumTween: gsap.core.Tween | null = null

  // Velocity is computed as a decayed running average of recent deltas
  const DECAY = 0.7

  function onPointerDown(e: PointerEvent) {
    if (!enabled.value) return
    // Only track middle-button (pan) or when space is held (VueFlow default)
    // Actually, VueFlow handles pan on left-drag by default, so we track all
    if (e.button !== 0 && e.button !== 1) return

    // Kill any running momentum
    if (momentumTween) {
      momentumTween.kill()
      momentumTween = null
    }

    isTracking = true
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    lastPointerTime = performance.now()
    velocityX = 0
    velocityY = 0
  }

  function onPointerMove(e: PointerEvent) {
    if (!isTracking) return
    const now = performance.now()
    const dt = (now - lastPointerTime) / 1000  // seconds
    if (dt > 0) {
      const vx = (e.clientX - lastPointerX) / dt
      const vy = (e.clientY - lastPointerY) / dt
      velocityX = velocityX * DECAY + vx * (1 - DECAY)
      velocityY = velocityY * DECAY + vy * (1 - DECAY)
    }
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    lastPointerTime = now
  }

  function onPointerUp(_e: PointerEvent) {
    if (!isTracking) return
    isTracking = false

    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY)
    if (speed < minVelocity) return

    // Compute coast distance based on velocity and friction
    // distance = velocity / friction (exponential deceleration)
    const duration = Math.min(maxDuration, speed / (friction * 500))

    const viewport = getViewport()
    const target = {
      x: viewport.x + (velocityX * duration) / friction,
      y: viewport.y + (velocityY * duration) / friction,
    }

    const proxy = { x: viewport.x, y: viewport.y }
    momentumTween = gsap.to(proxy, {
      x: target.x,
      y: target.y,
      duration,
      ease: 'power2.out',
      onUpdate() {
        setViewport({ x: proxy.x, y: proxy.y, zoom: getViewport().zoom })
      },
      onComplete() {
        momentumTween = null
      },
    })
  }

  function attach() {
    const el = containerRef.value
    if (!el) return
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerup', onPointerUp, { passive: true })
    el.addEventListener('pointercancel', onPointerUp, { passive: true })
  }

  function detach() {
    const el = containerRef.value
    if (!el) return
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
  }

  function enable() { enabled.value = true }
  function disable() {
    enabled.value = false
    if (momentumTween) {
      momentumTween.kill()
      momentumTween = null
    }
  }

  onMounted(() => {
    attach()
  })

  onUnmounted(() => {
    detach()
    if (momentumTween) momentumTween.kill()
  })

  watch(containerRef, (newEl, oldEl) => {
    if (oldEl) detach()
    if (newEl) attach()
  })

  return { enable, disable, enabled }
}
