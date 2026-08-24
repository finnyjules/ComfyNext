import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ControlSpec } from '~/lib/spacetype/effect'
import {
  SCENE_PANEL_ANCHOR_KEYS, SCENE_PANEL_ORDER, SCENE_PANEL_SECTIONS, SCENE_TRANSFORM_SECTIONS,
  ENV_OPTIONS, readSceneControl, scenePanelChrome, scenePanelControls, scenePanelVisible,
} from '~/lib/scene3d/panelPresentation'
import { groupIntoSections } from '~/lib/studio/sections'
import { POST_SECTIONS } from '~/lib/studio/post/controls'
import { SCENE_CONTROLS } from '~/lib/scene3d/controls'
import {
  createDecal, createGlbObject, createLight, createPrimitive, defaultDoc,
  LIGHTING_PRESETS, MATERIAL_TYPES,
  type MaterialType, type SceneDoc, type SceneObject,
} from '~/lib/scene3d/config'

/**
 * CHARACTERIZATION of the 3D Studio inspector's Transform / Material / Camera / Lighting /
 * Background sections, transcribed from the hand-written template that drew them
 * (Scene3DStudioSurface.vue, lines 3713-3771 / 3971-4353 / 4430-4462 as of 64492f314),
 * NOT from `SCENE_CONTROLS`. Where the two disagreed the template won and the schema or the
 * presentation remap was reconciled to it.
 *
 * Geometry, Light, Decal, sculpt/merge and the object-motion sections stay hand-written and
 * are out of scope; they are asserted here only by their ABSENCE from the panel.
 *
 * Deliberate, recorded divergences from the shipped markup:
 *   - Every migrated control is now a 28px StudioRow. A `StudioSegmented` pill row and a
 *     native `<select>` both become an inline dropdown; the three unbounded `<input
 *     type="number">` transform grids become sliders, so they now CLAMP to the schema's
 *     declared ranges where the number inputs did not. Ranges below are the schema's.
 *   - The five `<details>` sub-blocks inside the Material card become nested StudioSections
 *     (same collapsed-by-default behaviour, StudioSection chrome instead of a bare summary).
 *   - `Surface relief` was a plain caption, not a collapsible; it is a nested card now.
 */

// ── the shipped rows, one literal table ──────────────────────────────────────

type Row = {
  label: string
  kind: ControlSpec['kind']
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
  hint?: string
}

const M = 'object.material.'

