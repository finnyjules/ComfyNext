/**
 * Facet→param mapping (app/lib/taste/mapping.ts) against the REAL control
 * lists: every gradient key must exist in GRADIENT_CONTROLS, every shader
 * uniform in shader_effects/manifest.json (with ranges inside the catalog's),
 * every doc-level shader path on defaultConfig(), and every Vector Type path
 * on DEFAULT_CONFIG (axes validated against the font catalog). Then the apply
 * helpers must actually move the mapped params off their defaults.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TASTE_PARAM_MAPPINGS,
  applyTasteToGradient,
  applyTasteToShader,
  applyTasteToVectorType,
  gradientConfigPath,
  gradientRange,
  mappedValue,
  paletteSwatch,
} from '../../app/lib/taste/mapping'
import { GRADIENT_CONTROLS } from '../../app/lib/gradientfx/controls'
import type { GradientConfig } from '../../app/lib/gradientfx/types'
import { defaultConfig } from '../../app/lib/shaderstudio/types'
import { DEFAULT_CONFIG } from '../../app/lib/vectortype/config'
import { VARIABLE_FONTS } from '../../app/data/variable-fonts'
import { FACET_IDS, type TasteReading } from '../../shared/taste/facets'
import { getByPath } from '../../app/lib/studio/path'

const manifestPath = fileURLToPath(new URL('../../../shader_effects/manifest.json', import.meta.url))
const MANIFEST = JSON.parse(readFileSync(manifestPath, 'utf8')).effects as Array<{
  id: string
  params: Array<{ uniform: string; type: string; min?: number; max?: number }>
}>

/** The two catalog effects applyTasteToShader seeds, by slot index. */
const SHADER_SLOT_EFFECTS = ['post_grain', 'color_temperature']

const gradientKeys = new Set(GRADIENT_CONTROLS.map(c => c.key))

describe('TASTE_PARAM_MAPPINGS validity', () => {
  it('references only real facet ids, with sane gains', () => {
    for (const e of TASTE_PARAM_MAPPINGS) {
      expect(FACET_IDS, `facet ${e.facet} (${e.path})`).toContain(e.facet)
      expect(Math.abs(e.gain), `gain ${e.path}`).toBeGreaterThan(0)
      expect(Math.abs(e.gain)).toBeLessThanOrEqual(1)
    }
  })

  it('covers ~30 entries across all three studios', () => {
    expect(TASTE_PARAM_MAPPINGS.length).toBeGreaterThanOrEqual(28)
    for (const studio of ['gradient', 'shader', 'vectortype'] as const) {
      expect(TASTE_PARAM_MAPPINGS.filter(e => e.studio === studio).length).toBeGreaterThanOrEqual(6)
    }
  })

  it('every gradient entry resolves against GRADIENT_CONTROLS', () => {
    for (const e of TASTE_PARAM_MAPPINGS.filter(e => e.studio === 'gradient')) {
      if (e.path === 'layer.color.stops.*.color') continue // runtime-cardinality colour block; exercised in the apply test
      expect(gradientKeys.has(e.path), `gradient key missing from GRADIENT_CONTROLS: ${e.path}`).toBe(true)
      if (!e.palette) {
        const range = gradientRange(e.path)
        expect(range, `no slider range for ${e.path}`).not.toBeNull()
      }
    }
  })

  it('every shader effect-uniform entry matches shader_effects/manifest.json', () => {
    for (const e of TASTE_PARAM_MAPPINGS.filter(e => e.studio === 'shader')) {
      const m = /^effects\.(\d+)\.params\.(u_\w+)$/.exec(e.path)
      if (!m) continue
      const effectId = SHADER_SLOT_EFFECTS[Number(m[1])]
      expect(effectId, `unmapped effect slot in ${e.path}`).toBeDefined()
      const effect = MANIFEST.find(x => x.id === effectId)
      expect(effect, `effect ${effectId} not in manifest`).toBeDefined()
      const param = effect!.params.find(p => p.uniform === m[2])
      expect(param, `${effectId} has no uniform ${m[2]}`).toBeDefined()
      expect(e.min, `${e.path} below catalog min`).toBeGreaterThanOrEqual(param!.min!)
      expect(e.max, `${e.path} above catalog max`).toBeLessThanOrEqual(param!.max!)
    }
  })

  it('every doc-level shader path resolves on defaultConfig()', () => {
    const cfg = defaultConfig()
    for (const e of TASTE_PARAM_MAPPINGS.filter(e => e.studio === 'shader')) {
      if (/^effects\.\d+\./.test(e.path)) continue
      expect(getByPath(cfg, e.path), `shader path unresolved: ${e.path}`).toBeDefined()
    }
  })

  it('every vectortype path resolves on DEFAULT_CONFIG (axes against the font catalog)', () => {
    for (const e of TASTE_PARAM_MAPPINGS.filter(e => e.studio === 'vectortype')) {
      const axis = /^axes\.(\w+)$/.exec(e.path)
      if (axis) {
        // `axes` is sparse — the tag just has to exist somewhere in the catalog:
        // either a curated axis declaration or the TTF filename's bracket list.
        const tag = axis[1]!
        const known = VARIABLE_FONTS.some(f =>
          f.axes.some(a => a.tag === tag)
          || new RegExp(`\\[[^\\]]*\\b${tag}\\b[^\\]]*\\]`).test(f.ttfPath ?? ''))
        expect(known, `axis tag ${tag} unknown to the font catalog`).toBe(true)
        continue
      }
      expect(getByPath(DEFAULT_CONFIG, e.path), `vectortype path unresolved: ${e.path}`).toBeDefined()
    }
  })
})

