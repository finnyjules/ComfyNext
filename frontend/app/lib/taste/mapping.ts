/**
 * Facet → param mapping — the standalone hand-mapped file of the
 * executable-brand-kit spike (docs/superpowers/spikes/2026-08-05-...spike.md).
 *
 * ~30 high-salience params across three studios (Gradient, Shader, Vector
 * Type), each tied to one taste facet (shared/taste/facets.ts). Deliberately a
 * FLAT TABLE in one file: no ControlSpec schema changes, no migrations — the
 * spike must not pay productization costs.
 *
 * Path addressing per studio:
 *  - gradient: GRADIENT_CONTROLS keys (frozen contracts). `layer.*` keys are
 *    layer-relative and resolve to `layers.0.*` on the config, exactly as
 *    gradientfx/motion.ts expands them. Ranges are looked up from the control
 *    spec itself, never restated here.
 *  - shader: dotted ShaderStudioConfig paths ('adjust.saturation',
 *    'effects.0.params.u_amount'). Effect uniform ranges restated from
 *    shader_effects/manifest.json (cross-checked by the unit test).
 *  - vectortype: dotted VectorTypeConfig paths. `axes.*` is sparse by design —
 *    writing a tag is always legal; fonts without it drop it at render time.
 *
 * Value model: facet value v (0..1) → t = clamp01(0.5 + (v − 0.5) · gain) →
 * param = min + t · (max − min). Sign of `gain` inverts the axis, magnitude
 * scales sensitivity. Colour entries carry a `palette` role instead of a range
 * and take swatches from the deterministic analyzer.
 */
