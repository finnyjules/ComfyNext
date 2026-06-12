/**
 * Reactive zoom/pan state for the inpaint stage. Holds scale/tx/ty and exposes
 * a CSS transform string + helpers, all delegating to the pure `stageView`
 * math. The content stays logical-sized; only the wrapper is transformed.
 */
import { computed, ref } from 'vue'
import {
  type View, identityView, clampScale, zoomAt, panBy, screenToNorm, normToScreen,
} from '~/lib/stageView'

export function useStageView() {
  const scale = ref(1)
  const tx = ref(0)
  const ty = ref(0)
  const view = (): View => ({ scale: scale.value, tx: tx.value, ty: ty.value })
  function set(v: View) { scale.value = clampScale(v.scale); tx.value = v.tx; ty.value = v.ty }

  const transform = computed(() => `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`)
  const percent = computed(() => Math.round(scale.value * 100))

  function reset() { set(identityView()) }
  function zoomBy(factor: number, anchorX: number, anchorY: number) { set(zoomAt(view(), factor, anchorX, anchorY)) }
  function pan(dx: number, dy: number) { set(panBy(view(), dx, dy)) }
  function toNorm(sx: number, sy: number, rectW: number, rectH: number) { return screenToNorm(sx, sy, rectW, rectH, view()) }
  function toScreen(nx: number, ny: number, rectW: number, rectH: number) { return normToScreen(nx, ny, rectW, rectH, view()) }

  return { scale, tx, ty, transform, percent, reset, zoomBy, pan, toNorm, toScreen }
}