describe('mappedValue / paletteSwatch', () => {
  it('maps facet extremes into the range with gain sign', () => {
    const e = { studio: 'shader' as const, path: 'x', facet: 'warmth' as const, gain: 1, min: -1, max: 1 }
    expect(mappedValue(e, 0)).toBe(-1)
    expect(mappedValue(e, 1)).toBe(1)
    expect(mappedValue(e, 0.5)).toBe(0)
    expect(mappedValue({ ...e, gain: -1 }, 1)).toBe(-1)
    expect(mappedValue({ ...e, gain: 0.5 }, 1)).toBe(0.5)
  })

  it('resolves palette roles', () => {
    const palette = ['#101020', '#f0e0d0', '#ff2040', '#808080']
    expect(paletteSwatch(palette, 'darkest')).toBe('#101020')
    expect(paletteSwatch(palette, 'lightest')).toBe('#f0e0d0')
    expect(paletteSwatch(palette, 'accent')).toBe('#ff2040')
    expect(paletteSwatch([], 'darkest')).toBeNull()
  })
})

/** A loud, confident reading — every facet far from centre. */
function strongReading(): TasteReading {
  const facets: TasteReading['facets'] = {}
  for (const id of FACET_IDS) facets[id] = { value: 0.9, confidence: 0.9 }
  facets.motion = { value: 0.5, confidence: 0 } // honest zero, must be skipped
  return { facets, avoids: [] }
}

const PALETTE = ['#0a0a1e', '#2b6d85', '#e8b04b', '#f5f0e8', '#c03040']

