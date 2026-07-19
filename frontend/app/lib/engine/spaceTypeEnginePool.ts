// frontend/app/lib/engine/spaceTypeEnginePool.ts
/** ONE SpaceTypeEngine — one WebGL context — for the entire timeline.
 *
 *  Browsers cap live WebGL contexts at roughly 8–16, and Space Type node cards
 *  already compete for them. An engine per clip would exhaust the budget on a
 *  modest edit, so every Space Type clip renders through this singleton,
 *  sequentially. That is safe because FrameSource.getFrame's contract says the
 *  returned image is valid only until the next getFrame call, and the compositor
 *  uploads to a texture before advancing.
 *
 *  OWNERSHIP CONTRACT — read this before writing a consumer (FrameSource, the
 *  Canvas2D fallback branch, the export baker):
 *
 *   1. Call `acquireSpaceTypeEngine()` exactly ONCE per consumer, when that
 *      consumer is constructed. It returns a `SpaceTypeEngineHandle`, or null
 *      only when WebGL2 is permanently unavailable in this browser — in that
 *      case there is nothing to release; the consumer just degrades.
 *   2. Call `releaseSpaceTypeEngine(handle)` exactly once, when that consumer
 *      is disposed. It is idempotent: releasing the same handle again (or a
 *      stale/unknown handle) is a safe no-op, so double-dispose call sites
 *      don't need extra bookkeeping.
 *   3. Call `getSpaceTypeEngine(handle, width, height)` once per rendered
 *      frame — as many times as you like. It NEVER touches the refcount; only
 *      acquire/release do. It never throws: it returns null when the engine
 *      is unavailable for that particular frame (construction still in its
 *      retry cooldown, resize failed, etc.), and the caller draws nothing.
 *
 *  `refs` (tracked as the size of the live-handle set) counts LIVE CONSUMERS,
 *  not render calls. The shared engine is constructed lazily on the first
 *  getSpaceTypeEngine() call from ANY handle, and is disposed the instant the
 *  last live handle releases — never before (another consumer may still be
 *  mid-render) and never after (nothing left to hold it open).
 *
 *   4. `resetSpaceTypeEnginePool()` (for context-loss recovery) invalidates
 *      EVERY outstanding handle. Handle ids are never reused, so a pre-reset
 *      handle is simply dead: `getSpaceTypeEngine` returns null for it forever
 *      and `releaseSpaceTypeEngine` is a no-op — safe, no leak, no double-free,
 *      but also never self-healing. A consumer that starts getting null after
 *      previously succeeding must release its old handle and acquire a fresh
 *      one; nothing will do that for it.
 *
 *  Do not go back to acquiring per render call. That was the shape of the bug
 *  this file was rewritten to fix: refs grew without bound as frames rendered
 *  (the engine, and its WebGL context, were never freed for the rest of the
 *  session), and releasing a consumer that had never rendered could still
 *  drive refs to 0 and dispose an engine other clips were actively using.
 */
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { getEffect } from '~/lib/spacetype/effects/index'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

let engine: SpaceTypeEngine | null = null
let canvas: HTMLCanvasElement | null = null

/** Live (unreleased) handles. Its size IS the refcount. */
let liveHandles = new Set<number>()
let nextHandleId = 1

/** Latched true only once we've confirmed this browser has no WebGL2 support at
 *  all (the capability probe failed). That is a permanent condition for the
 *  session — retrying construction can never succeed, so we stop trying. */
let capabilityUnavailable = false

/** Transient construction failures (e.g. "too many WebGL contexts" — an
 *  EXPECTED scenario given the ~8-16 browser cap this whole pool exists to
 *  work around) must NOT latch `capabilityUnavailable`: the failure is likely
 *  to clear once some other context is freed. Instead they open a bounded
 *  cooldown window so getSpaceTypeEngine() stops hammering `new
 *  SpaceTypeEngine()` on every single frame (60/sec) but does try again once
 *  the cooldown elapses. */
let nextConstructRetryAt = 0
const CONSTRUCT_RETRY_COOLDOWN_MS = 1000

export function spaceTypeEngineAvailable(): boolean {
  if (capabilityUnavailable) return false
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    return !!probe.getContext('webgl2')
  } catch {
    return false
  }
}

/** Opaque ownership token. Consumers only ever pass it back into
 *  getSpaceTypeEngine()/releaseSpaceTypeEngine(); they must not construct one
 *  themselves or rely on its shape. */
export interface SpaceTypeEngineHandle {
  readonly id: number
}

function ensureEngine(width: number, height: number): SpaceTypeEngine | null {
  if (capabilityUnavailable) return null
  if (!engine) {
    if (Date.now() < nextConstructRetryAt) return null
    if (!spaceTypeEngineAvailable()) { capabilityUnavailable = true; return null }
    try {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      engine = new SpaceTypeEngine(c, {
        effect: getEffect('ribbon'),
        width, height, fps: 30, loopDuration: 6,
        alpha: true, bgColor: '#000000',
      })
      canvas = c
    } catch (e) {
      console.warn('spaceTypeEnginePool: engine construction failed — will retry later (expected under WebGL context pressure)', e)
      engine = null
      canvas = null
      nextConstructRetryAt = Date.now() + CONSTRUCT_RETRY_COOLDOWN_MS
      return null
    }
  }
  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    try {
      engine.setSize(width, height)
    } catch (e) {
      console.warn('spaceTypeEnginePool: resize failed', e)
      return null
    }
  }
  return engine
}

/** Acquire ownership of the shared engine. Call once per consumer, at
 *  construction time; pair with exactly one releaseSpaceTypeEngine(handle).
 *  Returns null only when WebGL2 is already known permanently unavailable —
 *  there is nothing to release in that case. Never throws. */
export function acquireSpaceTypeEngine(): SpaceTypeEngineHandle | null {
  if (capabilityUnavailable) return null
  const id = nextHandleId++
  liveHandles.add(id)
  return { id }
}

/** Get the shared engine, resized to width×height, for rendering one frame.
 *  Does NOT touch the refcount — call this as many times as you like per
 *  handle. Never throws: returns null when the engine is unavailable this
 *  frame (no WebGL2, construction still cooling down after a transient
 *  failure, or resize threw), or when `handle` is not currently live. */
export function getSpaceTypeEngine(handle: SpaceTypeEngineHandle, width: number, height: number): SpaceTypeEngine | null {
  if (!liveHandles.has(handle.id)) return null
  return ensureEngine(width, height)
}

/** Release a consumer's ownership. Idempotent: releasing the same handle
 *  twice, or an unknown/stale handle, is a safe no-op. Disposes the shared
 *  engine only when this was the last live handle. */
export function releaseSpaceTypeEngine(handle: SpaceTypeEngineHandle | null | undefined): void {
  if (!handle) return
  if (!liveHandles.delete(handle.id)) return // already released, or never a live handle
  if (liveHandles.size === 0 && engine) {
    engine.dispose()
    engine = null
    canvas = null
  }
}

/** Reset after a context loss so the next acquire re-initializes from
 *  scratch. Also clears the transient-failure cooldown and the permanent
 *  latch — a caller invoking this is explicitly asking to try again. */
export function resetSpaceTypeEnginePool(): void {
  if (engine) { try { engine.dispose() } catch { /* already lost */ } }
  engine = null
  canvas = null
  liveHandles = new Set()
  capabilityUnavailable = false
  nextConstructRetryAt = 0
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
