import type { ControlSpec, ParamValue } from '~/lib/spacetype/effect'
import { POST_SECTIONS } from '~/lib/studio/post/controls'
import { showIfVisible } from '~/lib/studio/sections'
import {
  DEFAULT_MATERIAL, MATERIAL_DEFAULTS, gradientAngles,
  type MaterialType, type SceneDoc, type SceneObject,
} from './config'
import { SCENE_CONTROLS, type SceneControl } from './controls'

/**
 * PRESENTATION layer between `SCENE_CONTROLS` and the 3D Studio inspector panel.
 *
 * The schema's `group` strings and declaration order are the AGENT/MOTION/Collection
 * contract (`sceneAgentControls` emits in `SCENE_SECTIONS` order, `animatableTargets`
 * derives an ordered path array from the same list). The shipped hand-written inspector
 * grouped and ordered its rows completely differently: one Material card whose contents
 * change per material type, five collapsible sub-blocks inside it, Transform ahead of
 * everything, and Camera/Lighting/Background at the end.
 *
 * So the surface hands the panel a remapped COPY rather than the schema itself. Keys are
 * never touched — only `group` (including the `Material/<sub>` nesting paths), row order,
 * `label`/`hint`/`options`/`min`/`max`/`step` where the shipped control said something
 * different, and `bindable` (see below).
 *
 * `tests/unit/scene3d-panel-parity.unit.spec.ts` asserts this module against the rows the
 * deleted template drew, per selection state × material type.
 *
 * ## Everything here is `bindable: false`, deliberately
 * The shipped inspector's Material/Camera/Lighting/Background controls were
 * `StudioSlider`/`StudioColor`/`StudioSegmented`/`StudioSwitch` — none of which emit a
 * `menu`/`promote` event, so NO migrated row ever offered Collection binding. A
 * `StudioRow` would offer it by default (the variable glyph renders whenever
 * `bindable !== false`), which would be a brand-new affordance wired to nothing. Marking
 * every emitted row `bindable: false` reproduces the shipped surface exactly and is the
 * same guard Gradient's `onControlMenu` applies. The post rows are NOT touched: they were
 * already drawn by a `StudioControlPanel` and keep whatever they had.
 *
 * ## Transform is not migrated
 * The nine Position/Rotation/Size rows stay hand-written `<input type="number">` grids.
 * A `StudioRow` slider CLAMPS typed and keyed entry to the declared range
 * (`lib/studio/row.ts`'s `parseTyped`), and those ranges are a general-purpose description
 * of the parameters, not a limit the editor ever enforced: a gizmo places objects well
 * outside them, and one arrow press on a clamped row would rewrite the value AND fan the
 * difference across the whole selection as a delta (`axisDeltaWrites`). Migrating them
 * needs a soft-range row kind first. So the degrees-for-radians and world-Size-for-scale
 * conversions stay where they always were, in the surface's own `rotField`/`sizeAxis`
 * proxies, and nothing here reads or writes a transform key.
 */

// ── section order + chrome ───────────────────────────────────────────────────

/** Material (+ its five shipped sub-blocks, as nesting paths) and the doc-level cards,
 *  in the order the shipped inspector drew them. The hand-written Transform, Light and
 *  Decal cards sit ABOVE this panel in the template. Light and Decal are mutually
 *  exclusive with Material (a light/decal is never a primitive or a GLB), so moving them
 *  ahead of it cannot change what the user sees in any state.
 *
 *  Transform is NOT here — see this module's "Transform is not migrated" note. */
export const SCENE_PANEL_ORDER = [
  'Material',
  'Material/Coat & sheen',
  'Material/Glow',
  'Material/Transparency',
  'Material/Iridescence',
  'Material/Reflection',
  'Material/Surface relief',
  'Camera',
  'Lighting',
  'Background',
] as readonly string[]

/** …plus the shared post stack's own nested cards, which already rendered through a panel. */
export const SCENE_PANEL_SECTIONS = [...SCENE_PANEL_ORDER, ...POST_SECTIONS] as readonly string[]

