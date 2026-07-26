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
import { getEffectSync, fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import type { EffectDef } from '~/lib/shaderfx/types'
import { fieldKey, quantizeTime, planFields, resolveEffectParams, inputKey, LIVE_FIELD_CEILING } from './descriptor'

export interface FieldRequest {
  spec: ShaderSpec; w: number; h: number; t: number; fps: number
  /** Bake renders at the requested size; live playback is clamped to LIVE_FIELD_PX. */
  bake?: boolean
}

/** Cumulative counters for the cache, reset by `clearFieldCache`. `renders` is the
 *  number of times `shaderFx.render` actually ran — the number that proves (or
 *  disproves) batching, since a cache hit costs zero GPU work. `tileHits`/`tileMisses`
 *  are the SEPARATE input-tile cache (see `tileCache` below) — an animated field's
 *  OWN key changes every frame (so `hits`/`misses` above are dominated by misses for
 *  live fields by construction), but its `spec.input` is almost always unchanged
 *  frame to frame, so `tileHits` should be high even when `hits` is near zero. A low
 *  `tileHits` rate on an animated field is the signal that the input-tile cache isn't
 *  doing its job (e.g. a caller mutating `spec.input` needlessly every frame). */
export interface FieldStats { renders: number; hits: number; misses: number; tileHits: number; tileMisses: number }

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
 * the field-count=8 sweep in the Task 3 report showed this cache imperfectly
 * defending even that narrower job — 4 live fields churning through the 32 slots
 * evicted the 4 frozen fallback entries roughly every 8 iterations, forcing periodic
 * re-renders of work that is architecturally supposed to be free. That measurement
 * predates the recency refresh in `resolveField`: eviction was FIFO-by-insertion at
 * the time, so a frozen entry aged out on a fixed schedule no matter how often it was
 * read. It is now a true LRU, which should protect entries that are hit every frame —
 * re-measure before citing that 224-vs-200 figure again. Raising the
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
let stats: FieldStats = { renders: 0, hits: 0, misses: 0, tileHits: 0, tileMisses: 0 }

/**
 * Cache of the RASTERISED INPUT TILE (`fillTileBox(effectiveTileFill(spec.input), w,
 * h)`), keyed on the input fill + size — deliberately NOT on time, effect, params, or
 * anchor, unlike `cache` above. `spec.input` is time-invariant: an animated field's
 * `t` changes every frame but its input fill almost never does, yet without this it
 * was being fully re-rasterised on the CPU every single frame regardless. Built once
 * per distinct (input, size) pair and reused for the entire animation, across every
 * consumer sharing that input — the same batching principle `cache`/`fieldKey` apply
 * to the full render, just applied one layer down to the part that's actually
 * constant. 100% hit rate in practice (see the Task 3 report's sweep numbers) — cheap
 * and correct, kept even after the output-canvas pool (which measured zero benefit
 * and was removed, see `resolveField`'s doc) was taken back out.
 *
 * Sized the same as `cache` for the same reason (a small multiple of
 * LIVE_FIELD_CEILING, same memory-order-of-magnitude justification) — see CACHE_MAX
 * above for the full reasoning, which applies here unchanged.
 */
const tileCache = new Map<string, HTMLCanvasElement>()
const TILE_CACHE_MAX = CACHE_MAX

/** `inputKey(input)` always returns a well-formed JSON array string ending in `]`
 *  (see descriptor.ts) — no valid JSON array output can have trailing characters, so
 *  appending a fixed `#WxH` suffix after it can never collide with a differently
 *  shaped input producing the same composite string, without needing `encode()`'s
 *  full array-position disambiguation here too. */
function tileKey(input: ShaderSpec['input'], w: number, h: number): string {
  return `${inputKey(input)}#${w}x${h}`
}

function getInputTile(input: ShaderSpec['input'], w: number, h: number): HTMLCanvasElement {
  const key = tileKey(input, w, h)
  const hit = tileCache.get(key)
  if (hit) { stats.tileHits++; return hit }
  stats.tileMisses++
  // The shader's input image is the nested fill, rasterised on the CPU. Depth-1
  // nesting is enforced only at the normalizeFill/parseFills boundary, not in the
  // type system — a hand-constructed spec can still carry a shader fill as its
  // input, so unwrap defensively via effectiveTileFill rather than reading `input`
  // directly (see fillTile.ts). NOTE: `tileKey` above already keys on the SAME
  // unwrap via `inputKey`, so key and cached content agree by construction.
  const tile = fillTileBox(effectiveTileFill(input), w, h)
  if (tileCache.size >= TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value
    if (oldest) tileCache.delete(oldest)
  }
  tileCache.set(key, tile)
  return tile
}

/**
 * Self-heal for CRITICAL 1 of the final review: `getEffectSync` only ever returns
 * non-null once SOMETHING on the page has awaited `fetchShaderFxCatalog()` — and
 * the complete set of callers that do that is 4 studio Surface modals + the dev
 * bench (see catalog.ts). No node card and no Compositor render path calls it, so
 * a saved shader fill rendered by any OTHER host (a Frame card on reload, a
 * one-shot Shape/Scene3D bake, …) fell back to its input fill FOREVER — nothing
 * ever kicked the fetch, let alone retried it.
 *
 * Fix: every `resolve()` miss kicks `fetchShaderFxCatalog()` itself. Callers that
 * already re-invoke `resolveField` every frame (Space Type's rAF preview, any live
 * loop) self-heal for free the very next frame once the catalog lands — "no
 * ordering dependency anywhere", per the review. Callers that render once and stop
 * (ArtifactFrameNode's static renderStack, a one-shot bake) need an explicit nudge;
 * `onFieldCatalogReady` below is that nudge, for the hosts that have no loop of
 * their own to self-heal in.
 *
 * Deduped to a SINGLE in-flight promise (`_catalogRetry`): `resolve()` runs on
 * every `resolveField`/`beginFieldFrame` call, which for a live field is every
 * host frame, so calling `fetchShaderFxCatalog()` unconditionally would attach a
 * new `.then` per frame and fire every subscriber once per attached `.then` when
 * it finally resolves (fan-out, not a fix). `fetchShaderFxCatalog` itself already
 * dedupes concurrent NETWORK requests (see catalog.ts's `promise`), but this local
 * guard is still needed to dedupe the `.then`/subscriber-notify attachment here.
 */
let _catalogRetry: Promise<void> | null = null
const _catalogReadySubs = new Set<() => void>()

function kickCatalogFetch(): void {
  if (_catalogRetry) return
  try {
    // fetchShaderFxCatalog uses Nuxt's auto-imported $fetch, which doesn't exist outside a
    // Nuxt runtime context (e.g. a plain vitest unit test that imports this module directly)
    // and throws SYNCHRONOUSLY (a ReferenceError, not a rejected promise) in that case.
    // resolveField/resolve() must never throw — that's the whole point of this module's
    // graceful fallback — so this guards the call the same way the `.catch` below guards an
    // async rejection (a genuine fetch failure once $fetch does exist).
    _catalogRetry = fetchShaderFxCatalog()
      .then(() => { for (const cb of [..._catalogReadySubs]) cb() })
      .catch(() => { /* transient failure — the NEXT miss retries, see the `finally` below */ })
      .finally(() => { _catalogRetry = null })
  } catch {
    /* no fetch capability in this environment — every future miss just retries the same way */
  }
}

/** Subscribe to be notified once (per successful catalog load) after a `resolveField`
 *  miss kicked a retry that lands. For a host with no per-frame render loop of its own
 *  (a static canvas, a one-shot bake) — a host that DOES already re-render every frame
 *  (Space Type's preview rAF) doesn't need this, since its next `resolveField` call
 *  simply succeeds once the catalog is cached. Returns an unsubscribe function. */
export function onFieldCatalogReady(cb: () => void): () => void {
  _catalogReadySubs.add(cb)
  return () => { _catalogReadySubs.delete(cb) }
}

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
  if (!effect) { kickCatalogFetch(); return { effect: null, spec } }
  return { effect, spec: { ...spec, params: resolveEffectParams(effect, spec.params) } }
}

