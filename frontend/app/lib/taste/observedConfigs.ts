/**
 * Observed route → studio configs, for the taste-wall dev page
 * (app/pages/dev/taste-wall.vue; spike brief:
 * docs/superpowers/spikes/2026-08-05-executable-brand-kit-spike.md).
 *
 * Builds one config per studio straight from the mined stats in
 * app/lib/taste/observed.json — no AI, no facets: each param that the facet
 * mapping (mapping.ts) names gets its OBSERVED MEDIAN where the sample is
 * real (n >= OBSERVED_MIN_N), and colour-valued entries take swatches from
 * the studio's frequency-sorted colour pool (top dark as ground, top
 * saturated as accent). Deliberately a separate file: mapping.ts is the
 * spike's frozen facet table and must not learn about observed.json.
 *
 * Path translation is the only subtlety — observed.json keys params the way
 * the miner normalises them (`layers[*].`, `effects[<id>].`,
 * `appearance[fill].`) while the mapping addresses configs
 * (`layers.0.`, `effects.<slot>.`, `appearance.0.`). observedStatsKey() is
 * that bridge, and the unit test drives a value through every arm of it.
 */
import type { GradientConfig } from '~/lib/gradientfx/types'
import type { ShaderStudioConfig } from '~/lib/shaderstudio/types'
import type { VectorTypeConfig } from '~/lib/vectortype/config'
import {
  TASTE_PARAM_MAPPINGS,
  gradientConfigPath,
  gradientRange,
  paletteSwatch,
  type TasteStudio,
} from '~/lib/taste/mapping'
import { getByPath, setByPath } from '~/lib/studio/path'

export interface ObservedParamStats {
  n: number
  projects: number
  min: number
  p25: number
  median: number
  p75: number
  max: number
}

export interface ObservedStudioStats {
  params?: Record<string, ObservedParamStats>
  /** hex → frequency, as mined. */
  colors?: Record<string, number>
}

/** The slice of observed.json this module reads. */
export interface ObservedStats {
  studios?: Partial<Record<'gradient' | 'shader' | 'vectorType', ObservedStudioStats>>
}

/** Below this sample size a mined median is anecdote, not observation. */
export const OBSERVED_MIN_N = 3

/** How many frequency-ranked colours make the working pool per studio. */
export const OBSERVED_POOL_SIZE = 8

/** observed.json's studio keys vs the mapping's studio ids ('vectorType' ≠ 'vectortype'). */
const OBSERVED_STUDIO_KEY: Record<TasteStudio, 'gradient' | 'shader' | 'vectorType'> = {
  gradient: 'gradient',
  shader: 'shader',
  vectortype: 'vectorType',
}

/** Effect slot index → catalog id, mirroring applyTasteToShader's seeded slots. */
const SHADER_SLOT_IDS = ['post_grain', 'color_temperature'] as const

/** Translate a mapping entry's path into observed.json's stats key. */
export function observedStatsKey(studio: TasteStudio, path: string): string {
  if (studio === 'gradient') {
    return gradientConfigPath(path).replace(/^layers\.0\./, 'layers[*].')
  }
  if (studio === 'shader') {
    const m = /^effects\.(\d+)\.(.*)$/.exec(path)
    if (m) {
      const id = SHADER_SLOT_IDS[Number(m[1])]
      return id ? `effects[${id}].${m[2]}` : path
    }
    return path
  }
  return path.replace(/^appearance\.0\./, 'appearance[fill].')
}

