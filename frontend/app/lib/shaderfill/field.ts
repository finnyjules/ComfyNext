/**
 * Turns a ShaderFill into pixels — the ONLY place in the product that does so.
 * Every surface (Space Type, Shape Studio, frames, Scene3D) goes through here, which
 * is what keeps bake and preview from drifting: same function, different resolution.
 *
 * Rendering is a readback bridge: the shared `shaderFx` WebGL2 singleton renders the
 * field, and we blit its canvas into a per-field 2D canvas. shaderFx's own canvas is
 * only valid until the next call, so the blit MUST happen before anything else renders.
 */
import { effectiveTileFill, fillTileBox, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { shaderFx, expandPasses, type Uniforms } from '~/lib/shaderfx/renderer'
import { getEffectSync } from '~/lib/shaderfx/catalog'
import type { EffectDef } from '~/lib/shaderfx/types'
import { fieldKey, quantizeTime, planFields, resolveEffectParams, LIVE_FIELD_CEILING } from './descriptor'

export interface FieldRequest {
  spec: ShaderSpec; w: number; h: number; t: number; fps: number
  /** Bake renders at the requested size; live playback is clamped to LIVE_FIELD_PX. */
  bake?: boolean
}

/** Cumulative counters for the cache, reset by `clearFieldCache`. `renders` is the
 *  number of times `shaderFx.render` actually ran — the number that proves (or
 *  disproves) batching, since a cache hit costs zero GPU work. */
export interface FieldStats { renders: number; hits: number; misses: number }

/**
 * Sized as a small multiple of LIVE_FIELD_CEILING rather than a bare number, so the
 * two stay related if the ceiling is ever retuned. This cache's durable beneficiaries
 * are FROZEN (`speed: 0`) fields and OVER-CEILING fields — the ones `resolveField`
 * pins to a stable `t=0` fallback key (see `planFields`/the `key` fallback below) —
 * because those are the only entries that survive more than one animation frame;
 * an animated, under-ceiling field gets a brand-new key every quantized time step and
 * misses the cache by construction. Up to LIVE_FIELD_CEILING live fields each insert
 * one such never-repeating entry per frame, competing for this cache's slots against
 * the durable ones, so sizing it as `LIVE_FIELD_CEILING × N` gives the durable
 * entries roughly N frames of live churn before an LRU eviction can reach them — not
 * a guarantee (see below), just headroom. `8` is not a measurement like
 * LIVE_FIELD_CEILING itself is; it is small enough that the memory bound below stays
 * modest and large enough to not evict everything on the very next frame.
 *
 * Memory: CACHE_MAX × 512² × 4 bytes (RGBA8, the live-clamp size — see LIVE_FIELD_PX)
 * ≈ 33 MB at the current 32, retained on this module-level singleton that every
 * studio surface will eventually share. That budget, not a round number, is the
 * actual ceiling on how large this should get without deliberately re-budgeting it.
 *
 * This is NOT a guarantee that a frozen/over-ceiling entry survives indefinitely:
 * the field-count=8 sweep in the Task 3 report shows this cache already imperfectly
 * defending even that narrower job — 4 live fields churning through a 32-slot LRU
 * evict the 4 frozen fallback entries roughly every 8 iterations, forcing periodic
 * re-renders of work that is architecturally supposed to be free. Raising the
 * multiplier would help that specific case but is a real memory/eviction trade-off,
 * not a bug fix — left as-is per review (this cache is reviewed and works; changing
 * its behaviour needs its own measurement, the way LIVE_FIELD_CEILING got one).
 */
const CACHE_MAX = LIVE_FIELD_CEILING * 8
/** Live fields are capped so an on-canvas node cannot ask for a 4K readback per frame.
 *  Bakes opt out via `bake: true` — same function, same time, different resolution,
 *  which is what keeps preview and bake from drifting. */
const LIVE_FIELD_PX = 512

function fieldSize(req: FieldRequest): { w: number; h: number } {
  if (req.bake) return { w: req.w, h: req.h }
  const k = Math.min(1, LIVE_FIELD_PX / Math.max(req.w, req.h, 1))
  return { w: Math.max(1, Math.round(req.w * k)), h: Math.max(1, Math.round(req.h * k)) }
}

const cache = new Map<string, HTMLCanvasElement>()
let liveKeys = new Set<string>()
let stats: FieldStats = { renders: 0, hits: 0, misses: 0 }

/**
 * Resolve the effect def and a params-NORMALIZED copy of `spec` together, so every
 * caller below keys and renders off the same resolved params (see descriptor.ts's
 * `resolveEffectParams` doc). Falls back to the raw, un-normalized spec when the
 * effect isn't in the catalog yet (e.g. the page's `fetchShaderFxCatalog()` call
 * hasn't resolved) — that only costs a little batching hit rate for one frame, it
 * never produces wrong pixels, because `resolveField` still refuses to render
 * without an effect def either way.
 */
function resolve(spec: ShaderSpec): { effect: EffectDef | null; spec: ShaderSpec } {
  const effect = getEffectSync(spec.effectId)
  if (!effect) return { effect: null, spec }
  return { effect, spec: { ...spec, params: resolveEffectParams(effect, spec.params) } }
}

/** Call once per host frame with every field the frame wants. Decides which stay live
 *  and which freeze, so the ceiling is applied per surface per frame. */
export function beginFieldFrame(requests: FieldRequest[]): { frozenCount: number } {
  const keys = requests.map((r) => {
    const { w, h } = fieldSize(r)
    const { spec } = resolve(r.spec)
    return fieldKey(spec, w, h, quantizeTime(r.t, r.fps))
  })
  const { live, frozen } = planFields(keys)
  liveKeys = new Set(live)
  return { frozenCount: frozen.length }
}

export function resolveField(req: FieldRequest): HTMLCanvasElement | null {
  const { w, h } = fieldSize(req)
  const { effect, spec } = resolve(req.spec)
  const tq = quantizeTime(req.t, req.fps)
  const liveKey = fieldKey(spec, w, h, tq)
  // Not live this frame -> fall back to the frozen (t=0) variant of the same descriptor.
  const key = liveKeys.size === 0 || liveKeys.has(liveKey) ? liveKey : fieldKey(spec, w, h, 0)
  const hit = cache.get(key)
  if (hit) { stats.hits++; return hit }
  stats.misses++

  if (!effect) return null                        // caller falls back to the input fill

  // The shader's input image is the nested fill, rasterised on the CPU. Depth-1
  // nesting is enforced only at the normalizeFill/parseFills boundary, not in the
  // type system — a hand-constructed spec can still carry a shader fill as its
  // input, so unwrap defensively via effectiveTileFill rather than reading
  // spec.input directly (see fillTile.ts).
  const base = fillTileBox(effectiveTileFill(spec.input), w, h)
  const t = spec.speed === 0 ? 0 : tq * spec.speed
  // spec.params is already the full resolved set (defaults + valid overrides, unknown
  // keys dropped) from `resolve()` above — just reapply the `u_` uniform prefix.
  const uniforms: Uniforms = { u_time: t, u_seed: 42, u_hasInput: 1 }
  for (const [k, v] of Object.entries(spec.params)) uniforms[`u_${k}`] = v

  let rendered: HTMLCanvasElement
  try {
    // render() RETURNS the canvas, valid only until the next render call.
    stats.renders++
    rendered = shaderFx.render(expandPasses(effect.id, effect.source, uniforms, undefined, effect.passes ?? 1), base, w, h)
  } catch {
    return null                                    // context loss -> input fill
  }
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  out.getContext('2d')!.drawImage(rendered, 0, 0)    // must precede the next shaderFx call

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value          // Map preserves insertion order
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, out)
  return out
}

export function clearFieldCache(): void {
  cache.clear()
  liveKeys = new Set()
  stats = { renders: 0, hits: 0, misses: 0 }
}

/** Cumulative render/hit/miss counts since the last `clearFieldCache()` — proves (in
 *  the bench's `__benchBatch()` hook, and in production debugging) that identical
 *  descriptors collapse to one render regardless of how many consumers ask for them. */
export function fieldStats(): FieldStats { return { ...stats } }