/**
 * Per-card chrome, keyed by the ON-SCREEN title (the last path segment, which is what
 * StudioSectionTree looks up). The four sub-blocks the template drew as bare `<details>`
 * with no `open` attribute start collapsed; Transparency reproduces the shipped
 * `transparencyOpen` ref, which seeded itself open for glass and re-seeded on every
 * material-type change.
 */
export function scenePanelChrome(matType: MaterialType | null): Record<string, { badge?: string; open?: boolean }> {
  return {
    'Coat & sheen': { open: false },
    Glow: { open: false },
    Transparency: { open: matType === 'glass' },
    Iridescence: { open: false },
    Reflection: { open: false },
  }
}

const POST_GROUPS = new Set<string>(POST_SECTIONS)
const isScenePostGroup = (group: string | undefined): boolean => POST_GROUPS.has(String(group ?? ''))

// ── reading a control's value off the document ───────────────────────────────

const RELIEF_DEFAULTS: Record<string, ParamValue> = {
  source: 'none',
  scale: MATERIAL_DEFAULTS.reliefScale,
  contrast: MATERIAL_DEFAULTS.reliefContrast,
  tiling: MATERIAL_DEFAULTS.reliefTiling,
  invert: false,
}

const materialField = (mat: SceneObject['material'], field: string): ParamValue => {
  if (field === 'gradientYaw' || field === 'gradientPitch') {
    return gradientAngles(mat)[field === 'gradientYaw' ? 'yaw' : 'pitch']
  }
  if (field.startsWith('relief.')) {
    const sub = field.slice('relief.'.length)
    const v = (mat.relief as Record<string, unknown> | undefined)?.[sub]
    return (v ?? RELIEF_DEFAULTS[sub] ?? 0) as ParamValue
  }
  const v = (mat as unknown as Record<string, unknown>)[field]
  if (v !== undefined && v !== null) return v as ParamValue
  const d = (MATERIAL_DEFAULTS as unknown as Record<string, unknown>)[field]
    ?? (DEFAULT_MATERIAL as unknown as Record<string, unknown>)[field]
  return (d ?? 0) as ParamValue
}

/**
 * One canonical reader for every migrated key — the panel's `value` prop, the `showIf`
 * evaluation inside `scenePanelVisible`, and the parity spec all go through it.
 *
 * `post.*` is NOT handled here: `doc.post` is a plain PostSettings object the surface
 * already reads with `readPost`, and folding it in would duplicate that. Neither are
 * `object.position/rotation/scale` — see "Transform is not migrated" above.
 */
export function readSceneControl(
  doc: SceneDoc, obj: SceneObject | null | undefined, key: string,
): ParamValue {
  if (key === 'showFloor') return doc.showFloor
  if (key === 'camera.fov') return doc.camera.fov
  if (key === 'lighting.environment') return ENV_LABEL[doc.lighting.environment] ?? 'room'
  if (key.startsWith('lighting.')) {
    return (doc.lighting as unknown as Record<string, ParamValue>)[key.slice('lighting.'.length)] ?? 0
  }
  if (!obj) return 0
  if (key.startsWith('object.material.')) return materialField(obj.material, key.slice('object.material.'.length))
  return 0
}

// ── the environment segmented's display labels ───────────────────────────────

/** The shipped Environment control was a `StudioSegmented` over four SHORT labels, not
 *  over `ENVIRONMENT_KINDS` — 'darkStrips' read as 'dark', 'colorGels' as 'gels'. Kept
 *  here (rather than left in the surface) so the row's `options`, the reader and the
 *  writer cannot drift apart. */
export const ENV_OPTIONS = ['room', 'dark', 'softbox', 'gels'] as const
export const ENV_BY_LABEL: Record<string, SceneDoc['lighting']['environment']> = {
  room: 'room', dark: 'darkStrips', softbox: 'softbox', gels: 'colorGels',
}
const ENV_LABEL: Record<string, string> = {
  room: 'room', darkStrips: 'dark', softbox: 'softbox', colorGels: 'gels',
}

// ── bespoke-block anchors ────────────────────────────────────────────────────

/**
 * A block the schema never described — a picker grid, a ramp editor, an upload row, a
 * caption. It carries no value and no binding; it exists so the surface can supply a
 * `#control-<key>` slot that lands at the exact position the shipped card had it.
 * `#section-<Title>` cannot serve: it renders at the END of a card's body.
 */
