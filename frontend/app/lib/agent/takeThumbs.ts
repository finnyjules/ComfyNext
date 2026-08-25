/**
 * Four Takes (Task 3) — per-studio thumbnail adapters.
 *
 * `TakeStrip.vue` (Task 2) shows four proposed takes as small tiles; each tile
 * needs a picture of what the take's config actually LOOKS like. This module
 * is the registry `TakeStrip`'s host wires up: one function per studio that
 * renders a take's config through THAT STUDIO'S OWN renderer, at thumbnail
 * size. Nothing here is a new renderer — every adapter is a thin wrapper
 * around the exact function the studio's own node-card preview or headless
 * bake already calls (named in each adapter's own comment, the house "source
 * pin" convention). See docs/superpowers/specs/2026-08-25-four-takes-design.md
 * scope item 3.
 *
 * Contract: `takeThumbFor(studioId)` always returns a function, even for an
 * unknown id (a no-op that resolves `null`). The returned function never
 * throws — any failure inside an adapter (WebGL unavailable, a font that
 * fails to load, a malformed take config, a network hiccup fetching the
 * shader catalog) resolves to `null`, and the strip shows that tile as an
 * error rather than blocking the other three or blanking the row.
 *
 * WebGL singleton caution: `gradientFx`/`textureFx`/`shaderFx` each render
 * into ONE shared canvas and return it (see e.g. `GradientFxRenderer.render`'s
 * own doc: "into the shared canvas; returns it") — a second call (another
 * take, or the studio's own live preview) repaints that same canvas. Every
 * WebGL adapter below copies the pixels out via `drawImage` into a fresh
 * canvas BEFORE returning, immediately after the render call and before any
 * `await` — the same safe-copy pattern `dev/pattern-gallery.vue`'s
 * `renderItem()` uses for `textureFx.render()`.
 */

import { gradientFx } from '~/lib/gradientfx/renderer'
import type { GradientConfig } from '~/lib/gradientfx/types'

import { textureFx } from '~/lib/texturefx/renderer'
import { textureDefaults } from '~/lib/texturefx/controls'
import type { Params as TextureParams } from '~/lib/spacetype/effect'

import { shaderFx } from '~/lib/shaderfx/renderer'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { composePasses } from '~/lib/shaderstudio/passes'
import { hydrateConfig as hydrateShaderConfig, type ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { migrateShaderConfig } from '~/lib/shaderstudio/migrate'

import { renderStudio, drawToCanvas, studioFramePad } from '~/lib/geoshape/render'
import { studioDocFromPersisted, type GeoStudioDoc } from '~/lib/geoshape/studio'

import { drawVectorTypeToCanvas } from '~/lib/vectortype/canvas'
import { loadVariableFont } from '~/lib/vectortype/font'
import { mergeConfig as mergeVectorTypeConfig } from '~/lib/vectortype/config'
import { vtStillTime } from '~/lib/vectortype/presetMotion'

/** The five studios Milestone A covers (spec scope item, "the five fast
 *  studios"). Exported so Task 4 and this module's own tests can iterate the
 *  registry without hand-duplicating the id list. */
export const TAKE_THUMB_STUDIO_IDS = ['gradient', 'texture', 'shader', 'shape', 'vectortype'] as const
export type TakeThumbStudioId = typeof TAKE_THUMB_STUDIO_IDS[number]

/** What a tile can be handed: a live canvas, a serialised data URL (either is
 *  accepted by `TakeStrip.vue`'s thumb prop, per Task 2's interface), or
 *  `null` for the error tile. */
export type TakeThumb = HTMLCanvasElement | string | null
export type TakeThumbAdapter = (config: unknown, size?: number) => Promise<TakeThumb>

const DEFAULT_SIZE = 160

function freshCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const px = Math.max(1, Math.round(size))
  c.width = px
  c.height = px
  return c
}

// Shader thumbnails have no upstream image to sample (a take is a config, not
// a wired frame source) — a tiny neutral canvas stands in as the base, the
// identical fallback `ShaderStudioSurface.vue`'s `GENERATIVE_BASE` (its
// generative-effect preview/bake path) and `ShaderEffectNode`'s
// `baseImage.value ?? placeholder` use for a source-less/generative effect.
// Built once and reused — it is read-only, never rendered into.
let _shaderBase: HTMLCanvasElement | null = null
function shaderPlaceholderBase(): HTMLCanvasElement {
  if (_shaderBase) return _shaderBase
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 8
  c.getContext('2d')!.fillRect(0, 0, 8, 8)
  _shaderBase = c
  return c
}

/**
 * Gradient — wraps `gradientFx.render(cfg, w, h, t)`, the exact call
 * `GradientStudioNode.vue`'s card preview (`renderFrame`) makes every frame.
 */
async function gradientThumb(config: unknown, size = DEFAULT_SIZE): Promise<TakeThumb> {
  const cfg = config as GradientConfig
  const gpu = gradientFx.render(cfg, size, size, 0)
  const out = freshCanvas(size)
  out.getContext('2d')!.drawImage(gpu, 0, 0)
  return out
}

