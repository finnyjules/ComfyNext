// frontend/app/lib/engine/spaceTypeEnginePool.ts
/** ONE SpaceTypeEngine — one WebGL context — for the entire timeline.
 *
 *  Browsers cap live WebGL contexts at roughly 8–16, and Space Type node cards
 *  already compete for them. An engine per clip would exhaust the budget on a
 *  modest edit, so every Space Type clip renders through this singleton,
 *  sequentially. That is safe because FrameSource.getFrame's contract says the
 *  returned image is valid only until the next getFrame call, and the compositor
 *  uploads to a texture before advancing. */
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { getEffect } from '~/lib/spacetype/effects/index'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

let engine: SpaceTypeEngine | null = null
let canvas: HTMLCanvasElement | null = null
let refs = 0
let webglFailed = false

export function spaceTypeEngineAvailable(): boolean {
  if (webglFailed) return false
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    return !!probe.getContext('webgl2')
  } catch {
    return false
  }
}

/** Get the shared engine, sized to the timeline canvas. Returns null when WebGL2
 *  is unavailable — callers must degrade, never throw. */
export function acquireSpaceTypeEngine(W: number, H: number): SpaceTypeEngine | null {
  if (webglFailed) return null
  if (!engine) {
    if (!spaceTypeEngineAvailable()) { webglFailed = true; return null }
    try {
      canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      engine = new SpaceTypeEngine(canvas, {
        effect: getEffect('ribbon'),
        width: W, height: H, fps: 30, loopDuration: 6,
        alpha: true, bgColor: '#000000',
      })
    } catch (e) {
      console.warn('spaceTypeEnginePool: engine init failed — Space Type clips will not render', e)
      webglFailed = true
      engine = null
      return null
    }
  }
  refs += 1
  if (canvas && (canvas.width !== W || canvas.height !== H)) engine.setSize(W, H)
  return engine
}

export function releaseSpaceTypeEngine(): void {
  refs = Math.max(0, refs - 1)
  if (refs === 0 && engine) {
    engine.dispose()
    engine = null
    canvas = null
  }
}

/** Reset after a context loss so the next acquire re-initializes. */
export function resetSpaceTypeEnginePool(): void {
  if (engine) { try { engine.dispose() } catch { /* already lost */ } }
  engine = null
  canvas = null
  refs = 0
  webglFailed = false
}

/** Cache key for a built scene root: effect id plus every param the effect does
 *  NOT declare live, plus the text-texture inputs. Params in liveKeys are
 *  excluded so tweaking them reuses the root instead of rebuilding. */
export function structuralKey(state: SpaceTypeState): string {
  const effect = getEffect(state.effectId)
  const live = new Set(effect.liveKeys ?? [])
  const structural: Record<string, unknown> = {}
  for (const k of Object.keys(state.params).sort()) {
    if (!live.has(k)) structural[k] = state.params[k]
  }
  return JSON.stringify({
    e: effect.id,
    p: structural,
    g: state.gradientStops,
    d: state.dimsKey,
  })
}
