import type { ControlSpec } from '~/lib/spacetype/effect'
import { isFill } from '~/lib/compositor/paint'
import { getEffectSync } from '~/lib/shaderfx/catalog'
import { derivedShaderFillControls, shaderFillControls } from '~/lib/shaderfill/controls'
import type { VtAxis } from './font'
import type { VectorTypeConfig } from './config'
import { VT_CONTROLS, VT_LAYER_PREFIX, derivedVtControls, visibleVtControls } from './controls'
import { vtLayerLabels } from './layerLabel'

/** Strip the schema-only fields (`when`/`agent`/`animatable`) a `VtControl` may
 *  carry, and drop anything explicitly withheld from the agent. Mirrors
 *  `shapefx/agentControls.ts` exactly. */
function stripMeta(specs: ControlSpec[]): ControlSpec[] {
  return specs
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, summary, ...spec }: any) => spec as ControlSpec)
}

/** Where a Vector Type layer's `ShaderSpec` lives, relative to the active layer.
 *  Exported so the surface's shader-fill editor and this vocabulary cannot drift. */
export const VT_LAYER_SHADER_PREFIX = 'layer.paint.shader'

/**
 * Vector Type's tune vocabulary for the in-product agent, derived from
 * VT_CONTROLS rather than hand-listed. Only controls that apply to the current
 * config are returned, mirroring the surface's own gating so the agent is never
 * offered a knob the user cannot see.
 *
 * `axes` is the LOADED font's axis list ("declare the frame, derive the
 * contents" — see ./controls.ts). It is a parameter rather than a lookup
 * because `loadVariableFont` exposes promises only, with no synchronous cache to
 * read; `shaderAgentControls(config, effectDef)` takes its `EffectDef` the same
 * way for the same reason. Omit it and the studio's static vocabulary is
 * returned unchanged — the axis sliders are simply not derived yet, which is
 * the honest answer before a font has finished loading.
 *
 * ## The shader-fill branch is NOT free — it has to be written out
 *
 * `visibleVtControls` can only ever return members of `VT_CONTROLS`, and
 * `VT_CONTROLS` declares no shader key at all (the shader vocabulary lives in the
 * shared `~/lib/shaderfill/controls.ts`, so that four host studios do not each
 * keep a copy of it). Measured before writing this branch: on a config whose
 * active layer's paint type is `shader`, `visibleVtControls` emitted
 * `text, fontId, size, tracking, align, layer.paint.type, layer.anchor,
 * motion.stagger.*` — and not one shader key. Nothing derives them; Shape Studio
 * needed the same explicit branch for the same reason
 * (`shapefx/agentControls.ts:35-39`), and this mirrors it line for line.
 *
 * The active effect's own params are appended too, but only when the shader-fx
 * catalog has ALREADY resolved that effect id. This reads the catalog's
 * synchronous cache (`getEffectSync`, never a fetch) rather than taking an
 * `EffectDef` parameter, so the signature stays at `(cfg, axes)` for its three
 * callers. If nothing on the page has fetched the catalog yet the per-effect
 * params are simply absent this call — not wrong, just not derived yet, the same
 * graceful degradation `~/lib/shaderfill/field.ts` accepts for the same reason.
 * (The axes above cannot use that trick: `loadVariableFont` exposes promises
 * only, with no synchronous cache to read, which is why they are a parameter.)
 */
/**
 * The `layer.*` vocabulary expanded to one ABSOLUTE, ID-ADDRESSED control per
 * appearance layer — `appearance.Lstroke.width`, labelled `Stroke · Stroke width`.
 *
 * ## Why this exists: the agent could not reach a stroke
 *
 * `layer.*` means "the ACTIVE layer", and headlessly the active layer is 0
 * (`studioTune` and the Collection resolver both pass no index — the convention
 * `controls.ts` documents). `layer.width` is `when`-gated to stroke layers, and
 * on every migrated node layer 0 is the FILL. So between the stack landing and
 * this function, "make the outline thicker" reached nothing: the key the agent
 * needed was withheld by a predicate asked about the wrong layer. Un-gating
 * `layer.width` would have been the other failure — a dead width control offered
 * on every fill layer.
 *
 * Naming the layer fixes both. The gate still runs, but it is asked about EACH
 * layer in turn, so a stack with a stroke anywhere in it offers exactly one
 * width key and it names the stroke.
 *
 * ## By id, not by index
 *
 * These keys are persisted — a Collection binding stores `params.<key>` — so an
 * index would re-point on reorder and a binding to a deleted layer would resolve
 * to whichever layer took its slot. `makeConfigParams` resolves the id and
 * refuses an unknown one, so a stale key reads `undefined` and writes nothing.
 *
 * A layer whose id is missing or ambiguous (never produced by `mergeConfig`, but
 * a raw blob can be anything) is SKIPPED rather than addressed positionally: an
 * agent key is a promise about which layer it edits, and a positional one cannot
 * keep it. Motion makes the opposite trade for the same case — a track that
 * already exists is worth resolving, a new key is not worth minting.
 */