interface ScenePanelAnchor {
  key: string
  label: string
  visible: (doc: SceneDoc, obj: SceneObject | null | undefined) => boolean
}

const typeOf = (obj: SceneObject | null | undefined): MaterialType | null =>
  obj && obj.kind !== 'light' ? obj.material.type : null

/** Whether the selection actually renders `.material`: a primitive always does, a GLB only
 *  once its override switch is on, and nothing else ever does. Unlike the schema's
 *  `isEditableMaterial` this is FALSE with no selection — the panel has no card to draw. */
const editable = (obj: SceneObject | null | undefined): boolean =>
  !!obj && (obj.kind === 'primitive' || (obj.kind === 'glb' && obj.materialOverride === true))

/** Whether relief has any lighting to perturb: an unlit shaderFill is a MeshBasicMaterial
 *  with no bump slot at all, so the card shows a notice instead of the dials. */
const reliefOn = (obj: SceneObject | null | undefined): boolean =>
  editable(obj) && !(typeOf(obj) === 'shaderFill' && obj!.material.unlit === true)

const isType = (obj: SceneObject | null | undefined, ...types: MaterialType[]): boolean =>
  editable(obj) && types.includes(typeOf(obj)!)

const SCENE_PANEL_ANCHORS: readonly ScenePanelAnchor[] = [
  // Material card
  { key: 'ui.material.override', label: 'Override materials', visible: (_d, o) => o?.kind === 'glb' },
  { key: 'ui.material.surface', label: 'Surface', visible: (_d, o) => isType(o, 'standard', 'glass') },
  { key: 'ui.material.matcap', label: 'Matcap', visible: (_d, o) => isType(o, 'matcap') },
  {
    key: 'ui.material.harmony', label: 'Harmony',
    visible: (_d, o) => isType(o, 'gradient') && materialField(o!.material, 'paletteMode') === 'harmony',
  },
  {
    key: 'ui.material.gradientStops', label: 'Colours',
    visible: (_d, o) => isType(o, 'gradient') && materialField(o!.material, 'paletteMode') !== 'harmony',
  },
  {
    key: 'ui.material.gradientDirection', label: 'Direction',
    visible: (_d, o) => isType(o, 'gradient') && materialField(o!.material, 'gradientType') === 'linear',
  },
  { key: 'ui.material.opalStops', label: 'Spectrum', visible: (_d, o) => isType(o, 'opalescent') },
  { key: 'ui.material.image', label: 'Texture', visible: (_d, o) => isType(o, 'image') },
  { key: 'ui.material.shader', label: 'Effect', visible: (_d, o) => isType(o, 'shaderFill') },
  // Transparency sub-card
  { key: 'ui.material.prism', label: 'Prism look', visible: (_d, o) => isType(o, 'standard', 'glass') },
  // Surface relief sub-card
  { key: 'ui.relief.unavailable', label: 'Relief unavailable', visible: (_d, o) => editable(o) && !reliefOn(o) },
  {
    key: 'ui.relief.normalMapBound', label: 'Normal map bound',
    visible: (_d, o) => reliefOn(o) && !!o!.material.normalImage,
  },
  {
    key: 'ui.relief.image', label: 'Relief image',
    visible: (_d, o) => reliefOn(o) && materialField(o!.material, 'relief.source') === 'image',
  },
  {
    key: 'ui.relief.shader', label: 'Relief effect',
    visible: (_d, o) => reliefOn(o) && materialField(o!.material, 'relief.source') === 'shader',
  },
  // Camera / Background
  { key: 'ui.camera.output', label: 'Output', visible: () => true },
  { key: 'ui.background.transparent', label: 'Transparent', visible: () => true },
  { key: 'ui.background.color', label: 'Color', visible: (d) => d.background !== 'transparent' },
]

export const SCENE_PANEL_ANCHOR_KEYS: ReadonlySet<string> = new Set(SCENE_PANEL_ANCHORS.map((a) => a.key))

// ── card membership + row order ──────────────────────────────────────────────