describe('applyTasteToConfig helpers', () => {
  it('gradient: mapped params move off the base, palette lands in stops + background', () => {
    const base = {
      canvas: { background: '#000000' },
      flow: { intensity: 0, noiseScale: 2, swirl: 0, detail: 2 },
      layers: [{ color: { stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#000000' }], steps: 0, hueDrift: 0 }, opacity: 1 }],
      focus: { blur: 0 },
      relief: { relief: 0 },
      post: { grain: false, grainAmount: 0, grainSize: 2, bloom: false, bloomStrength: 0.6, vignetteAmount: 0 },
    } as unknown as GradientConfig
    const out = applyTasteToGradient(strongReading(), PALETTE, base)

    expect(getByPath(out, 'flow.intensity')).not.toBe(getByPath(base, 'flow.intensity'))
    expect(getByPath(out, 'post.grainAmount')).toBeGreaterThan(0.5)
    expect(getByPath(out, 'post.grain')).toBe(true)
    expect(getByPath(out, 'post.bloom')).toBe(true)
    expect(getByPath(out, 'layers.0.color.steps')).not.toBe(0) // via layer.* key expansion
    // Palette injection: stops recoloured from the analyzed swatches.
    const stops = getByPath(out, 'layers.0.color.stops') as Array<{ color: string }>
    expect(PALETTE).toContain(stops[0]!.color)
    expect(PALETTE).toContain(getByPath(out, 'canvas.background'))
    // Base untouched.
    expect(getByPath(base, 'flow.intensity')).toBe(0)
    expect((getByPath(base, 'layers.0.color.stops') as Array<{ color: string }>)[0]!.color).toBe('#ffffff')
  })

  it('gradient: layer.* keys expand to layers.0.*', () => {
    expect(gradientConfigPath('layer.color.steps')).toBe('layers.0.color.steps')
    expect(gradientConfigPath('flow.swirl')).toBe('flow.swirl')
  })

  it('shader: seeds the two mapped effects and moves doc-level params', () => {
    const base = defaultConfig()
    const out = applyTasteToShader(strongReading(), PALETTE, base)

    expect(out.effects[0]!.id).toBe('post_grain')
    expect(out.effects[1]!.id).toBe('color_temperature')
    expect(out.effects[0]!.params.u_amount as number).toBeGreaterThan(0.5)
    expect(out.effects[1]!.params.u_temperature as number).toBeGreaterThan(0) // warm reading
    expect(out.adjust.enabled).toBe(true)
    expect(out.adjust.saturation).not.toBe(base.adjust.saturation)
    expect(out.post.bloom.enabled).toBe(true)
    expect(out.post.bloom.intensity).not.toBe(base.post.bloom.intensity)
    expect(out.duotone.ink).toBe('#0a0a1e')
    expect(out.duotone.paper).toBe('#f5f0e8')
    expect(out.duotone.enabled).toBe(false) // paletteBreadth 0.9 = polychrome, duotone stays off
    // Base untouched.
    expect(base.effects[0]!.id).toBe('')
  })

  it('shader: a narrow palette turns duotone on', () => {
    const reading = strongReading()
    reading.facets.paletteBreadth = { value: 0.1, confidence: 0.9 }
    const out = applyTasteToShader(reading, PALETTE, defaultConfig())
    expect(out.duotone.enabled).toBe(true)
  })

  it('vectortype: axes, metrics and ink move; low-confidence facets do not', () => {
    const out = applyTasteToVectorType(strongReading(), PALETTE, DEFAULT_CONFIG)

    expect(out.axes.wght).toBeGreaterThan(500) // contrast 0.9 → heavy
    expect(typeof out.axes.GRAD).toBe('number')
    expect(out.size).not.toBe(DEFAULT_CONFIG.size)
    expect(out.tracking).not.toBe(DEFAULT_CONFIG.tracking)
    expect(out.arc).toBeGreaterThan(0) // decorative reading
    expect(out.appearance[0]!.paint.a).toBe('#c03040') // accent = most saturated swatch
    // Base untouched (DEFAULT_CONFIG is a module constant — mutation would be a landmine).
    expect(DEFAULT_CONFIG.axes.wght).toBeUndefined()
    expect(DEFAULT_CONFIG.appearance[0]!.paint.a).toBe('#ffffff')
  })

  it('skips facets below the confidence floor entirely', () => {
    const reading: TasteReading = { facets: { density: { value: 0.9, confidence: 0.1 } }, avoids: [] }
    const out = applyTasteToVectorType(reading, [], DEFAULT_CONFIG)
    expect(out.size).toBe(DEFAULT_CONFIG.size)
    expect(out.tracking).toBe(DEFAULT_CONFIG.tracking)
  })
})

describe('enforcePaletteOnGradient coverage (run 5)', () => {
  const PAL = ['#14120f', '#22443a', '#c9873b', '#e8e0d0', '#5d7a5a']

  it('recolors mesh points and every layer\'s stops — a mesh preset\'s purples cannot survive', async () => {
    const { enforcePaletteOnGradient } = await import('../../app/lib/taste/mapping')
    const cfg = {
      canvas: { background: '#000000' },
      layers: [
        { color: { stops: [{ pos: 0, color: '#800080' }, { pos: 1, color: '#4b0082' }] } },
        { color: { stops: [{ pos: 0, color: '#9932cc' }] }, mesh: { points: [{ x: 0, y: 0, color: '#800080' }, { x: 1, y: 1, color: '#ba55d3' }] } },
      ],
    } as any
    enforcePaletteOnGradient(cfg, PAL, 0.8)
    const colors = [
      ...cfg.layers[0].color.stops.map((s: any) => s.color),
      ...cfg.layers[1].color.stops.map((s: any) => s.color),
      ...cfg.layers[1].mesh.points.map((p: any) => p.color),
    ]
    for (const c of colors) expect(PAL).toContain(c) // no purple survives anywhere
    expect(cfg.canvas.background).toBe('#e8e0d0') // bright board → lightest ground
  })

  it('broken control: enforcement limited to layers.0 stops would leave mesh purple', async () => {
    const { enforcePaletteOnGradient } = await import('../../app/lib/taste/mapping')
    const cfg = { canvas: {}, layers: [{ color: { stops: [] }, mesh: { points: [{ x: 0, y: 0, color: '#800080' }] } }] } as any
    enforcePaletteOnGradient(cfg, PAL, 0.8)
    expect(cfg.layers[0].mesh.points[0].color).not.toBe('#800080')
  })
})
