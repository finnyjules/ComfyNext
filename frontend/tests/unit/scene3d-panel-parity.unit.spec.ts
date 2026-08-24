import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ControlSpec } from '~/lib/spacetype/effect'
import {
  SCENE_PANEL_ANCHOR_KEYS, SCENE_PANEL_ORDER, SCENE_PANEL_SECTIONS,
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
 * CHARACTERIZATION of the 3D Studio inspector's Material / Camera / Lighting / Background
 * sections, transcribed from the hand-written template that drew them
 * (Scene3DStudioSurface.vue, lines 3971-4353 / 4430-4462 as of 64492f314), NOT from
 * `SCENE_CONTROLS`. Where the two disagreed the template won and the schema or the
 * presentation remap was reconciled to it.
 *
 * TRANSFORM IS NOT MIGRATED, and that is a decision this file records rather than tests:
 * a `StudioRow` slider clamps typed and keyed entry to the declared range
 * (`lib/studio/row.ts`'s `parseTyped`), while the nine Position/Rotation/Size rows are
 * unbounded `<input type="number">`. The schema's ranges describe the parameters; they are
 * not a limit the editor ever enforced, and a gizmo routinely places objects outside them
 * — so a single arrow press on a clamped row would rewrite the value AND fan the difference
 * across the whole selection as a delta. The rows were migrated and then reverted; the
 * `does not migrate the Transform section` assertion below is what keeps them reverted
 * until a soft-range row kind exists.
 *
 * Geometry, Transform, Light, Decal, sculpt/merge and the object-motion sections stay
 * hand-written and are out of scope; they are asserted here only by their ABSENCE from the
 * panel.
 *
 * Deliberate, recorded divergences from the shipped markup:
 *   - Every migrated control is now a 28px StudioRow: a `StudioSegmented` pill row and a
 *     native `<select>` both become an inline dropdown.
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

describe('Scene3D panel parity — reading values', () => {
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
    const allowed = new Set([...SCENE_PANEL_ORDER, ...POST_SECTIONS])
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
    expect(SCENE_PANEL_ORDER).not.toContain('Transform')
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
    for (const title of ['Material', 'Camera', 'Lighting', 'Background']) {
      expect(src, title).not.toContain(`<StudioSection title="${title}"`)
      expect(src, title).not.toContain(`title="${title}" @pointerdown`)
    }
    // The sections that stay hand-written must still be here.
    expect(src).toContain('title="Geometry"')
    expect(src).toContain('title="Light"')
    expect(src).toContain('title="Decal"')
  })

  /**
   * The clamping revert, pinned from both ends: the panel must emit no transform row, and
   * the surface must still hand-write the nine unbounded number inputs. Re-migrating them
   * — which is only safe once a StudioRow can carry a SOFT range — has to delete these
   * assertions, which is the point.
   */
  it('does not migrate the Transform section', () => {
    expect(src).toContain('<StudioSection v-if="selected" title="Transform"')
    for (const axis of ['X', 'Y', 'Z']) {
      for (const field of ['Position', 'Rotation', 'Size']) {
        expect(src, `${field} ${axis}`).toContain(`aria-label="${field} ${axis}"`)
      }
    }
    const doc = defaultDoc()
    for (const obj of [prim('standard'), createLight('point', []), null]) {
      for (const c of scenePanelControls(doc, obj)) {
        expect(/^object\.(position|rotation|scale)\./.test(c.key), c.key).toBe(false)
      }
    }
  })
})