/** Call once per host frame with every field the frame wants. Decides which stay live
 *  and which freeze, so the ceiling is applied per surface per frame.
 *
 *  LIVE_FIELD_CEILING exists to protect INTERACTIVE framerate (a 30fps preview budget
 *  has no room for arbitrarily many live readbacks). A bake has no frame budget — it
 *  is a one-shot export, not a loop competing for 33ms — so `req.bake` requests are
 *  exempt from the ceiling entirely: every bake-requested descriptor stays live,
 *  however many there are. Only non-bake requests are still subject to
 *  `planFields`/LIVE_FIELD_CEILING. Before this split, a single mixed or bake-only
 *  call still ran every descriptor (bake and live alike) through the SAME ceiling, so
 *  any export of a scene with more than LIVE_FIELD_CEILING distinct shader-fill
 *  descriptors silently froze the 5th-and-beyond fill at t=0 — independent of tab
 *  visibility, a real correctness bug rather than a harness artefact. Fixed here
 *  (rather than in each of the four call sites) so every surface inherits the fix.
 *
 *  HOST-ISOLATION INVARIANT (Important 6 of the final review — read this before adding
 *  a fifth host): this call and every `resolveField` call that consumes the `liveKeys`
 *  it sets MUST run as ONE synchronous span, with NO interleaving `await`. `liveKeys`
 *  is module-global, not scoped per host; if a host's `beginFieldFrame` → resolveField
 *  loop is broken up by an `await`, a DIFFERENT host's `beginFieldFrame` call can land
 *  in the gap, silently reassign `liveKeys` out from under the first host, and freeze
 *  its fields at t=0 — the same failure class `withShaderFillContext` in
 *  ~/lib/spacetype/fills.ts guards for the build-time context, just on the render-time
 *  context instead. Every current caller (fills.ts's `refreshLiveShaderFills`,
 *  materials.ts's `refreshSceneShaderFields`, useCompositorLayers.ts's
 *  `paintLayerStack`) already satisfies this — none of those functions ever await
 *  between this call and their last `resolveField` — and each MUST call
 *  `endFieldFrame()` immediately after its loop so the guard below can detect a
 *  violation instead of failing silently, the way `withShaderFillContext` throws on
 *  re-entry rather than nesting/queueing. */