const ROW: Record<string, Row> = {
  // Transform — three 3-column grids of `<input type="number">`, aria-labelled per axis.
  // Rotation was ALWAYS edited in degrees (rotField's RAD2DEG proxy) though the doc stores
  // radians; Size was ALWAYS `scale × baseSize` (sizeAxis), not the raw multiplier.
  'object.position.0': { label: 'Position X', kind: 'slider', min: -20, max: 20, step: 0.1 },
  'object.position.1': { label: 'Position Y', kind: 'slider', min: -20, max: 20, step: 0.1 },
  'object.position.2': { label: 'Position Z', kind: 'slider', min: -20, max: 20, step: 0.1 },
  'object.rotation.0': { label: 'Rotation X', kind: 'slider', min: -180, max: 180, step: 1 },
  'object.rotation.1': { label: 'Rotation Y', kind: 'slider', min: -180, max: 180, step: 1 },
  'object.rotation.2': { label: 'Rotation Z', kind: 'slider', min: -180, max: 180, step: 1 },
  'object.scale.0': { label: 'Size X', kind: 'slider', min: 0.05, max: 10, step: 0.05 },
  'object.scale.1': { label: 'Size Y', kind: 'slider', min: 0.05, max: 10, step: 0.05 },
  'object.scale.2': { label: 'Size Z', kind: 'slider', min: 0.05, max: 10, step: 0.05 },

  // Material — shared head
  [`${M}type`]: { label: 'Material', kind: 'select', options: MATERIAL_TYPES },

  // standard + glass "Surface" block
  [`${M}color`]: { label: 'Color', kind: 'color' },
  [`${M}roughness`]: { label: 'Roughness', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'How matte or glossy the surface is' },
  [`${M}metalness`]: { label: 'Metalness', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Blends between plastic-like and metal reflections' },

  // <details> Coat & sheen
  [`${M}clearcoat`]: { label: 'Clearcoat', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Adds a thin glossy varnish layer on top' },
  [`${M}clearcoatRoughness`]: { label: 'Coat roughness', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'How blurred or sharp that varnish coat looks' },
  [`${M}sheen`]: { label: 'Sheen', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Soft fabric-like edge highlight' },
  [`${M}sheenColor`]: { label: 'Sheen colour', kind: 'color' },

  // <details> Glow
  [`${M}emissive`]: { label: 'Emissive', kind: 'color' },
  [`${M}emissiveIntensity`]: { label: 'Intensity', kind: 'slider', min: 0, max: 5, step: 0.05, hint: 'How brightly the material glows on its own' },

  // <details> Transparency
  [`${M}opacity`]: { label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'How see-through the whole surface is' },
  [`${M}transmission`]: { label: 'Transmission', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Lets light pass through, like glass' },
  [`${M}ior`]: { label: 'IOR', kind: 'slider', min: 1, max: 2.33, step: 0.01, hint: 'How strongly light bends passing through' },
  [`${M}thickness`]: { label: 'Thickness', kind: 'slider', min: 0, max: 2, step: 0.05, hint: 'How solid the glass feels as light travels in' },
  [`${M}dispersion`]: { label: 'Dispersion', kind: 'slider', min: 0, max: 5, step: 0.05, hint: 'Splits refracted light into rainbow fringes' },
  [`${M}attenuationColor`]: { label: 'Attenuation', kind: 'color' },
  [`${M}attenuationDistance`]: { label: 'Attenuation dist', kind: 'slider', min: 0, max: 10, step: 0.1, hint: 'How deep light travels before tinting (0 = off)' },

  // <details> Iridescence / Reflection — captioned by their block, not by the parameter
  [`${M}iridescence`]: { label: 'Amount', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Strength of the soap-bubble colour shift' },
  [`${M}iridescenceIOR`]: { label: 'IOR', kind: 'slider', min: 1, max: 2.33, step: 0.01, hint: 'Tunes which colours the bubble film shifts to' },
  [`${M}envMapIntensity`]: { label: 'Intensity', kind: 'slider', min: 0, max: 3, step: 0.05, hint: 'How strongly reflections from the surroundings show' },

  // phong / toon / fresnel
  [`${M}shininess`]: { label: 'Shininess', kind: 'slider', min: 0, max: 200, step: 1, hint: 'How tight and glossy the highlight is — higher is sharper' },
  [`${M}specular`]: { label: 'Specular', kind: 'color' },
  [`${M}toonSteps`]: { label: 'Steps', kind: 'slider', min: 2, max: 5, step: 1, hint: 'Number of flat cel-shading bands' },
  [`${M}fresnelColor`]: { label: 'Rim colour', kind: 'color' },
  [`${M}fresnelPower`]: { label: 'Power', kind: 'slider', min: 1, max: 8, step: 0.1, hint: 'How tightly the rim glow hugs the edges' },

  // gradient
  [`${M}paletteMode`]: { label: 'Palette', kind: 'select', options: ['manual', 'harmony'] },
  [`${M}paletteHue`]: { label: 'Hue', kind: 'slider', min: 0, max: 360, step: 1, hint: 'Seed hue the harmony scheme is built from' },
  [`${M}paletteSat`]: { label: 'Saturation', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'How vivid the generated colours are' },
  [`${M}paletteLight`]: { label: 'Lightness', kind: 'slider', min: 0.2, max: 0.9, step: 0.01, hint: 'How light or dark the generated colours are' },
  [`${M}gradientType`]: { label: 'Type', kind: 'select', options: ['linear', 'radial'] },
  [`${M}gradientYaw`]: { label: 'Yaw', kind: 'slider', min: 0, max: 360, step: 1, hint: 'Ramp direction around the Y axis' },
  [`${M}gradientPitch`]: { label: 'Pitch', kind: 'slider', min: -90, max: 90, step: 1, hint: 'Ramp direction elevation, up or down' },
  [`${M}gradientOffset`]: { label: 'Offset', kind: 'slider', min: -1, max: 1, step: 0.01, hint: 'Slides the ramp along its direction' },
  [`${M}gradientSpread`]: { label: 'Spread', kind: 'slider', min: 0.1, max: 3, step: 0.01, hint: 'Compresses (<1) or stretches (>1) the ramp' },
  [`${M}gradientShading`]: { label: 'Shading', kind: 'select', options: ['smooth', 'faceted', 'prismatic', 'scatter', 'ombre'] },

  // opalescent
  [`${M}opalHueShift`]: { label: 'Hue shift', kind: 'slider', min: 0, max: 360, step: 1, hint: 'Rotates the whole rainbow around the colour wheel' },
  [`${M}opalFrequency`]: { label: 'Spectrum bands', kind: 'slider', min: 0.5, max: 5, step: 0.05, hint: 'How many rainbow bands wrap the surface' },
  [`${M}opalAngleMix`]: { label: 'Angle response', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'Blends the flow from surface-shape-driven to viewing-angle-driven' },
  [`${M}opalStrength`]: { label: 'Rainbow strength', kind: 'slider', min: 0, max: 1, step: 0.01, hint: 'How much rainbow shows over the base colour' },
  [`${M}opalFlowSpeed`]: { label: 'Flow speed', kind: 'slider', min: 0, max: 2, step: 0.01, hint: 'Animates the spectrum over time — 0 keeps it still' },

  // shaderFill
  [`${M}unlit`]: { label: 'Unlit', kind: 'switch', hint: 'Glows flat instead of being shaded by scene lights' },

  // Surface relief — the source picker was a three-button grid with NO tooltip
  [`${M}relief.source`]: { label: 'Relief', kind: 'select', options: ['none', 'shader', 'image'] },
  [`${M}relief.scale`]: { label: 'Depth', kind: 'slider', min: 0, max: 4, step: 0.01, hint: 'How raised or recessed the surface detail looks' },
  [`${M}relief.contrast`]: { label: 'Contrast', kind: 'slider', min: 1, max: 6, step: 0.1, hint: 'Deepens the light and dark areas so the relief catches the light.' },
  [`${M}relief.tiling`]: { label: 'Tiling', kind: 'slider', min: 0.25, max: 12, step: 0.25, hint: 'How many times the pattern repeats across the surface — higher is finer.' },
  [`${M}relief.invert`]: { label: 'Invert', kind: 'switch' },

  // Camera / Lighting / Background
  'camera.fov': { label: 'FOV', kind: 'slider', min: 15, max: 100, step: 1, hint: 'Camera field of view — how wide the lens sees' },
  'lighting.preset': { label: 'Preset', kind: 'select', options: LIGHTING_PRESETS },
  'lighting.environment': { label: 'Environment', kind: 'select', options: ENV_OPTIONS },
  'lighting.sunAzimuth': { label: 'Sun azimuth', kind: 'slider', min: 0, max: 360, step: 1, hint: 'Compass direction the sunlight comes from' },
  'lighting.sunElevation': { label: 'Sun elevation', kind: 'slider', min: 5, max: 90, step: 1, hint: 'How high the sun sits above the horizon' },
  'lighting.sunIntensity': { label: 'Sun intensity', kind: 'slider', min: 0, max: 3, step: 0.05, hint: 'How bright the main sunlight is' },
  'lighting.ambient': { label: 'Ambient', kind: 'slider', min: 0, max: 2, step: 0.05, hint: 'Soft fill light that lifts the shadows' },
  showFloor: { label: 'Floor', kind: 'switch' },
}

/** The opalescent branch re-captioned three rows and re-worded two hints — it explains what
 *  each knob does to a RAINBOW, not to a PBR surface. */
const OPAL_ROW: Record<string, Row> = {
  [`${M}color`]: { label: 'Base tint', kind: 'color' },
  [`${M}metalness`]: { ...ROW[`${M}metalness`]!, hint: 'Blends between plastic-like and metal reflections — high turns the rainbow into chrome' },
  [`${M}clearcoat`]: { ...ROW[`${M}clearcoat`]!, hint: 'Adds a thin glossy varnish layer on top — the wet look' },
  [`${M}envMapIntensity`]: { ...ROW[`${M}envMapIntensity`]!, label: 'Reflection intensity' },
}

/** Bespoke blocks — the rows that are a widget, not a parameter. Each is an anchor with a
 *  `#control-<key>` slot in the surface; they carry no value and never bind. */
const ANCHOR_LABEL: Record<string, string> = {
  'ui.material.override': 'Override materials',
  'ui.material.surface': 'Surface',
  'ui.material.matcap': 'Matcap',
  'ui.material.harmony': 'Harmony',
  'ui.material.gradientStops': 'Colours',
  'ui.material.gradientDirection': 'Direction',
  'ui.material.opalStops': 'Spectrum',
  'ui.material.image': 'Texture',
  'ui.material.shader': 'Effect',
  'ui.material.prism': 'Prism look',
  'ui.relief.unavailable': 'Relief unavailable',
  'ui.relief.normalMapBound': 'Normal map bound',
  'ui.relief.image': 'Relief image',
  'ui.relief.shader': 'Relief effect',
  'ui.camera.output': 'Output',
  'ui.background.transparent': 'Transparent',
  'ui.background.color': 'Color',
}

// ── scenarios ────────────────────────────────────────────────────────────────

const prim = (type: MaterialType): SceneObject => {
  const o = createPrimitive('box', [])
  o.material.type = type
  return o
}

const RELIEF_OFF = [`${M}relief.source`]

/** Every card the shipped inspector drew, in order, for a primitive of each material type —
 *  including the shared head (`Override materials` never shows for a primitive) and the
 *  always-present Surface relief card. */
const MATERIAL_SCENARIO: Record<MaterialType, Record<string, readonly string[]>> = {
  standard: {
    Material: [`${M}type`, 'ui.material.surface', `${M}color`, `${M}roughness`, `${M}metalness`],
    'Coat & sheen': [`${M}clearcoat`, `${M}clearcoatRoughness`, `${M}sheen`, `${M}sheenColor`],
    Glow: [`${M}emissive`, `${M}emissiveIntensity`],
    Transparency: ['ui.material.prism', `${M}opacity`, `${M}transmission`, `${M}ior`, `${M}thickness`, `${M}dispersion`, `${M}attenuationColor`, `${M}attenuationDistance`],
    Iridescence: [`${M}iridescence`, `${M}iridescenceIOR`],
    Reflection: [`${M}envMapIntensity`],
    'Surface relief': RELIEF_OFF,
  },
  glass: {
    Material: [`${M}type`, 'ui.material.surface', `${M}color`, `${M}roughness`, `${M}metalness`],
    'Coat & sheen': [`${M}clearcoat`, `${M}clearcoatRoughness`, `${M}sheen`, `${M}sheenColor`],
    Glow: [`${M}emissive`, `${M}emissiveIntensity`],
    Transparency: ['ui.material.prism', `${M}opacity`, `${M}transmission`, `${M}ior`, `${M}thickness`, `${M}dispersion`, `${M}attenuationColor`, `${M}attenuationDistance`],
    Iridescence: [`${M}iridescence`, `${M}iridescenceIOR`],
    Reflection: [`${M}envMapIntensity`],
    'Surface relief': RELIEF_OFF,
  },
  phong: {
    Material: [`${M}type`, `${M}color`, `${M}shininess`, `${M}specular`],
    'Surface relief': RELIEF_OFF,
  },
  toon: {
    Material: [`${M}type`, `${M}color`, `${M}toonSteps`],
    'Surface relief': RELIEF_OFF,
  },
  matcap: {
    Material: [`${M}type`, 'ui.material.matcap'],
    'Surface relief': RELIEF_OFF,
  },
  fresnel: {
    Material: [`${M}type`, `${M}color`, `${M}fresnelColor`, `${M}fresnelPower`],
    'Surface relief': RELIEF_OFF,
  },
  // Manual palette (the default) shows the ramp editor; linear (the default) shows the
  // axis-preset grid + Yaw/Pitch. Both branches get their own scenario below.
  gradient: {
    Material: [
      `${M}type`, `${M}paletteMode`, 'ui.material.gradientStops', `${M}gradientType`,
      'ui.material.gradientDirection', `${M}gradientYaw`, `${M}gradientPitch`,
      `${M}gradientOffset`, `${M}gradientSpread`, `${M}gradientShading`,
    ],
    'Surface relief': RELIEF_OFF,
  },
  opalescent: {
    Material: [
      `${M}type`, 'ui.material.opalStops', `${M}color`,
      `${M}opalHueShift`, `${M}opalFrequency`, `${M}opalAngleMix`, `${M}opalStrength`, `${M}opalFlowSpeed`,
      `${M}roughness`, `${M}metalness`, `${M}clearcoat`, `${M}clearcoatRoughness`, `${M}envMapIntensity`,
    ],
    'Surface relief': RELIEF_OFF,
  },
  image: {
    Material: [`${M}type`, 'ui.material.image', `${M}roughness`, `${M}metalness`],
    'Surface relief': RELIEF_OFF,
  },
  shaderFill: {
    Material: [`${M}type`, 'ui.material.shader', `${M}unlit`, `${M}roughness`, `${M}metalness`],
    'Surface relief': RELIEF_OFF,
  },
}

const DOC_SCENARIO: Record<string, readonly string[]> = {
  Camera: ['camera.fov', 'ui.camera.output'],
  Lighting: ['lighting.preset', 'lighting.environment', 'lighting.sunAzimuth', 'lighting.sunElevation', 'lighting.sunIntensity', 'lighting.ambient'],
  Background: ['showFloor', 'ui.background.transparent', 'ui.background.color'],
}

const TRANSFORM_ROWS = [
  'object.position.0', 'object.position.1', 'object.position.2',
  'object.rotation.0', 'object.rotation.1', 'object.rotation.2',
  'object.scale.0', 'object.scale.1', 'object.scale.2',
]

// ── helpers ──────────────────────────────────────────────────────────────────

const panel = (doc: SceneDoc, obj: SceneObject | null) => scenePanelControls(doc, obj)

/** What the panel actually renders: card titles + row keys per card, through the SAME
 *  grouping StudioControlPanel uses (so a nesting-path typo fails here, not on screen). */
function rendered(doc: SceneDoc, obj: SceneObject | null, order: readonly string[]) {
  const flat: Array<{ title: string; keys: string[] }> = []
  const walk = (nodes: ReturnType<typeof groupIntoSections<ControlSpec>>) => {
    for (const n of nodes) {
      flat.push({ title: n.title, keys: n.controls.map((c) => c.key) })
      walk(n.sections)
    }
  }
  walk(groupIntoSections(panel(doc, obj), order))
  return flat
}

const designCards = (doc: SceneDoc, obj: SceneObject | null) =>
  rendered(doc, obj, SCENE_PANEL_ORDER)

const byKey = (doc: SceneDoc, obj: SceneObject | null) =>
  new Map(panel(doc, obj).map((c) => [c.key, c]))

function expectRow(c: ControlSpec | undefined, key: string, want: Row) {
  expect(c, key).toBeTruthy()
  expect(c!.kind, `${key} kind`).toBe(want.kind)
  expect(c!.label, `${key} label`).toBe(want.label)
  if (want.min !== undefined) expect((c as { min: number }).min, `${key} min`).toBeCloseTo(want.min, 10)
  if (want.max !== undefined) expect((c as { max: number }).max, `${key} max`).toBeCloseTo(want.max, 10)
  if (want.step !== undefined) expect((c as { step: number }).step, `${key} step`).toBeCloseTo(want.step, 10)
  if (want.options) expect((c as { options: string[] }).options, `${key} options`).toEqual([...want.options])
  expect(c!.hint ?? null, `${key} hint`).toBe(want.hint ?? null)
}

// ── the assertions ───────────────────────────────────────────────────────────

describe('Scene3D panel parity — Material, per material type', () => {
  for (const type of MATERIAL_TYPES) {
    const want = MATERIAL_SCENARIO[type]

    it(`${type}: draws the shipped cards in the shipped order`, () => {
      const doc = defaultDoc()
      const cards = designCards(doc, prim(type)).map((s) => s.title)
      expect(cards).toEqual([...Object.keys(want), ...Object.keys(DOC_SCENARIO)])
    })

    it(`${type}: each card holds the shipped rows, in order`, () => {
      const doc = defaultDoc()
      const got = new Map(designCards(doc, prim(type)).map((s) => [s.title, s.keys]))
      for (const [title, keys] of Object.entries(want)) expect(got.get(title), title).toEqual([...keys])
    })

    it(`${type}: every row carries the shipped label, bounds and tooltip`, () => {
      const doc = defaultDoc()
      const rows = byKey(doc, prim(type))
      for (const keys of Object.values(want)) {
        for (const key of keys) {
          if (SCENE_PANEL_ANCHOR_KEYS.has(key)) {
            expect(rows.get(key)!.label, key).toBe(ANCHOR_LABEL[key])
            continue
          }
          const spec = (type === 'opalescent' ? OPAL_ROW[key] : undefined) ?? ROW[key]
          expect(spec, `${key} is transcribed in ROW`).toBeTruthy()
          expectRow(rows.get(key), key, spec!)
        }
      }
    })
  }

  it('the gradient harmony branch swaps the ramp editor for the three harmony dials', () => {
    const doc = defaultDoc()
    const o = prim('gradient')
    o.material.paletteMode = 'harmony'
    const rows = designCards(doc, o).find((s) => s.title === 'Material')!.keys
    expect(rows).toEqual([
      `${M}type`, `${M}paletteMode`,
      `${M}paletteHue`, `${M}paletteSat`, `${M}paletteLight`, 'ui.material.harmony',
      `${M}gradientType`, 'ui.material.gradientDirection', `${M}gradientYaw`, `${M}gradientPitch`,
      `${M}gradientOffset`, `${M}gradientSpread`, `${M}gradientShading`,
    ])
    expect(rows).not.toContain('ui.material.gradientStops')
  })

  it('a radial gradient drops the direction grid and both angle rows', () => {
    const doc = defaultDoc()
    const o = prim('gradient')
    o.material.gradientType = 'radial'
    const rows = designCards(doc, o).find((s) => s.title === 'Material')!.keys
    expect(rows).not.toContain('ui.material.gradientDirection')
    expect(rows).not.toContain(`${M}gradientYaw`)
    expect(rows).not.toContain(`${M}gradientPitch`)
    expect(rows).toContain(`${M}gradientOffset`)
  })

  it('a GLB never offers faceted shading — only primitive geometry bakes the extents', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('x.glb', [])
    glb.materialOverride = true
    glb.material.type = 'gradient'
    const rows = designCards(doc, glb).find((s) => s.title === 'Material')!.keys
    expect(rows).not.toContain(`${M}gradientShading`)
    expect(rows).toContain(`${M}gradientSpread`)
  })

  it('an unlit shaderFill hides Roughness/Metalness and replaces the relief card with its notice', () => {
    const doc = defaultDoc()
    const o = prim('shaderFill')
    o.material.unlit = true
    const cards = designCards(doc, o)
    const mat = cards.find((s) => s.title === 'Material')!.keys
    expect(mat).toEqual([`${M}type`, 'ui.material.shader', `${M}unlit`])
    expect(cards.find((s) => s.title === 'Surface relief')!.keys).toEqual(['ui.relief.unavailable'])
  })
})

describe('Scene3D panel parity — Surface relief', () => {
  const doc = () => defaultDoc()

  it('a picked effect source reveals the four dials and the effect editor', () => {
    const o = prim('standard')
    o.material.relief = { source: 'shader', scale: 0.25 }
    const keys = designCards(doc(), o).find((s) => s.title === 'Surface relief')!.keys
    expect(keys).toEqual([
      `${M}relief.source`, `${M}relief.scale`, `${M}relief.contrast`, `${M}relief.tiling`,
      `${M}relief.invert`, 'ui.relief.shader',
    ])
  })

  it('a picked image source reveals the upload block instead', () => {
    const o = prim('standard')
    o.material.relief = { source: 'image', scale: 0.25, image: 'height.png' }
    const keys = designCards(doc(), o).find((s) => s.title === 'Surface relief')!.keys
    expect(keys).toEqual([
      `${M}relief.source`, `${M}relief.scale`, `${M}relief.contrast`, `${M}relief.tiling`,
      `${M}relief.invert`, 'ui.relief.image',
    ])
  })

  it('an image that IS a normal map hides the height dials but keeps the upload block', () => {
    const o = prim('standard')
    o.material.relief = { source: 'image', scale: 0.25 }
    o.material.normalImage = 'normal.png'
    const keys = designCards(doc(), o).find((s) => s.title === 'Surface relief')!.keys
    expect(keys).toEqual([`${M}relief.source`, 'ui.relief.normalMapBound', 'ui.relief.image'])
  })

  it('the normal-map banner shows whatever the relief source is — normalImage is independent', () => {
    const o = prim('standard')
    o.material.normalImage = 'normal.png'
    const keys = designCards(doc(), o).find((s) => s.title === 'Surface relief')!.keys
    expect(keys).toEqual([`${M}relief.source`, 'ui.relief.normalMapBound'])
  })
})

describe('Scene3D panel parity — selection states', () => {
  it('a GLB with the override OFF shows only the override banner', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('x.glb', [])
    const cards = designCards(doc, glb)
    expect(cards.find((s) => s.title === 'Material')!.keys).toEqual(['ui.material.override'])
    expect(cards.map((s) => s.title)).toEqual(['Material', ...Object.keys(DOC_SCENARIO)])
  })

  it('a GLB with the override ON shows the whole standard branch, banner first', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('x.glb', [])
    glb.materialOverride = true
    const cards = designCards(doc, glb)
    expect(cards.find((s) => s.title === 'Material')!.keys).toEqual([
      'ui.material.override', `${M}type`, 'ui.material.surface', `${M}color`, `${M}roughness`, `${M}metalness`,
    ])
    expect(cards.map((s) => s.title)).toEqual([
      ...Object.keys(MATERIAL_SCENARIO.standard), ...Object.keys(DOC_SCENARIO),
    ])
  })

  it('a selected light draws no migrated Material card at all', () => {
    const doc = defaultDoc()
    const cards = designCards(doc, createLight('point', []))
    expect(cards.map((s) => s.title)).toEqual(Object.keys(DOC_SCENARIO))
    expect(panel(doc, createLight('point', [])).some((c) => c.key.startsWith(M))).toBe(false)
  })

  it('a selected decal draws no migrated Material card either', () => {
    const doc = defaultDoc()
    const cards = designCards(doc, createDecal('img', { type: 'image', image: 'a.png' }, [0, 0, 0], [0, 0, 0], []))
    expect(cards.map((s) => s.title)).toEqual(Object.keys(DOC_SCENARIO))
  })

  it('with nothing selected only the three doc cards render', () => {
    const doc = defaultDoc()
    const cards = designCards(doc, null)
    expect(cards.map((s) => s.title)).toEqual(Object.keys(DOC_SCENARIO))
    for (const [title, keys] of Object.entries(DOC_SCENARIO)) {
      expect(cards.find((s) => s.title === title)!.keys, title).toEqual([...keys])
    }
    expect(panel(doc, null).some((c) => c.key.startsWith('object.'))).toBe(false)
  })
})

describe('Scene3D panel parity — Transform', () => {
  it('draws nine axis rows for a primitive, in Position/Rotation/Size order', () => {
    const doc = defaultDoc()
    const cards = rendered(doc, prim('standard'), SCENE_TRANSFORM_SECTIONS)
    expect(cards.map((s) => s.title)).toEqual(['Transform'])
    expect(cards[0]!.keys).toEqual(TRANSFORM_ROWS)
  })

  it('every axis row carries its shipped label, step and range', () => {
    const doc = defaultDoc()
    const rows = byKey(doc, prim('standard'))
    for (const key of TRANSFORM_ROWS) expectRow(rows.get(key), key, ROW[key]!)
  })

  it('withholds the Size rows from a light and from a decal — the engine ignores their scale', () => {
    const doc = defaultDoc()
    const light = rendered(doc, createLight('point', []), SCENE_TRANSFORM_SECTIONS)[0]!.keys
    const decal = rendered(doc, createDecal('img', { type: 'image', image: 'a.png' }, [0, 0, 0], [0, 0, 0], []), SCENE_TRANSFORM_SECTIONS)[0]!.keys
    expect(light).toEqual(TRANSFORM_ROWS.slice(0, 6))
    expect(decal).toEqual(TRANSFORM_ROWS.slice(0, 6))
  })

  it('draws no Transform card with nothing selected', () => {
    expect(rendered(defaultDoc(), null, SCENE_TRANSFORM_SECTIONS)).toEqual([])
  })

  it('Size bounds and value follow the measured base extent, not the raw multiplier', () => {
    const doc = defaultDoc()
    const o = prim('standard')
    o.scale = [2, 1, 1]
    const rows = new Map(scenePanelControls(doc, o, { baseSize: [1.5, 1, 1] }).map((c) => [c.key, c]))
    const x = rows.get('object.scale.0') as unknown as { min: number; max: number; label: string }
    expect(x.label).toBe('Size X')
    expect(x.min).toBeCloseTo(0.075, 10)
    expect(x.max).toBeCloseTo(15, 10)
    expect(readSceneControl(doc, o, 'object.scale.0', { baseSize: [1.5, 1, 1] })).toBe(3)
  })
})

describe('Scene3D panel parity — reading values', () => {
  it('rotation reads in degrees though the document stores radians', () => {
    const doc = defaultDoc()
    const o = prim('standard')
    o.rotation = [Math.PI / 2, 0, -Math.PI]
    expect(readSceneControl(doc, o, 'object.rotation.0')).toBeCloseTo(90, 10)
    expect(readSceneControl(doc, o, 'object.rotation.2')).toBeCloseTo(-180, 10)
  })

  it('an untouched material reads its default rather than undefined', () => {
    const doc = defaultDoc()
    const o = prim('standard')
    expect(readSceneControl(doc, o, `${M}color`)).toBe('#9aa3af')
    expect(readSceneControl(doc, o, `${M}roughness`)).toBe(0.6)
    expect(readSceneControl(doc, o, `${M}metalness`)).toBe(0)
    expect(readSceneControl(doc, o, `${M}ior`)).toBe(1.5)
    expect(readSceneControl(doc, o, `${M}relief.source`)).toBe('none')
    expect(readSceneControl(doc, o, `${M}relief.contrast`)).toBe(1)
    expect(readSceneControl(doc, o, `${M}relief.invert`)).toBe(false)
  })

  it('the ramp angles read through gradientAngles, so a legacy gradientAxis still shows', () => {
    const doc = defaultDoc()
    const o = prim('gradient')
    o.material.gradientAxis = 'x'
    expect(readSceneControl(doc, o, `${M}gradientYaw`)).toBe(90)
    expect(readSceneControl(doc, o, `${M}gradientPitch`)).toBe(0)
  })

  it('the Environment row reads and offers the SHORT labels the segmented control used', () => {
    const doc = defaultDoc()
    doc.lighting.environment = 'darkStrips'
    expect(readSceneControl(doc, null, 'lighting.environment')).toBe('dark')
    const row = byKey(doc, null).get('lighting.environment') as unknown as { options: string[] }
    expect(row.options).toEqual(['room', 'dark', 'softbox', 'gels'])
  })

  it('reads the doc-level rows straight off the document', () => {
    const doc = defaultDoc()
    doc.camera.fov = 42
    doc.showFloor = false
    doc.lighting.ambient = 1.25
    expect(readSceneControl(doc, null, 'camera.fov')).toBe(42)
    expect(readSceneControl(doc, null, 'showFloor')).toBe(false)
    expect(readSceneControl(doc, null, 'lighting.ambient')).toBe(1.25)
  })

  it('the background colour row disappears while the background is transparent', () => {
    const doc = defaultDoc()
    doc.background = 'transparent'
    const keys = designCards(doc, null).find((s) => s.title === 'Background')!.keys
    expect(keys).toEqual(['showFloor', 'ui.background.transparent'])
  })
})

describe('Scene3D panel contract', () => {
  it('offers no Collection binding on any migrated row — the shipped controls had none', () => {
    const doc = defaultDoc()
    for (const type of MATERIAL_TYPES) {
      for (const c of panel(doc, prim(type))) {
        if (POST_SECTIONS.includes(String(c.group))) continue
        expect(c.bindable, `${c.key} bindable`).toBe(false)
      }
    }
  })

  it('builds every bespoke-block anchor as an inert, non-bindable text row', () => {
    const doc = defaultDoc()
    const seen = new Set<string>()
    for (const type of MATERIAL_TYPES) {
      for (const c of panel(doc, prim(type))) {
        if (!SCENE_PANEL_ANCHOR_KEYS.has(c.key)) continue
        seen.add(c.key)
        expect(c.kind, c.key).toBe('text')
        expect(c.bindable, c.key).toBe(false)
        expect((c as { default: string }).default, c.key).toBe('')
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('every anchor key is transcribed here, and every transcribed anchor exists', () => {
    expect([...SCENE_PANEL_ANCHOR_KEYS].sort()).toEqual(Object.keys(ANCHOR_LABEL).sort())
  })

  it('every card the remap emits is listed in the panel order — nothing is silently dropped', () => {
    const doc = defaultDoc()
    const allowed = new Set([...SCENE_PANEL_ORDER, ...SCENE_TRANSFORM_SECTIONS, ...POST_SECTIONS])
    for (const type of MATERIAL_TYPES) {
      for (const c of panel(doc, prim(type))) expect(allowed.has(String(c.group)), c.key).toBe(true)
    }
  })

  it('evaluates showIf against the ACTIVE object, so Unlit withholds Roughness', () => {
    const doc = defaultDoc()
    const lit = prim('shaderFill')
    const unlit = prim('shaderFill')
    unlit.material.unlit = true
    const roughness = SCENE_CONTROLS.find((c) => c.key === `${M}roughness`)!
    expect(roughness.showIf, 'the Task 4 gate is the thing under test').toBeTruthy()
    expect(scenePanelVisible(roughness, doc, lit)).toBe(true)
    expect(scenePanelVisible(roughness, doc, unlit)).toBe(false)
    // `unlit` is absent, not false, on every other type — the row must survive that.
    expect(scenePanelVisible(roughness, doc, prim('standard'))).toBe(true)
    // …and no object at all means no object row, whatever the schema's `when` says.
    expect(scenePanelVisible(roughness, doc, null)).toBe(false)
  })

  it('the panel order is the design cards plus the shared post stack, in that order', () => {
    expect(SCENE_PANEL_SECTIONS).toEqual([...SCENE_PANEL_ORDER, ...POST_SECTIONS])
    expect(SCENE_TRANSFORM_SECTIONS).toEqual(['Transform'])
  })

  it('the four bare <details> sub-blocks stay collapsed, and Transparency opens for glass', () => {
    expect(scenePanelChrome('standard')).toEqual({
      'Coat & sheen': { open: false }, Glow: { open: false },
      Transparency: { open: false }, Iridescence: { open: false }, Reflection: { open: false },
    })
    expect(scenePanelChrome('glass').Transparency).toEqual({ open: true })
  })

  it('no chrome key collides with a post card title — chrome is keyed by title alone', () => {
    // StudioSectionTree looks the chrome map up by the section's rendered title (the last
    // path segment), so a shared title would leak a Material sub-block's collapsed default
    // onto a post effect's card.
    const last = (path: string) => path.split('/').pop()!
    const postTitles = new Set(POST_SECTIONS.map(last))
    for (const key of Object.keys(scenePanelChrome('standard'))) {
      expect(postTitles.has(key), key).toBe(false)
    }
  })

  it('post rows pass through untouched, with their own Effects groups', () => {
    const doc = defaultDoc()
    const post = scenePanelControls(doc, prim('standard')).filter((c) => c.key.startsWith('post.'))
    expect(post.length).toBeGreaterThan(0)
    for (const c of post) expect(POST_SECTIONS.includes(String(c.group)), c.key).toBe(true)
  })
})
describe('Scene3D surface wiring', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../app/components/vue-canvas/Scene3DStudioSurface.vue', import.meta.url)),
    'utf-8',
  )

  it('supplies a slot for every bespoke-block anchor', () => {
    for (const key of SCENE_PANEL_ANCHOR_KEYS) {
      expect(src, key).toContain(`#control-${key}`)
    }
  })

  it('keeps the heavy-geometry deferral by wrapping the panels in a capture listener', () => {
    expect(src).toContain('@pointerdown.capture="onControlsPointerDown"')
  })

  it('no longer hand-writes the migrated sections', () => {
    for (const title of ['Transform', 'Material', 'Camera', 'Lighting', 'Background']) {
      expect(src, title).not.toContain(`<StudioSection title="${title}"`)
      expect(src, title).not.toContain(`title="${title}" @pointerdown`)
    }
    // The sections that stay hand-written must still be here.
    expect(src).toContain('title="Geometry"')
    expect(src).toContain('title="Light"')
    expect(src).toContain('title="Decal"')
  })
})
