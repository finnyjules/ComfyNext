/**
 * studioTune — let the CANVAS agent drive a STUDIO node's OWN surface, headlessly.
 *
 * Slice 1: the Frame (Compositor). A Frame's whole state lives on the node as
 * `data.properties.sailor_localLayers` + `sailor_localBg`, and the Frame node
 * re-bakes its thumbnail reactively from those — so we can read the CompositorState
 * off the node, plan against the Compositor surface (the same one the in-modal agent
 * uses), apply the result back onto the node, and the frame updates in place. No
 * modal, no re-implementation of rendering.
 *
 * Returns row summaries for the proposal + an undo closure (Dismiss restores the
 * node's prior state). Media ops (generate/edit/remove-bg inside the frame) need the
 * modal's upload+canvas tooling and are skipped here with a notice.
 */
import { $fetch } from 'ofetch'
import { applyCompositorCommand, describeCompositor, summarizeCompositorChange, verifyCompositor, type CompositorState } from '~/lib/agent/surfaces/compositor'
import { buildAgentPrompt, buildCommandSchema, parseAgentResponse } from '~/lib/agent/protocol'
import type { Command, CommandResult, SurfaceSnapshot } from '~/lib/agent/commandSurface'
import type { LayoutIssue } from '~/lib/agent/verify'
// Command-surface studios (planned like the Frame: describe → plan ops → apply).
import { applyTextureCommand, describeTexture, summarizeTextureChange, verifyTexture, type TextureState } from '~/lib/agent/surfaces/texture'
import { applySmartLayoutCommand, describeSmartLayout, summarizeSmartLayoutChange } from '~/lib/agent/surfaces/smartLayout'
import { verifySmartLayout } from '~/lib/agent/verify'
import { textureDefaults } from '~/lib/texturefx/controls'
import { cloneParams } from '~/lib/texturefx/types'
import type { Params, ParamValue } from '~/lib/spacetype/effect'
import type { TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'
import { isV3 } from '~~/shared/template-grid/types'
import { toV3 } from '~~/shared/template-grid/sections'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
// Param-patch / "vibe" studios (a single nested config; NL → clamped param patch).
import { makeConfigParams } from '~/lib/agent/configParams'
import { describeControls, validatePatch, type DescribedControl } from '~/lib/spacetype/controlDescriptor'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { defaultConfig as defaultGradientConfig } from '~/lib/gradientfx/randomize'
import { GRADIENT_GUIDANCE, gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { buildGradientPreset } from '~/lib/gradientfx/presets'
import { cloneConfig as cloneGradientConfig, type GradientConfig } from '~/lib/gradientfx/types'
import { cloneConfig as cloneShaderConfig, defaultConfig as defaultShaderConfig, hydrateConfig as hydrateShaderConfig, type ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { shaderAgentControls } from '~/lib/shaderstudio/agentControls'
import { mergeConfig as mergeShapeConfig } from '~/lib/shapefx/config'
import { SHAPE_GUIDANCE, shapeAgentControls } from '~/lib/shapefx/agentControls'
import { getEffect } from '~/lib/shaderfx/catalog'

const MEDIA_OPS = new Set(['generateImage', 'editImage', 'removeImageBackground'])

export interface TuneRow { label: string; before: string; after: string; rationale: string }
export interface TuneResult { ok: boolean; rows: TuneRow[]; restore: () => void; notice?: string; error?: string }

/** Read a Frame node's CompositorState from its persisted properties (deep-cloned
 *  so the live node isn't mutated until we write back). */
function readState(node: any): CompositorState {
  const props = node?.data?.properties ?? {}
  return {
    layers: JSON.parse(JSON.stringify(props.sailor_localLayers ?? [])),
    background: props.sailor_localBg,
    postEffects: JSON.parse(JSON.stringify((props as any).sailor_localFx ?? [])),
  }
}
/** Write a CompositorState back onto the node — mirrors useLocalLayerEditor's
 *  commit/writeBg so the Frame re-bakes (and persists) exactly as a hand-edit would. */
function writeState(node: any, s: CompositorState) {
  if (!node.data.properties) node.data.properties = {}
  node.data.properties.sailor_localLayers = s.layers
  const bg = s.background
  if (bg === undefined || bg === 'none' || bg === '') delete node.data.properties.sailor_localBg
  else node.data.properties.sailor_localBg = bg
  if (s.postEffects?.length) node.data.properties.sailor_localFx = s.postEffects
  else delete node.data.properties.sailor_localFx
}

/** The unified wired+local z-order (`sailor_stackOrder`, bottom→top, keys
 *  `l:<id>` / `w:<slot>`). Needed so "send to back" sits a local layer behind the
 *  CONNECTED image — which lives outside CompositorState. */
function readStackOrder(node: any): string[] { return [...((node?.data?.properties?.sailor_stackOrder as string[]) ?? [])] }
function writeStackOrder(node: any, order: string[]) {
  if (!node.data.properties) node.data.properties = {}
  if (order.length) node.data.properties.sailor_stackOrder = order
  else delete node.data.properties.sailor_stackOrder
}

/** Plan + apply a natural-language tweak to a Frame (Compositor) node in place. */
export async function tuneCompositorNode(node: any, request: string, apiKey: string, tier = 'plan'): Promise<TuneResult> {
  const prior = readState(node)
  const priorOrder = readStackOrder(node)
  const restore = () => { writeState(node, prior); writeStackOrder(node, priorOrder) }
  // Guard: only a Frame (Compositor) has the layer/background state this reads &
  // writes — never scribble those keys onto another node type.
  if (node?.data?.nodeType !== 'Compositor') {
    return { ok: false, rows: [], restore, notice: `I can only tune a Frame in place — “${node?.data?.title ?? 'this node'}” isn’t one.` }
  }
  let state = readState(node)
  const snapshot = describeCompositor(state)
  let res: { text: string }
  try {
    res = await $fetch<{ text: string }>('/api/agent-plan', {
      method: 'POST',
      body: { apiKey, tier, prompt: buildAgentPrompt(snapshot, request), schema: buildCommandSchema(snapshot.commands) },
      timeout: 60_000,
    })
  } catch (e) {
    return { ok: false, rows: [], restore, error: e instanceof Error ? e.message : String(e) }
  }
  const { commands, changeRationales, message, parseFailed } = parseAgentResponse(res.text)
  if (parseFailed) return { ok: false, rows: [], restore, error: 'The model reply could not be read — please try again.' }
  const rows: TuneRow[] = []
  const backIds: string[] = []
  const frontIds: string[] = []
  let droppedMedia = false
  commands.forEach((cmd, i) => {
    if (MEDIA_OPS.has(cmd.op)) { droppedMedia = true; return }
    const test = applyCompositorCommand(state, cmd)
    if (!test.ok) return
    const sum = summarizeCompositorChange(state, cmd) ?? { label: cmd.op, before: '', after: '' }
    rows.push({ ...sum, rationale: changeRationales[i] ?? '' })
    state = test.template
    if (cmd.op === 'setLayerDepth' && cmd.target) {
      const to = String(cmd.args?.to ?? '')
      if (to === 'back') backIds.push(String(cmd.target))
      else if (to === 'front') frontIds.push(String(cmd.target))
    }
  })
  if (rows.length) {
    writeState(node, state) // apply as preview — the frame re-bakes
    // Push "back" layers behind the connected image in the unified stack. The Frame
    // reconciles: listed keys keep their order, present-but-unlisted keys (the wired
    // image, "front" layers) float ON TOP — so listing only the back keys is enough.
    if (backIds.length || frontIds.length) {
      const backKeys = backIds.map(id => `l:${id}`)
      const drop = new Set([...backKeys, ...frontIds.map(id => `l:${id}`)])
      writeStackOrder(node, [...backKeys, ...readStackOrder(node).filter(k => !drop.has(k))])
    }
  }
  // Additive notice: a dropped media op must NOT hide that other edits applied; a
  // verify warning (off-canvas / low-contrast) rides along too.
  const parts: string[] = []
  if (!rows.length && message) parts.push(message)
  if (droppedMedia) parts.push('Generating or editing images inside a frame isn’t available from the canvas yet — open the frame to do that.')
  if (rows.length) {
    const warn = verifyCompositor(state).find(i => i.level === 'warn')
    if (warn) parts.push(`Heads up: ${warn.message}`)
  }
  return { ok: rows.length > 0, rows, restore, notice: parts.length ? parts.join(' ') : undefined }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic COMMAND-SURFACE tuner — Texture + Smart Layout plan exactly like the
// Frame (describe state → plan ops via /api/agent-plan → apply). An adapter binds
// the studio's node-state read/write to its surface's describe/apply/summarize/
// verify, so this stays one code path. (The Frame keeps its own function above —
// it has bespoke unified-stack-order handling this generic path doesn't need.)
// ─────────────────────────────────────────────────────────────────────────────
interface CommandAdapter<S> {
  read(node: any): S
  write(node: any, state: S): void
  describe(state: S): SurfaceSnapshot
  apply(state: S, cmd: Command): CommandResult<S>
  summarize(state: S, cmd: Command): { label: string; before: string; after: string } | null
  verify?(state: S): LayoutIssue[]
  /** Notice appended if the plan included a media op we can't run headlessly. */
  mediaNotice?: string
}

async function runCommandSurface<S>(node: any, request: string, apiKey: string, tier: string, a: CommandAdapter<S>): Promise<TuneResult> {
  const prior = a.read(node) // read twice: `prior` for undo, `state` as the live probe
  const restore = () => a.write(node, prior)
  let state = a.read(node)
  const snapshot = a.describe(state)
  let res: { text: string }
  try {
    res = await $fetch<{ text: string }>('/api/agent-plan', {
      method: 'POST',
      body: { apiKey, tier, prompt: buildAgentPrompt(snapshot, request), schema: buildCommandSchema(snapshot.commands) },
      timeout: 60_000,
    })
  } catch (e) {
    return { ok: false, rows: [], restore, error: e instanceof Error ? e.message : String(e) }
  }
  const { commands, changeRationales, message, parseFailed } = parseAgentResponse(res.text)
  if (parseFailed) return { ok: false, rows: [], restore, error: 'The model reply could not be read — please try again.' }
  const rows: TuneRow[] = []
  let droppedMedia = false
  commands.forEach((cmd, i) => {
    if (MEDIA_OPS.has(cmd.op)) { droppedMedia = true; return }
    const test = a.apply(state, cmd)
    if (!test.ok) return
    const sum = a.summarize(state, cmd) ?? { label: cmd.op, before: '', after: '' }
    rows.push({ ...sum, rationale: changeRationales[i] ?? '' })
    state = test.template
  })
  if (rows.length) a.write(node, state) // apply as preview — the studio node re-bakes
  const parts: string[] = []
  if (!rows.length && message) parts.push(message)
  if (droppedMedia && a.mediaNotice) parts.push(a.mediaNotice)
  if (rows.length && a.verify) {
    const warn = a.verify(state).find(i => i.level === 'warn')
    if (warn) parts.push(`Heads up: ${warn.message}`)
  }
  return { ok: rows.length > 0, rows, restore, notice: parts.length ? parts.join(' ') : undefined }
}

/** Texture Studio: state is a single `Params` bag under sailor_textureStudio
 *  (merged over defaults so pre-newer-key nodes still describe cleanly). No media
 *  ops. */
export async function tuneTextureNode(node: any, request: string, apiKey: string, tier = 'plan'): Promise<TuneResult> {
  return runCommandSurface<TextureState>(node, request, apiKey, tier, {
    read: (n) => {
      const saved = n?.data?.properties?.sailor_textureStudio as Params | undefined
      return { params: saved ? { ...textureDefaults(), ...cloneParams(saved) } : textureDefaults() }
    },
    write: (n, s) => { if (!n.data.properties) n.data.properties = {}; n.data.properties.sailor_textureStudio = cloneParams(s.params) },
    describe: describeTexture,
    apply: applyTextureCommand,
    summarize: summarizeTextureChange,
    verify: verifyTexture,
  })
}

/** Smart Layout: state is a `TemplateV3` JSON string on the `layout` widget. A
 *  fresh/legacy node may hold a v2 (or empty) template — upgrade it to v3 the same
 *  way the editor does (`toV3`) so the surface, which is v3-only, can plan on it. */
function smartLayoutWidgetIndex(node: any): number {
  const defs = (node?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d?.name === 'layout')
}
function readSmartLayout(node: any): TemplateV3 {
  const i = smartLayoutWidgetIndex(node)
  const raw = i >= 0 ? String(node?.data?.widgetsValues?.[i] ?? '').trim() : ''
  let t: TemplateV2 | TemplateV3
  if (raw) { try { t = JSON.parse(raw) as TemplateV2 | TemplateV3 } catch { t = makeStarterTemplate(`layout_${Math.random().toString(36).slice(2, 8)}`) as TemplateV2 } }
  else t = makeStarterTemplate(`layout_${Math.random().toString(36).slice(2, 8)}`) as TemplateV2
  return isV3(t) ? t : toV3(t as TemplateV2)
}
function writeSmartLayout(node: any, t: TemplateV3): void {
  const i = smartLayoutWidgetIndex(node)
  if (i < 0) return
  if (!Array.isArray(node.data.widgetsValues)) node.data.widgetsValues = []
  node.data.widgetsValues[i] = JSON.stringify(t, null, 2)
}
export async function tuneSmartLayoutNode(node: any, request: string, apiKey: string, tier = 'plan'): Promise<TuneResult> {
  return runCommandSurface<TemplateV3>(node, request, apiKey, tier, {
    read: readSmartLayout,
    write: writeSmartLayout,
    describe: describeSmartLayout,
    apply: applySmartLayoutCommand,
    summarize: summarizeSmartLayoutChange,
    verify: verifySmartLayout,
    mediaNotice: 'Generating or editing images inside a layout isn’t available from the canvas yet — open Smart Layout to do that.',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic PARAM-PATCH tuner — Gradient + Shader keep one nested `config` and tune
// via the same "vibe" path the in-studio copilot uses: flatten config → dotted
// Params, offer the applicable controls, POST /api/vibe, clamp the returned patch
// (validatePatch), then write each key back through the flattening proxy.
// ─────────────────────────────────────────────────────────────────────────────
interface PatchAdapter {
  /** Read (cloned) config off the node + the controls applicable to it. May be
   *  async (Shader resolves its effect def from the catalog). */
  read(node: any): { config: any; controls: ControlSpec[] } | Promise<{ config: any; controls: ControlSpec[] }>
  /** Flat dotted-path view of the config (writes mutate the config in place). */
  params(config: any): Params
  write(node: any, config: any): void
  clone(config: any): any
  /** Human label for the studio (also the /api/vibe effectLabel). */
  label: string
  /** Optional per-domain guidance block for the vibe prompt (recipes). */
  guidance?: string
  /** Optional "preset" macro: given a preset name, return a whole new base config
   *  (or null for an unknown name). Applied BEFORE the scalar overrides. */
  applyPreset?: (name: string) => any
}

async function runParamPatch(node: any, request: string, apiKey: string, a: PatchAdapter): Promise<TuneResult> {
  const read0 = await a.read(node)
  let config = read0.config
  const prior = a.clone(config)
  const restore = () => a.write(node, prior)
  let params = a.params(config)
  const described: DescribedControl[] = describeControls(read0.controls, params)
  if (!described.length) return { ok: false, rows: [], restore, notice: `“${a.label}” has no AI-adjustable controls for that yet.` }
  let res: { changes?: { key: string; value: ParamValue }[]; rationale?: string }
  try {
    res = await $fetch('/api/vibe', {
      method: 'POST',
      body: { apiKey, controls: described, phrase: request, effectLabel: a.label, guidance: a.guidance },
      timeout: 60_000,
    })
  } catch (e) {
    return { ok: false, rows: [], restore, error: e instanceof Error ? e.message : String(e) }
  }
  const raw: Record<string, ParamValue> = {}
  for (const c of res.changes ?? []) raw[c.key] = c.value
  const patch = validatePatch(raw, described)
  const byPath = new Map(described.map(d => [d.path, d]))
  const rationale = res.rationale ?? ''
  const rows: TuneRow[] = []

  // Preset macro (canvas gradient tuner): swap the whole base config FIRST, then
  // apply the remaining scalar overrides on top of it. The style preset bakes in
  // the layout + its liquid knobs, so the overrides are just colours/blur/grain.
  if (a.applyPreset && typeof patch.preset === 'string') {
    const swapped = a.applyPreset(patch.preset)
    if (swapped) {
      rows.push({ label: byPath.get('preset')?.label ?? 'Style preset', before: String(config?.canvas?.layout ?? ''), after: patch.preset, rationale })
      config = swapped
      params = a.params(config) // re-bind the flat view to the new config
    }
    delete patch.preset
  }

  for (const [key, value] of Object.entries(patch)) {
    const before = params[key]
    params[key] = value // write-through the proxy → mutates the live config
    rows.push({ label: byPath.get(key)?.label ?? key, before: String(before ?? ''), after: String(value), rationale })
  }
  if (rows.length) a.write(node, config)
  return { ok: rows.length > 0, rows, restore, notice: rows.length ? undefined : (rationale || 'No adjustable change for that — try naming a colour, style or amount.') }
}

/** Gradient Studio: config under sailor_gradientStudio; controls depend on the
 *  current layout. Fresh node → a default gradient to tune from. Layer 0 is the
 *  headless active layer (the `layer.` control prefix resolves against it). */
export async function tuneGradientNode(node: any, request: string, apiKey: string): Promise<TuneResult> {
  return runParamPatch(node, request, apiKey, {
    read: (n) => {
      const saved = n?.data?.properties?.sailor_gradientStudio as GradientConfig | undefined
      const config = saved ? cloneGradientConfig(saved) : defaultGradientConfig()
      // includePreset: the canvas tuner can swap the whole base config (buildGradientPreset).
      return { config, controls: gradientAgentControls(config, { includePreset: true }) }
    },
    params: (config) => makeConfigParams(() => config, () => 0),
    write: (n, config) => { if (!n.data.properties) n.data.properties = {}; n.data.properties.sailor_gradientStudio = cloneGradientConfig(config) },
    clone: cloneGradientConfig,
    label: 'Gradient studio',
    guidance: GRADIENT_GUIDANCE,
    applyPreset: (name) => buildGradientPreset(name),
  })
}

/** Shader Studio: config under sailor_shaderStudio; controls also surface the
 *  active effect's float uniforms, so we resolve the effect def from the catalog. */
export async function tuneShaderNode(node: any, request: string, apiKey: string): Promise<TuneResult> {
  return runParamPatch(node, request, apiKey, {
    read: async (n) => {
      const saved = n?.data?.properties?.sailor_shaderStudio
      const config: ShaderStudioConfig = saved && typeof saved === 'object' ? hydrateShaderConfig(saved) : defaultShaderConfig()
      const effectDef = config.effects[0]?.id ? await getEffect(config.effects[0].id) : null
      return { config, controls: shaderAgentControls(config, effectDef) }
    },
    params: (config) => makeConfigParams(() => config),
    write: (n, config) => { if (!n.data.properties) n.data.properties = {}; n.data.properties.sailor_shaderStudio = cloneShaderConfig(config) },
    clone: cloneShaderConfig,
    label: 'Shader studio',
  })
}

/**
 * Shape Studio's persisted property is a WRAPPER — { config, canvasW, canvasH,
 * aspectKey, orbit } — unlike gradient's bare config. `write` merges the tuned
 * config back into the existing wrapper so canvas size and camera orbit survive.
 */
const shapeAdapter: PatchAdapter = {
  read: (n: any) => {
    const config = mergeShapeConfig(n?.data?.properties?.sailor_shapeStudio?.config)
    return { config, controls: shapeAgentControls(config) }
  },
  params: (config: any) => makeConfigParams(() => config, () => 0),
  write: (n: any, config: any) => {
    if (!n.data) n.data = {}
    if (!n.data.properties) n.data.properties = {}
    const prev = n.data.properties.sailor_shapeStudio ?? {}
    n.data.properties.sailor_shapeStudio = { ...prev, config: JSON.parse(JSON.stringify(config)) }
  },
  clone: (config: any) => JSON.parse(JSON.stringify(config)),
  label: 'Shape studio',
  guidance: SHAPE_GUIDANCE,
}

/** Exposed for tests only — the adapter is otherwise reached via the registry. */
export const __shapeAdapterForTest = shapeAdapter

/** Shape Studio: config lives nested under sailor_shapeStudio.config, alongside
 *  canvas size + camera orbit that are NOT tune-adjustable — write must merge
 *  back into the wrapper rather than replace it (see shapeAdapter above). */
export async function tuneShapeNode(node: any, request: string, apiKey: string): Promise<TuneResult> {
  return runParamPatch(node, request, apiKey, shapeAdapter)
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — the canvas agent dispatches a tuneNode by the target's nodeType.
// ─────────────────────────────────────────────────────────────────────────────
export type StudioTuner = (node: any, request: string, apiKey: string, tier?: string) => Promise<TuneResult>

export const STUDIO_TUNERS: Record<string, StudioTuner> = {
  Compositor: tuneCompositorNode,
  TextureStudio: tuneTextureNode,
  SmartLayout: tuneSmartLayoutNode,
  GradientStudio: tuneGradientNode,
  ShaderStudio: tuneShaderNode,
  ShapeStudio: tuneShapeNode,
}

/** The in-place tuner for a node type, or undefined if that node has no canvas
 *  tune surface (the caller then tells the user it can't be tuned from here). */
export function studioTunerFor(nodeType: string | undefined | null): StudioTuner | undefined {
  return nodeType ? STUDIO_TUNERS[nodeType] : undefined
}