let _frameOpen = false

export function beginFieldFrame(requests: FieldRequest[]): { frozenCount: number } {
  if (_frameOpen) {
    throw new Error(
      'beginFieldFrame: re-entered while a previous beginFieldFrame\'s resolveField loop ' +
      'had not yet called endFieldFrame(). beginFieldFrame and the resolveField calls that ' +
      'consume its liveKeys MUST run as one synchronous span with no interleaving await — ' +
      'see this function\'s doc comment. A second host\'s beginFieldFrame landed inside that ' +
      'span and would otherwise silently reassign liveKeys and freeze the first host\'s ' +
      'fields at t=0.',
    )
  }
  _frameOpen = true
  const liveCandidates: string[] = []
  const bakeKeys: string[] = []
  for (const r of requests) {
    const { w, h } = fieldSize(r)
    const { spec } = resolve(r.spec)
    const key = fieldKey(spec, w, h, quantizeTime(r.t, r.fps))
    ;(r.bake ? bakeKeys : liveCandidates).push(key)
  }
  const { live, frozen } = planFields(liveCandidates)
  liveKeys = new Set([...live, ...bakeKeys])
  return { frozenCount: frozen.length }
}

/** Close the synchronous span `beginFieldFrame` opened — call once, immediately after
 *  the LAST `resolveField` call in this host's per-frame loop. See `beginFieldFrame`'s
 *  host-isolation doc; skipping this call leaves `_frameOpen` stuck true and makes the
 *  NEXT host's `beginFieldFrame` throw even though nothing actually overlapped. */
export function endFieldFrame(): void {
  _frameOpen = false
}

