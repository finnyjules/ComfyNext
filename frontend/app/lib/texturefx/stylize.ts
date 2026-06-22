import type { Params } from '~/lib/spacetype/effect'
import type { EffectDef } from '~/lib/shaderfx/types'
import { shaderFx, expandPasses, type ShaderPass } from '~/lib/shaderfx/renderer'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { getEffect, assetUrl } from '~/lib/shaderfx/catalog'
import { DITHER_PATTERNS, DITHER_PERIOD, STYLIZE_EFFECT_ID } from '~/lib/texturefx/types'

// Snap u_scale so dither cells-across (= 1/scale for a square tile) is a multiple
// of the pattern's tiling period, keeping the dithered tile seamless.
export function snapDitherScale(pattern: number, scale: number): number {
  const period = DITHER_PERIOD[pattern] ?? 4
  const cells = Math.max(period, Math.round((1 / scale) / period) * period)
  return 1 / cells
}

// Pure param → uniform mapping for one stylize kind (no GL). Tested.
export function stylizeUniforms(kind: string, p: Params): Record<string, number> {
  if (kind === 'dither') {
    const pattern = DITHER_PATTERNS[String(p.ditherPattern)] ?? 1
    return {
      u_pattern: pattern,
      u_scale: snapDitherScale(pattern, Number(p.ditherScale) || 0.012),
      u_levels: Number(p.ditherLevels) || 3,
      u_colored: String(p.ditherColor) === 'mono' ? 0 : 1,
    }
  }
  if (kind === 'posterize') return { u_levels: Number(p.posterizeLevels) || 5 }
  if (kind === 'duotone') {
    return {
      u_shadowHue: Number(p.duoShadow) || 0,
      u_lightHue: Number(p.duoLight) || 0,
      u_contrast: Number(p.duoContrast) || 0,
    }
  }
  return {}
}

// --- preload + render -------------------------------------------------------
interface Loaded { effect: EffectDef; textures: Record<string, TexImageSource>; uniforms: Record<string, number> }
const _loaded: Record<string, Loaded | null> = {}
let _preloading: Promise<void> | null = null

async function loadEffectTextures(effect: EffectDef): Promise<{ textures: Record<string, TexImageSource>; uniforms: Record<string, number> }> {
  const textures: Record<string, TexImageSource> = {}
  const uniforms: Record<string, number> = {}
  for (const t of effect.textures ?? []) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = assetUrl(t.file, t.v) // /comfynext/shader_effects/assets/<file> — same route as ShaderStudio
    await img.decode().catch(() => {})
    textures[t.uniform] = img
    Object.assign(uniforms, t.extraUniforms ?? {})
  }
  return { textures, uniforms }
}

/** Preload the stylize effects + their textures. Idempotent; safe to call repeatedly. */
export function preloadStylize(): Promise<void> {
  if (_preloading) return _preloading
  _preloading = (async () => {
    for (const id of Object.values(STYLIZE_EFFECT_ID)) {
      if (_loaded[id] !== undefined) continue
      const effect = await getEffect(id).catch(() => null)
      if (!effect) { _loaded[id] = null; continue }
      const { textures, uniforms } = await loadEffectTextures(effect)
      _loaded[id] = { effect, textures, uniforms }
    }
  })()
  return _preloading
}

/**
 * Run the tile through the selected stylize effect. Returns `base` unchanged when
 * stylize is 'none' or the effect isn't loaded yet (caller re-renders after preload).
 * Render dims should be multiples of 64 so dither patterns stay seamless.
 */
export function stylizeTile(base: HTMLCanvasElement, p: Params, w: number, h: number): HTMLCanvasElement {
  const kind = String(p.stylize ?? 'none')
  if (kind === 'none') return base
  const id = STYLIZE_EFFECT_ID[kind]
  const L = id ? _loaded[id] : null
  if (!L) return base
  const uniforms = {
    ...resolveUniforms(L.effect, stylizeUniforms(kind, p)),
    u_time: 0, u_seed: 42, u_hasInput: 1, ...L.uniforms,
  }
  const passes: ShaderPass[] = expandPasses(L.effect.id, L.effect.source, uniforms, L.textures, L.effect.passes ?? 1)
  return shaderFx.render(passes, base, w, h)
}