import type { FacetId, TasteReading } from '~~/shared/taste/facets'
import { GRADIENT_CONTROLS } from '~/lib/gradientfx/controls'
import type { GradientConfig } from '~/lib/gradientfx/types'
import type { ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { newLayerId } from '~/lib/shaderstudio/types'
import type { VectorTypeConfig } from '~/lib/vectortype/config'
import { getByPath, setByPath } from '~/lib/studio/path'

export type TasteStudio = 'gradient' | 'shader' | 'vectortype'

/** Which analyzed swatch a colour-valued mapping takes. */
export type PaletteRole = 'darkest' | 'lightest' | 'accent' | 'ramp'

export interface TasteParamMapping {
  studio: TasteStudio
  /** Studio-addressed param path — see the header for per-studio addressing. */
  path: string
  facet: FacetId
  /** Sign inverts the facet axis; magnitude scales travel around the range midpoint. */
  gain: number
  /** Target range for numeric params. Gradient entries omit it (looked up from GRADIENT_CONTROLS). */
  min?: number
  max?: number
  /** Colour-valued entry: takes a palette swatch instead of a numeric range. */
  palette?: PaletteRole
  note?: string
}

export const TASTE_PARAM_MAPPINGS: TasteParamMapping[] = [
  // --- Gradient (ranges from GRADIENT_CONTROLS; keys are frozen contracts) ---
  { studio: 'gradient', path: 'flow.intensity', facet: 'regularity', gain: 1, note: 'organic taste → liquid warp on; rigid → flat ramp' },
  { studio: 'gradient', path: 'flow.noiseScale', facet: 'density', gain: 0.8, note: 'busy → finer, higher-frequency noise' },
  { studio: 'gradient', path: 'flow.swirl', facet: 'regularity', gain: 0.7 },
  { studio: 'gradient', path: 'flow.detail', facet: 'density', gain: 0.6 },
  { studio: 'gradient', path: 'layer.color.steps', facet: 'edgeQuality', gain: -0.6, note: 'crisp taste → posterized bands; painterly → smooth (0 steps)' },
  { studio: 'gradient', path: 'layer.color.hueDrift', facet: 'paletteBreadth', gain: 0.5, note: 'polychrome → let the ramp drift hue; mid facet = 0 drift' },
  { studio: 'gradient', path: 'focus.blur', facet: 'edgeQuality', gain: 0.8, note: 'painterly → soft focus' },
  { studio: 'gradient', path: 'relief.relief', facet: 'texture', gain: 0.5 },
  { studio: 'gradient', path: 'post.grainAmount', facet: 'texture', gain: 1 },
  { studio: 'gradient', path: 'post.grainSize', facet: 'texture', gain: 0.4 },
  { studio: 'gradient', path: 'post.bloomStrength', facet: 'finish', gain: 1, note: 'luminous → bloom (enable switch set alongside)' },
  { studio: 'gradient', path: 'post.vignetteAmount', facet: 'valueBias', gain: -0.6, note: 'dark taste → vignetted corners' },
  { studio: 'gradient', path: 'canvas.background', facet: 'valueBias', gain: 1, palette: 'darkest', note: 'darkest swatch as ground; lightest instead when valueBias is high' },
  { studio: 'gradient', path: 'layer.color.stops.*.color', facet: 'paletteBreadth', gain: 1, palette: 'ramp', note: 'analyzed swatches injected into the ramp stops, in luminance order' },

  // --- Shader (post_grain + color_temperature as the two mapped effects,
  //     plus doc-level duotone/adjust/bloom from ShaderStudioConfig) ----------
  { studio: 'shader', path: 'effects.0.params.u_amount', facet: 'texture', gain: 1, min: 0, max: 1, note: 'post_grain amount' },
  { studio: 'shader', path: 'effects.0.params.u_size', facet: 'texture', gain: 0.5, min: 1, max: 8, note: 'post_grain size — textured taste also reads coarser' },
  { studio: 'shader', path: 'effects.1.params.u_temperature', facet: 'warmth', gain: 1, min: -1, max: 1, note: 'color_temperature: cool ↔ warm straight through' },
  { studio: 'shader', path: 'effects.1.params.u_tint', facet: 'paletteBreadth', gain: 0.3, min: -1, max: 1 },
  { studio: 'shader', path: 'adjust.saturation', facet: 'saturation', gain: 1, min: -1, max: 1 },
  { studio: 'shader', path: 'adjust.contrast', facet: 'contrast', gain: 1, min: -1, max: 1 },
  { studio: 'shader', path: 'adjust.exposure', facet: 'valueBias', gain: 0.5, min: -2, max: 2 },
  { studio: 'shader', path: 'post.bloom.intensity', facet: 'finish', gain: 1, min: 0, max: 3 },
  { studio: 'shader', path: 'post.bloom.threshold', facet: 'valueBias', gain: 0.4, min: 0, max: 1, note: 'light imagery blooms only its brightest highlights' },
  { studio: 'shader', path: 'duotone.ink', facet: 'valueBias', gain: 1, palette: 'darkest' },
  { studio: 'shader', path: 'duotone.paper', facet: 'valueBias', gain: 1, palette: 'lightest' },

  // --- Vector Type (sparse axes object; GRAD exists on Roboto Flex only) ----
  { studio: 'vectortype', path: 'axes.wght', facet: 'contrast', gain: 0.8, min: 100, max: 900, note: 'punchy → heavy weight' },
  { studio: 'vectortype', path: 'axes.GRAD', facet: 'valueBias', gain: -0.6, min: -200, max: 150, note: 'dark taste → positive grade (Roboto Flex; other fonts drop the tag at render)' },
  { studio: 'vectortype', path: 'size', facet: 'density', gain: 0.5, min: 60, max: 240 },
  { studio: 'vectortype', path: 'tracking', facet: 'density', gain: -0.6, min: -80, max: 300, note: 'sparse → airy tracking; busy → tight' },
  { studio: 'vectortype', path: 'arc', facet: 'ornament', gain: 1, min: 0, max: 90, note: 'restrained → straight baseline; decorative → arched' },
  { studio: 'vectortype', path: 'skewX', facet: 'regularity', gain: 0.3, min: -12, max: 12, note: 'organic → a slight lean' },
  { studio: 'vectortype', path: 'appearance.0.paint.a', facet: 'saturation', gain: 1, palette: 'accent', note: 'most saturated swatch as the type ink' },
]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Below this confidence a facet is treated as unread and its params untouched. */
export const CONFIDENCE_FLOOR = 0.25

/** Map one facet value into an entry's numeric range. */
export function mappedValue(entry: TasteParamMapping, facetValue: number): number {
  const min = entry.min ?? 0
  const max = entry.max ?? 1
  const t = clamp01(0.5 + (facetValue - 0.5) * entry.gain)
  return min + t * (max - min)
}

/** GRADIENT_CONTROLS range lookup for gradient numeric entries. */
export function gradientRange(key: string): { min: number; max: number } | null {
  const c = GRADIENT_CONTROLS.find(c => c.key === key)
  return c && c.kind === 'slider' && typeof c.min === 'number' && typeof c.max === 'number'
    ? { min: c.min, max: c.max }
    : null
}

/** `layer.*` control keys address layer 0 on the config, per gradientfx/motion.ts. */
export function gradientConfigPath(key: string): string {
  return key.startsWith('layer.') ? `layers.0.${key.slice('layer.'.length)}` : key
}

function facetValue(reading: TasteReading, id: FacetId): number | null {
  const f = reading.facets[id]
  if (!f || f.confidence < CONFIDENCE_FLOOR) return null
  return f.value
}

const relLuma = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}
const satOf = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Resolve a palette role to a concrete swatch. Null when the palette is empty. */
export function paletteSwatch(palette: string[], role: PaletteRole): string | null {
  const valid = palette.filter(p => /^#[0-9a-fA-F]{6}$/.test(p))
  if (!valid.length) return null
  const byLuma = [...valid].sort((a, b) => relLuma(a) - relLuma(b))
  if (role === 'darkest') return byLuma[0]!
  if (role === 'lightest') return byLuma[byLuma.length - 1]!
  if (role === 'accent') return [...valid].sort((a, b) => satOf(b) - satOf(a))[0]!
  return valid[0]! // 'ramp' resolves per-stop at the apply site, not here
}

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * Gradient: apply every gradient-studio mapping the reading can support.
 * Ranges come from GRADIENT_CONTROLS; palette entries inject the analyzed
 * swatches (ramp stops in luminance order, ground from the value bias).
 */
export function applyTasteToGradient(
  reading: TasteReading,
  palette: string[],
  base: GradientConfig,
): GradientConfig {
  const cfg = deepClone(base)
  for (const entry of TASTE_PARAM_MAPPINGS) {
    if (entry.studio !== 'gradient' || entry.palette) continue
    const v = facetValue(reading, entry.facet)
    if (v === null) continue
    const range = gradientRange(entry.path)
    if (!range) continue
    setByPath(cfg, gradientConfigPath(entry.path), mappedValue({ ...entry, ...range }, v))
  }
  // Bloom/grain enable switches ride their mapped sliders.
  const finish = facetValue(reading, 'finish')
  if (finish !== null) setByPath(cfg, 'post.bloom', finish > 0.55)
  const texture = facetValue(reading, 'texture')
  if (texture !== null) setByPath(cfg, 'post.grain', texture > 0.3)

  if (palette.length) {
    const ramp = [...palette].filter(p => /^#[0-9a-fA-F]{6}$/.test(p)).sort((a, b) => relLuma(a) - relLuma(b))
    if (ramp.length >= 2) {
      const light = facetValue(reading, 'valueBias') ?? 0.5
      const ordered = light >= 0.5 ? [...ramp].reverse() : ramp // ground-first ramps read better
      const stops = getByPath(cfg, 'layers.0.color.stops') as Array<{ pos: number; color: string }> | undefined
      if (Array.isArray(stops) && stops.length) {
        stops.forEach((s, i) => { s.color = ordered[Math.min(i, ordered.length - 1)]! })
      }
      else {
        setByPath(cfg, 'layers.0.color.stops', ordered.slice(0, 4).map((color, i, arr) => ({
          pos: arr.length === 1 ? 0 : i / (arr.length - 1), color,
        })))
      }
      setByPath(cfg, 'canvas.background', light >= 0.6 ? ramp[ramp.length - 1]! : ramp[0]!)
    }
  }
  return cfg
}

/**
 * Shader: seeds effects[0] = post_grain and effects[1] = color_temperature
 * (the two mapped catalog effects), then applies the numeric table and the
 * duotone/adjust/bloom doc-level params. Enable switches follow the facets
 * that justify them (duotone only for genuinely narrow palettes).
 */
export function applyTasteToShader(
  reading: TasteReading,
  palette: string[],
  base: ShaderStudioConfig,
): ShaderStudioConfig {
  const cfg = deepClone(base)
  const ensureEffect = (i: number, id: string) => {
    while (cfg.effects.length <= i) {
      cfg.effects.push({ layerId: newLayerId(), id: '', params: {}, enabled: true, customChars: '', blend: 'normal', opacity: 1 })
    }
    const slot = cfg.effects[i]!
    if (slot.id !== id) { slot.id = id; slot.params = {} }
    slot.enabled = true
  }
  ensureEffect(0, 'post_grain')
  ensureEffect(1, 'color_temperature')

  for (const entry of TASTE_PARAM_MAPPINGS) {
    if (entry.studio !== 'shader') continue
    const v = facetValue(reading, entry.facet)
    if (v === null) continue
    if (entry.palette) {
      const swatch = paletteSwatch(palette, entry.palette)
      if (swatch) setByPath(cfg, entry.path, swatch)
      continue
    }
    setByPath(cfg, entry.path, mappedValue(entry, v))
  }

  const breadth = facetValue(reading, 'paletteBreadth')
  cfg.duotone.enabled = breadth !== null && breadth < 0.35 && palette.length >= 2
  const finish = facetValue(reading, 'finish')
  if (finish !== null) cfg.post.bloom.enabled = finish > 0.55
  cfg.adjust.enabled = facetValue(reading, 'saturation') !== null
    || facetValue(reading, 'contrast') !== null || facetValue(reading, 'valueBias') !== null
  return cfg
}

/** Vector Type: axes/size/tracking/arc/skew plus the accent ink. */
export function applyTasteToVectorType(
  reading: TasteReading,
  palette: string[],
  base: VectorTypeConfig,
): VectorTypeConfig {
  const cfg = deepClone(base)
  for (const entry of TASTE_PARAM_MAPPINGS) {
    if (entry.studio !== 'vectortype') continue
    const v = facetValue(reading, entry.facet)
    if (v === null) continue
    if (entry.palette) {
      const swatch = paletteSwatch(palette, entry.palette)
      if (swatch && cfg.appearance[0]?.paint) setByPath(cfg, entry.path, swatch)
      continue
    }
    // `axes` is sparse: setByPath creates the tag, which is exactly the contract
    // (absent = font default; present-but-unsupported = dropped at render).
    setByPath(cfg, entry.path, Math.round(mappedValue(entry, v)))
  }
  return cfg
}

/** Convenience: all three studios at once, for the wall page. */
export function applyTasteToConfigs(
  reading: TasteReading,
  palette: string[],
  bases: { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig },
): { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig } {
  return {
    gradient: applyTasteToGradient(reading, palette, bases.gradient),
    shader: applyTasteToShader(reading, palette, bases.shader),
    vectortype: applyTasteToVectorType(reading, palette, bases.vectortype),
  }
}