/** Rows the shipped Material card drew in its own body, per material type, in order.
 *  Everything above the per-type body is shared; everything below it lives in one of
 *  the sub-cards. Opalescent is the type that MOVES rows: clearcoat / coat roughness /
 *  reflection intensity sat in the main body for it, not in the Coat/Reflection blocks. */
const MATERIAL_HEAD = ['ui.material.override', 'object.material.type']

const MATERIAL_BODY: Record<MaterialType, readonly string[]> = {
  standard: ['ui.material.surface', 'object.material.color', 'object.material.roughness', 'object.material.metalness'],
  glass: ['ui.material.surface', 'object.material.color', 'object.material.roughness', 'object.material.metalness'],
  phong: ['object.material.color', 'object.material.shininess', 'object.material.specular'],
  toon: ['object.material.color', 'object.material.toonSteps'],
  matcap: ['ui.material.matcap'],
  fresnel: ['object.material.color', 'object.material.fresnelColor', 'object.material.fresnelPower'],
  gradient: [
    'object.material.paletteMode',
    'object.material.paletteHue', 'object.material.paletteSat', 'object.material.paletteLight',
    'ui.material.harmony', 'ui.material.gradientStops',
    'object.material.gradientType',
    'ui.material.gradientDirection', 'object.material.gradientYaw', 'object.material.gradientPitch',
    'object.material.gradientOffset', 'object.material.gradientSpread', 'object.material.gradientShading',
  ],
  opalescent: [
    'ui.material.opalStops', 'object.material.color',
    'object.material.opalHueShift', 'object.material.opalFrequency', 'object.material.opalAngleMix',
    'object.material.opalStrength', 'object.material.opalFlowSpeed',
    'object.material.roughness', 'object.material.metalness',
    'object.material.clearcoat', 'object.material.clearcoatRoughness', 'object.material.envMapIntensity',
  ],
  image: ['ui.material.image', 'object.material.roughness', 'object.material.metalness'],
  shaderFill: [
    'ui.material.shader', 'object.material.unlit',
    'object.material.roughness', 'object.material.metalness',
  ],
}

const SUB_CARDS: Record<string, readonly string[]> = {
  'Material/Coat & sheen': [
    'object.material.clearcoat', 'object.material.clearcoatRoughness',
    'object.material.sheen', 'object.material.sheenColor',
  ],
  'Material/Glow': ['object.material.emissive', 'object.material.emissiveIntensity'],
  'Material/Transparency': [
    'ui.material.prism', 'object.material.opacity', 'object.material.transmission',
    'object.material.ior', 'object.material.thickness', 'object.material.dispersion',
    'object.material.attenuationColor', 'object.material.attenuationDistance',
  ],
  'Material/Iridescence': ['object.material.iridescence', 'object.material.iridescenceIOR'],
  'Material/Reflection': ['object.material.envMapIntensity'],
  'Material/Surface relief': [
    'ui.relief.unavailable', 'object.material.relief.source', 'ui.relief.normalMapBound',
    'object.material.relief.scale', 'object.material.relief.contrast', 'object.material.relief.tiling',
    'object.material.relief.invert', 'ui.relief.image', 'ui.relief.shader',
  ],
}

const DOC_CARDS: Record<string, readonly string[]> = {
  Camera: ['camera.fov', 'ui.camera.output'],
  Lighting: [
    'lighting.preset', 'lighting.environment',
    'lighting.sunAzimuth', 'lighting.sunElevation', 'lighting.sunIntensity', 'lighting.ambient',
  ],
  Background: ['showFloor', 'ui.background.transparent', 'ui.background.color'],
}

/**
 * Which card a key lands in, given the active material type.
 *
 * The allow-lists above (`MATERIAL_HEAD`/`MATERIAL_BODY`/`SUB_CARDS`/`DOC_CARDS`) are
 * ORDER hints, not a gate: a key that isn't in any of them still draws, in the parent
 * card for its schema `group`, appended after the curated rows (`cardOrder`'s sort
 * falls unmapped keys through to `Number.MAX_SAFE_INTEGER`, and `Array.prototype.sort`
 * is stable, so they land in schema-declaration order at the end). This is what makes
 * the panel PERMISSIVE: a new `SCENE_CONTROLS` entry in an already-migrated group draws
 * without anyone touching this file.
 *
 * `group` is only passed for real schema controls (`scenePanelControls`'s main loop);
 * the bespoke-block anchors call this with no third argument; they carry no real schema
 * `group` and must keep resolving through the allow-lists alone.
 *
 * Still returns null for a key whose group ISN'T migrated yet — Transform (Task 2's soft-
 * range row kind) and Geometry/Light/Decal (Task 4) — so those sections stay hand-written
 * exactly as before.
 */