/**
 * Resolve a `FieldRequest` to pixels — the ONLY function in the product that turns a
 * shader fill into a canvas. Returns `null` when the field can't be rendered (effect
 * not loaded yet, or a WebGL context loss); callers fall back to the input fill.
 *
 * OWNERSHIP CONTRACT — read this before consuming the return value, and read it again
 * before "optimizing" it (Tasks 4, 6, 7 all consume this; none should have to
 * re-derive it, and getting it wrong is how the ~4x regression in the Task 3 report's
 * later addenda happened):
 *
 *  - The returned `HTMLCanvasElement` is OWNED by this module's field cache. A
 *    consumer may bind it DIRECTLY as a texture source (e.g. `new
 *    THREE.CanvasTexture(out)`, or any other GPU upload that reads the canvas) —
 *    that is the intended, cheap usage.
 *  - It is NEVER mutated in place to hold a different descriptor's pixels. A cache
 *    entry, once created, keeps its own canvas for its own key for as long as that
 *    entry survives an LRU eviction; eviction removes the entry from `cache` and
 *    stops handing that canvas out for NEW requests, but does not touch the canvas
 *    itself. A consumer holding a reference from before an eviction keeps a
 *    perfectly valid, unchanged canvas — normal GC semantics, nothing this module
 *    does deliberately keeps it alive or recycles it out from under a holder.
 *  - It remains valid for as long as the consumer holds a reference. Re-resolving
 *    every frame (calling `resolveField` again with the same or updated `t`) is the
 *    intended usage, not an escape hatch — for an animated field that's a fresh
 *    canvas each frame by construction (see `cache`'s doc above); for a frozen or
 *    cache-hit field it's the SAME canvas object returned again, cheaply.
 *  - Consumers MUST NOT COPY it (`drawImage` into their own canvas, `getImageData`,
 *    etc.) as a matter of course. This was tried (an earlier revision had every
 *    consumer path implicitly copy through the bench's own display canvas) and
 *    measured as the dominant cost in a ~4x regression against the direct-`shaderFx`
 *    baseline — copying is exactly the overhead this module exists to let every
 *    surface avoid paying independently. Bind it directly.
 *  - A canvas POOL (recycling evicted output canvases for reuse) was tried and
 *    removed: it measured no benefit, AND it made direct binding actively unsafe — a
 *    consumer holding a reference across an eviction could have its texture start
 *    showing a DIFFERENT descriptor's pixels the moment the recycled canvas got
 *    reused, silently. Do not reintroduce pooling without re-solving that hazard;
 *    see the Task 3 report for the full history.
 */
export function resolveField(req: FieldRequest): HTMLCanvasElement | null {
  const { w, h } = fieldSize(req)
  const { effect, spec } = resolve(req.spec)
  const tq = quantizeTime(req.t, req.fps)
  const liveKey = fieldKey(spec, w, h, tq)
  // Not live this frame -> fall back to the frozen (t=0) variant of the same descriptor.
  const key = liveKeys.size === 0 || liveKeys.has(liveKey) ? liveKey : fieldKey(spec, w, h, 0)
  const hit = cache.get(key)
  if (hit) {
    stats.hits++
    // Refresh recency so eviction is genuinely least-RECENTLY-used. Without this a
    // Map is FIFO-by-insertion, which evicts frozen/over-ceiling entries even though
    // they are read every single frame — precisely the entries this cache exists for.
    // Re-inserting moves the key to the end of the iteration order.
    cache.delete(key); cache.set(key, hit)
    return hit
  }
  stats.misses++

  if (!effect) return null                        // caller falls back to the input fill

  // The input tile is time-invariant (spec.input doesn't change as the field
  // animates) — cached separately from the full render, keyed on input+size only,
  // not on time/effect/params. See `getInputTile`/`tileCache` above.
  const base = getInputTile(spec.input, w, h)
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
  // A fresh canvas per miss, NOT pooled/recycled — see the ownership contract above.
  // An evicted entry's canvas is simply dropped (left for GC); a consumer holding a
  // reference to it keeps a valid, unchanged canvas, which is what makes direct
  // texture binding safe.
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
  tileCache.clear()
  liveKeys = new Set()
  stats = { renders: 0, hits: 0, misses: 0, tileHits: 0, tileMisses: 0 }
  // Test isolation: without this, a test that throws/returns before its matching
  // endFieldFrame() (or simply doesn't model a full host loop) would leave a
  // stuck `_frameOpen = true` that fails the NEXT test's first beginFieldFrame
  // for a reason that has nothing to do with that test.
  _frameOpen = false
}

/** Cumulative counts since the last `clearFieldCache()`. `renders`/`hits`/`misses`
 *  prove (in the bench's `__benchBatch()` hook, and in production debugging) that
 *  identical descriptors collapse to one render regardless of how many consumers ask
 *  for them. `tileHits`/`tileMisses` are the separate input-tile cache (see
 *  `getInputTile`) — the evidence that an animated field's time-invariant input is
 *  actually being reused across frames instead of re-rasterised on every one. */
export function fieldStats(): FieldStats { return { ...stats } }