const relLuma = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Top-N observed colours for a studio, frequency-sorted, valid hex only. */
export function observedPool(observed: ObservedStats, studio: TasteStudio, limit = OBSERVED_POOL_SIZE): string[] {
  const colors = observed.studios?.[OBSERVED_STUDIO_KEY[studio]]?.colors ?? {}
  return Object.entries(colors)
    .filter(([hex]) => /^#[0-9a-fA-F]{6}$/.test(hex))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex)
}

function statsFor(observed: ObservedStats, studio: TasteStudio, path: string): ObservedParamStats | null {
  const s = observed.studios?.[OBSERVED_STUDIO_KEY[studio]]?.params?.[observedStatsKey(studio, path)]
  return s && Number.isFinite(s.median) && s.n >= OBSERVED_MIN_N ? s : null
}

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * Build the observed column's configs from the mined stats. Clones the bases,
 * never mutates. Only params the facet mapping names are touched — the
 * observed column answers "where does YOUR practice put the mapped sliders",
 * not "replay an average project".
 */
export function observedToConfigs(
  observed: ObservedStats,
  bases: { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig },
): { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig } {
  const gradient = deepClone(bases.gradient)
  const shader = deepClone(bases.shader)
  const vectortype = deepClone(bases.vectortype)
  const cfgFor: Record<TasteStudio, unknown> = { gradient, shader, vectortype }

  for (const entry of TASTE_PARAM_MAPPINGS) {
    if (entry.palette) continue // colours handled from the pools below
    const stats = statsFor(observed, entry.studio, entry.path)
    if (!stats) continue
    if (entry.studio === 'gradient') {
      // Medians are already in config units; the range lookup only guards that
      // the key is a real slider (same discipline as applyTasteToGradient).
      if (!gradientRange(entry.path)) continue
      setByPath(gradient, gradientConfigPath(entry.path), stats.median)
    }
    else if (entry.studio === 'vectortype') {
      // Mirror applyTasteToVectorType: these params are integer-valued.
      setByPath(vectortype, entry.path, Math.round(stats.median))
    }
    else {
      setByPath(cfgFor[entry.studio], entry.path, stats.median)
    }
  }

  // ── Gradient: enable switches ride their observed sliders + pooled colours ──
  const grain = statsFor(observed, 'gradient', 'post.grainAmount')
  if (grain) setByPath(gradient, 'post.grain', grain.median > 0)
  const bloom = statsFor(observed, 'gradient', 'post.bloomStrength')
  if (bloom) setByPath(gradient, 'post.bloom', bloom.median > 0)

  const gPool = observedPool(observed, 'gradient')
  if (gPool.length >= 2) {
    const ramp = [...gPool].sort((a, b) => relLuma(a) - relLuma(b)) // darkest-first: observed grounds are dark
    const stops = getByPath(gradient, 'layers.0.color.stops') as Array<{ pos: number; color: string }> | undefined
    if (Array.isArray(stops) && stops.length) {
      stops.forEach((s, i) => { s.color = ramp[Math.min(i, ramp.length - 1)]! })
    }
    const bg = paletteSwatch(gPool, 'darkest')
    if (bg) setByPath(gradient, 'canvas.background', bg)
  }

  // ── Shader: pooled ink/paper; groups with observed values become visible ──
  const sPool = observedPool(observed, 'shader')
  const ink = paletteSwatch(sPool, 'darkest')
  const paper = paletteSwatch(sPool, 'lightest')
  if (ink) shader.duotone.ink = ink
  if (paper) shader.duotone.paper = paper
  // duotone.enabled stays as the base: the mined enums show it observed OFF.
  const adjustTouched = ['adjust.saturation', 'adjust.contrast', 'adjust.exposure']
    .some(p => statsFor(observed, 'shader', p))
  if (adjustTouched) shader.adjust.enabled = true
  const bloomTouched = ['post.bloom.intensity', 'post.bloom.threshold']
    .some(p => statsFor(observed, 'shader', p))
  if (bloomTouched) shader.post.bloom.enabled = true

  // ── Vector Type: accent ink from the pool ──
  const vPool = observedPool(observed, 'vectortype')
  const accent = paletteSwatch(vPool, 'accent')
  if (accent && vectortype.appearance[0]?.paint) setByPath(vectortype, 'appearance.0.paint.a', accent)

  return { gradient, shader, vectortype }
}

/**
 * The trivially-invertible observed→facet proxies for the divergence readout.
 * Honest and rough: only where the mapping is a straight range map (gain 1)
 * or a direct colour-luma read. Everything else is n/a by design.
 */
export function observedFacetProxies(observed: ObservedStats): Partial<Record<'texture' | 'valueBias', number>> {
  const out: Partial<Record<'texture' | 'valueBias', number>> = {}
  const grain = statsFor(observed, 'gradient', 'post.grainAmount')
  const range = gradientRange('post.grainAmount')
  if (grain && range && range.max > range.min) {
    out.texture = Math.min(1, Math.max(0, (grain.median - range.min) / (range.max - range.min)))
  }
  const bg = paletteSwatch(observedPool(observed, 'gradient'), 'darkest')
  if (bg) out.valueBias = relLuma(bg) / 255
  return out
}