function panelCardOf(key: string, matType: MaterialType | null, group?: string): string | null {
  for (const [card, keys] of Object.entries(DOC_CARDS)) if (keys.includes(key)) return card
  if (MATERIAL_HEAD.includes(key)) return 'Material'
  if (matType && MATERIAL_BODY[matType].includes(key)) return 'Material'
  for (const [card, keys] of Object.entries(SUB_CARDS)) if (keys.includes(key)) return card
  if (group === 'Material') return 'Material'
  if (group === 'Camera' || group === 'Lighting' || group === 'Background') return group
  return null
}

function cardOrder(card: string, matType: MaterialType | null): readonly string[] {
  if (card === 'Material') return [...MATERIAL_HEAD, ...(matType ? MATERIAL_BODY[matType] : [])]
  return SUB_CARDS[card] ?? DOC_CARDS[card] ?? []
}

// ── the shipped label / hint / range overrides ───────────────────────────────

/**
 * Where the shipped control's caption, tooltip, options or bounds differed from the
 * schema's. The schema describes the PARAMETER (an agent reads `Emissive intensity`);
 * the inspector drew it inside a "Glow" block where `Intensity` was unambiguous.
 *
 * Removals matter as much as replacements: `object.rotation.*` carries the hint
 * 'Radians', which is a lie about a row that has always been edited in degrees, and
 * `showFloor` / `relief.source` were plain rows with no tooltip at all.
 */
type RowPatch = {
  label?: string
  /** `null` REMOVES the schema's hint — the shipped row had no tooltip. */
  hint?: string | null
  min?: number
  max?: number
  step?: number
  options?: string[]
  default?: string | number | boolean
}

const OVERRIDE: Record<string, RowPatch> = {
  'object.material.type': { label: 'Material' },
  'object.material.emissiveIntensity': { label: 'Intensity' },
  'object.material.iridescence': { label: 'Amount' },
  'object.material.iridescenceIOR': { label: 'IOR' },
  'object.material.envMapIntensity': { label: 'Intensity' },
  'object.material.relief.source': { label: 'Relief', hint: null },
  'object.material.relief.scale': { label: 'Depth' },
  'object.material.relief.contrast': {
    label: 'Contrast', hint: 'Deepens the light and dark areas so the relief catches the light.',
  },
  'object.material.relief.tiling': {
    label: 'Tiling', hint: 'How many times the pattern repeats across the surface — higher is finer.',
  },
  'camera.fov': { label: 'FOV' },
  'lighting.preset': { label: 'Preset' },
  'lighting.environment': { label: 'Environment', options: [...ENV_OPTIONS], default: 'room' },
  showFloor: { hint: null },
}

/** Opalescent moves three rows into the main body AND re-captions them — the shipped
 *  branch spelled out what each one does to a rainbow rather than to a PBR surface. */
const OPAL_OVERRIDE: Record<string, RowPatch> = {
  'object.material.color': { label: 'Base tint' },
  'object.material.metalness': {
    hint: 'Blends between plastic-like and metal reflections — high turns the rainbow into chrome',
  },
  'object.material.clearcoat': { hint: 'Adds a thin glossy varnish layer on top — the wet look' },
  'object.material.envMapIntensity': { label: 'Reflection intensity' },
}

// ── visibility ───────────────────────────────────────────────────────────────

/**
 * Panel-only gates the schema does not carry, and deliberately should not.
 *
 * `relief.scale/contrast/tiling/invert` are agent- and motion-reachable today; adding a
 * `showIf` to hide them would be a schema change with reach beyond the inspector, so the
 * shipped template's own condition (a source is picked, and the picked image is not
 * already a normal map) lives here instead.
 */