export function vtStackControls(cfg: VectorTypeConfig): ControlSpec[] {
  const stack = Array.isArray(cfg?.appearance) ? cfg.appearance : []
  const names = vtLayerLabels(stack)
  const out: ControlSpec[] = []
  for (const c of VT_CONTROLS) {
    if (!c.key.startsWith(VT_LAYER_PREFIX)) continue
    if ((c as { agent?: boolean }).agent === false) continue
    const rest = c.key.slice(VT_LAYER_PREFIX.length)
    stack.forEach((l, i) => {
      const id = l?.id
      if (typeof id !== 'string' || id === '' || id.includes('.') || /^\d+$/.test(id)) return
      if (c.when && !c.when(cfg, l)) return
      const { when, agent, animatable, summary, ...spec } = c as any
      out.push({ ...spec, key: `appearance.${id}.${rest}`, label: `${names[i] ?? `Layer ${i + 1}`} · ${c.label}` } as ControlSpec)
    })
  }
  return out
}

export function vtAgentControls(cfg: VectorTypeConfig, axes: VtAxis[] = [], active = 0): ControlSpec[] {
  const out = [
    ...stripMeta(visibleVtControls(cfg, active)),
    ...stripMeta(derivedVtControls(cfg, axes)),
    // The relative `layer.*` keys above edit whatever the user has SELECTED
    // ("make this layer red"); these name a layer outright ("make the outline
    // thicker"). Both are needed and they are not interchangeable — see above.
    ...vtStackControls(cfg),
  ]
  // The ACTIVE appearance layer's paint is a `Paint`; only its `Fill` arm can
  // carry a shader (a `Gradient` has nowhere to put one), so this narrows before
  // asking the type — the same `isFill` guard `controls.ts`'s own `vtFill` uses.
  const paint = cfg?.appearance?.[active]?.paint
  const fill = isFill(paint) ? paint : null
  if (fill?.type === 'shader' && fill.shader) {
    // The relative prefix, matching the rest of the layer vocabulary: the
    // `ShaderSpec` lives per LAYER now, so a fixed `fill.shader` key would
    // address a field that no longer exists anywhere on the config.
    out.push(...stripMeta(shaderFillControls(VT_LAYER_SHADER_PREFIX)))
    const effectDef = getEffectSync(fill.shader.effectId)
    // Addressed at `layer.paint.shader.params.<paramId>` — the REAL
    // `ShaderSpec.params` path, so `makeConfigParams` and `getByPath`/`setByPath`
    // land on the stored value with no translation layer. See the module doc on
    // `~/lib/shaderfill/controls.ts` for what a key one segment off that path
    // cost last time (a phantom `.p` object, silently never rendered).
    if (effectDef) out.push(...derivedShaderFillControls(effectDef, VT_LAYER_SHADER_PREFIX))
  }
  return out
}


/**
 * The vocabulary a COLLECTION BINDING may be made against.
 *
 * `vtAgentControls` minus the relative `layer.*` keys, plus the same
 * `vtStackControls` expansion. The difference is not cosmetic:
 *
 *   an agent patch is applied ONCE, in the moment, against the layer the user is
 *   looking at — `layer.paint.a` is exactly right for it;
 *
 *   a Collection binding is PERSISTED and re-resolved on every sweep row, every
 *   preview and every batch render. `params.layer.paint.a` would mean "whichever
 *   layer happens to be selected then", so the same saved binding paints a
 *   different layer depending on where the user last clicked — and it would do it
 *   silently, with a real value landing on a real layer.
 *
 * So the bindable list names its layer: `params.appearance.Lstroke.width`. When
 * that layer is deleted the key is simply no longer in this list, and
 * `applyParamsPreview` skips a key it has no control for — the binding degrades
 * to IGNORED. `makeConfigParams` refuses the unknown id underneath it, so the
 * degradation holds even if a caller applies a binding without consulting this
 * list at all.
 */
export function vtBindableControls(cfg: VectorTypeConfig, axes: VtAxis[] = []): ControlSpec[] {
  return [
    ...stripMeta(visibleVtControls(cfg)).filter(c => !c.key.startsWith(VT_LAYER_PREFIX)),
    ...stripMeta(derivedVtControls(cfg, axes)),
    ...vtStackControls(cfg),
  ]
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside vtAgentControls.
 */
export { VT_GUIDANCE } from './controls'