/**
 * Texture — wraps `textureFx.render(params, w, h, t)`, the SAME call and the
 * SAME copy-before-return shape `dev/pattern-gallery.vue`'s `renderItem()`
 * uses to draw every pattern's small tile (this studio's own gallery-preview
 * precedent, per the brief). Defended over `textureDefaults()` the way
 * `TextureStudioNode.vue`'s card preview merges a saved/partial params bag.
 */
async function textureThumb(config: unknown, size = DEFAULT_SIZE): Promise<TakeThumb> {
  // Same merge shape `TextureStudioNode.vue`'s card preview uses for a saved
  // params bag (`{ ...textureDefaults(), ...saved }`, `saved` typed as a full
  // `Params`, not a `Partial` — a `Partial<Params>` spread widens every value
  // to `ParamValue | undefined`, which `textureFx.render` correctly refuses).
  const p: TextureParams = { ...textureDefaults(), ...(config as TextureParams) }
  const gpu = textureFx.render(p, size, size, 0)
  const out = freshCanvas(size)
  out.getContext('2d')!.drawImage(gpu, 0, 0)
  return out
}

/**
 * Shader — wraps `shaderFx.render(passes, base, w, h)` through the SAME
 * `composePasses` pipeline `ShaderStudioSurface.vue`'s effect-picker gallery
 * (`renderThumb`, one tile per effect) and its `renderBlob` bake path both go
 * through, and the same `hydrateConfig(migrateShaderConfig(...))` normalizer
 * `ShaderStudioNode.vue`'s card preview applies to a saved config.
 */
async function shaderThumb(config: unknown, size = DEFAULT_SIZE): Promise<TakeThumb> {
  const cfg: ShaderStudioConfig = hydrateShaderConfig(migrateShaderConfig(config))
  const catalog = await fetchShaderFxCatalog()
  const resolveDef = (id: string) => catalog.effects.find(e => e.id === id) ?? null
  const passes = composePasses(cfg, resolveDef, 0)
  const gpu = shaderFx.render(passes, shaderPlaceholderBase(), size, size)
  const out = freshCanvas(size)
  out.getContext('2d')!.drawImage(gpu, 0, 0)
  return out
}

/**
 * Shape — wraps `renderStudio(doc)` + `drawToCanvas(shapes, ctx, w, h, pad)`,
 * the exact pair `ShapeStudioNode.vue`'s `bakeOutput()` (the node-card
 * headless bake) calls. `studioDocFromPersisted` is the same normalizer that
 * bake and `studioControls.ts`'s agent-controls adapter both use, so it
 * accepts either shape a take's config can arrive in: a full layered
 * `GeoStudioDoc` (has a `layers` array) or a flat single-mark
 * `GeoShapeConfig` (what `geoAgentControls` actually describes/patches) —
 * wrapped `{ doc }` or `{ config }` respectively, mirroring the legacy-blob
 * migration `studioDocFromPersisted` already performs for a persisted node.
 */
async function shapeThumb(config: unknown, size = DEFAULT_SIZE): Promise<TakeThumb> {
  const looksLikeDoc = !!config && typeof config === 'object' && Array.isArray((config as { layers?: unknown }).layers)
  const doc: GeoStudioDoc = studioDocFromPersisted(looksLikeDoc ? { doc: config } : { config })
  const shapes = await renderStudio(doc)
  const out = freshCanvas(size)
  drawToCanvas(shapes, out.getContext('2d')!, size, size, studioFramePad(doc))
  return out
}

/**
 * Vector Type — wraps `drawVectorTypeToCanvas(canvas, font, cfg, t, opts)`,
 * the same call `VectorTypeNode.vue`'s card preview AND its `bakeOutput()`
 * headless bake both make, at `vtStillTime(cfg)` (the preset's settled rest
 * frame — an entrance preset's true frame 0 is deliberately empty, so baking
 * literal t=0 would render a blank tile).
 */
async function vectorTypeThumb(config: unknown, size = DEFAULT_SIZE): Promise<TakeThumb> {
  const cfg = mergeVectorTypeConfig(config)
  const font = await loadVariableFont(cfg.fontId)
  const out = freshCanvas(size)
  drawVectorTypeToCanvas(out, font, cfg, vtStillTime(cfg), { width: size, height: size, background: null })
  return out
}

const ADAPTERS: Record<TakeThumbStudioId, TakeThumbAdapter> = {
  gradient: gradientThumb,
  texture: textureThumb,
  shader: shaderThumb,
  shape: shapeThumb,
  vectortype: vectorTypeThumb,
}

/** True for exactly the five ids this registry covers. */
export function isTakeThumbStudioId(studioId: string): studioId is TakeThumbStudioId {
  return (TAKE_THUMB_STUDIO_IDS as readonly string[]).includes(studioId)
}

/**
 * The adapter for `studioId` — always a function, never `undefined`, so a
 * caller never has to null-check before calling it. An id outside the five
 * (a typo, a future studio not yet wired, Scene3D before Milestone B) gets a
 * function that resolves `null` on every call, same as a real adapter's own
 * failure path — the strip renders it as one more error tile rather than
 * throwing.
 */
export function takeThumbFor(studioId: string): TakeThumbAdapter {
  const adapter = isTakeThumbStudioId(studioId) ? ADAPTERS[studioId] : null
  if (!adapter) return async () => null
  return async (config: unknown, size = DEFAULT_SIZE) => {
    try {
      return await adapter(config, size)
    } catch {
      return null
    }
  }
}