function panelGate(key: string, obj: SceneObject | null | undefined): boolean {
  if (key.startsWith('object.material.relief.') && key !== 'object.material.relief.source') {
    const src = materialField(obj!.material, 'relief.source')
    if (src === 'none') return false
    if (src === 'image' && !!obj!.material.normalImage) return false
  }
  return true
}

/**
 * Whether a schema control is drawn for this document + selection.
 *
 * Wraps `visibleSceneControls`'s per-entry semantics (`when`) rather than calling it, so
 * one control can be asked about without rebuilding the whole list, plus the two things
 * the list cannot know: that the inspector has NO active object (every `object.*` key is
 * unreachable — `isEditableMaterial` deliberately returns true for `obj === undefined`, so
 * that a Collection binding evaluated headlessly still describes itself), and the `showIf`
 * gates, which resolve against the ACTIVE object's material for `object.*` keys.
 */
export function scenePanelVisible(
  c: SceneControl | ControlSpec,
  doc: SceneDoc,
  obj: SceneObject | null | undefined,
): boolean {
  const key = c.key
  if (key.startsWith('object.') && !obj) return false
  const when = (c as SceneControl).when
  if (when && !when(doc, obj ?? undefined)) return false
  if (!panelGate(key, obj)) return false
  return showIfVisible(c as ControlSpec, (k) => readSceneControl(doc, obj, k))
}

// ── the remap ────────────────────────────────────────────────────────────────

function withPresentation(c: SceneControl, card: string, matType: MaterialType | null): ControlSpec {
  const out: Record<string, unknown> = { ...c, group: card, bindable: false }
  delete out.when
  const patches: RowPatch[] = []
  if (OVERRIDE[c.key]) patches.push(OVERRIDE[c.key]!)
  if (matType === 'opalescent' && OPAL_OVERRIDE[c.key]) patches.push(OPAL_OVERRIDE[c.key]!)
  for (const p of patches) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'hint' && v === null) delete out.hint
      else out[k] = v
    }
  }
  return out as unknown as ControlSpec
}

const anchorRow = (a: ScenePanelAnchor, card: string): ControlSpec =>
  ({ key: a.key, label: a.label, kind: 'text', default: '', group: card, bindable: false } as ControlSpec)

/**
 * Every row the shipped inspector drew for this document + selection, carrying its
 * shipped card, caption, bounds and units, in its shipped within-card order, with the
 * bespoke-block anchors spliced in at their positions. Any OTHER `SCENE_CONTROLS` entry
 * whose group is a migrated card draws too — see `panelCardOf`'s doc.
 *
 * Post rows pass through untouched, with their own `Effects/<Label>` group — they were
 * already drawn by a `StudioControlPanel` and are not part of this migration.
 *
 * `controls` defaults to `SCENE_CONTROLS` and exists so a test can exercise the
 * permissive fall-through with an appended novel control without mutating the shared
 * module-level array.
 */
export function scenePanelControls(
  doc: SceneDoc, obj: SceneObject | null | undefined, controls: readonly SceneControl[] = SCENE_CONTROLS,
): ControlSpec[] {
  const matType = editable(obj) ? typeOf(obj) : null
  const byCard = new Map<string, ControlSpec[]>()
  const push = (card: string, row: ControlSpec) => {
    if (!byCard.has(card)) byCard.set(card, [])
    byCard.get(card)!.push(row)
  }

  const post: ControlSpec[] = []
  for (const c of controls) {
    if (isScenePostGroup(c.group)) { post.push(c); continue }
    const card = panelCardOf(c.key, matType, c.group)
    if (!card) continue
    if (!scenePanelVisible(c, doc, obj)) continue
    push(card, withPresentation(c, card, matType))
  }
  for (const a of SCENE_PANEL_ANCHORS) {
    const card = panelCardOf(a.key, matType)
    if (!card) continue
    if (!a.visible(doc, obj)) continue
    push(card, anchorRow(a, card))
  }

  const out: ControlSpec[] = []
  for (const [card, rows] of byCard) {
    const order = cardOrder(card, matType)
    const at = new Map(order.map((k, i) => [k, i]))
    rows.sort((a, b) => (at.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (at.get(b.key) ?? Number.MAX_SAFE_INTEGER))
    out.push(...rows)
  }
  return [...out, ...post]
}
