import type { ControlSpec } from '~/lib/spacetype/effect'
import type { EffectDef } from '~/lib/shaderfx/types'
import { DEFAULT_SHADER_SPEC } from '~/lib/spacetype/fillTile'
import { unprefixedKey } from './descriptor'

/**
 * The control-schema pattern for shader fills — "declare the frame, derive the
 * contents" — and the shape every future absorbed library's parameter list should
 * follow when that list is not known ahead of time.
 *
 * `lib/gradientfx/controls.ts:5-24` requires control KEYS to stay frozen forever,
 * because Collection bindings persist `params.<key>` — a renamed key silently
 * orphans every saved binding. That works for a hand-authored, closed vocabulary
 * (Gradient's ~60 sliders), but a shader fill wraps ONE of 63 catalog effects, each
 * with its own param list the app doesn't (and can't) know ahead of time. You
 * cannot freeze what you do not know.
 *
 * The resolution — already discovered independently by Shader Studio
 * (`lib/shaderstudio/agentControls.ts:21` builds `ControlSpec[]` imperatively from
 * a live `EffectDef` rather than declaring them) — is to split the vocabulary into
 * two tiers:
 *
 *   fill.shader.effectId   <- DECLARED here, frozen forever (SHADER_FILL_CONTROLS)
 *   fill.shader.anchor     <- DECLARED here, frozen forever (SHADER_FILL_CONTROLS)
 *   fill.shader.speed      <- DECLARED here, frozen forever (SHADER_FILL_CONTROLS)
 *   fill.shader.p.<paramId> <- DERIVED per effect (derivedShaderFillControls)
 *
 * The three declared keys never change shape, so Collection bindings against them
 * are as safe as any hand-authored control. The derived `p.<paramId>` keys are
 * stable only PER EFFECT — switching `effectId` changes which `p.*` keys exist and
 * what they mean. That instability is inherent to what they represent (there is no
 * such thing as a frozen "segments" knob independent of which effect defines
 * "segments"), not a defect of this schema. A binding against `fill.shader.p.segments`
 * is only meaningful while `fill.shader.effectId` names an effect that HAS a
 * `segments` param; `resolveEffectParams` (./descriptor.ts) already drops any param
 * key an effect doesn't declare, so a stale binding degrades to "ignored", not
 * "wrong value applied".
 *
 * Known gap, stated rather than silently left: the `.p.` namespace is the schema's
 * own address, not a literal object path. Real storage is `ShaderSpec.params.<key>`
 * (unprefixed — see `unprefixedKey` below), i.e. `fill.shader.params.<key>`, one
 * segment off from `fill.shader.p.<key>`. Naive dotted-path resolvers
 * (`lib/agent/configParams.ts`'s `makeConfigParams`, `lib/studio/path.ts`'s
 * `getByPath`/`setByPath`) do NOT special-case `.p.` → `.params.`, so writing
 * through this schema's keys via either today does not yet reach the real
 * `ShaderSpec.params` object. Closing that is a write-path resolver, which is a
 * separate task from declaring the vocabulary.
 */

const GROUP = 'Shader'

export const SHADER_FILL_CONTROLS: ControlSpec[] = [
  {
    key: 'fill.shader.effectId',
    label: 'Effect',
    kind: 'select',
    // Deliberately empty: the 63-effect catalog is fetched at runtime
    // (`lib/shaderfx/catalog.ts`), not a static list this module can declare — the
    // same reason `Scene3DStudioSurface.vue`'s `shaderEffectIds` computed reads it
    // from the live catalog instead of a constant. A caller that offers this control
    // (agent prompt, UI select) must merge in the live catalog's effect ids.
    options: [],
    default: DEFAULT_SHADER_SPEC.effectId,
    group: GROUP,
    hint: 'Which catalog shader effect processes the fill underneath.',
  },
  {
    key: 'fill.shader.anchor',
    label: 'Anchor',
    kind: 'select',
    options: ['object', 'frame'],
    default: DEFAULT_SHADER_SPEC.anchor,
    group: GROUP,
    hint: "object = the field samples in the shape's own local space (tiles/moves with it); frame = it samples the whole frame's space (the shape is a window onto one continuous field).",
    // A MODE, not a value: animating it would flip between two different sampling
    // spaces mid-tween (a discrete jump), not interpolate a quantity — the same
    // reasoning `layer.shape.phase` vs a `select` control gets elsewhere in this
    // codebase. Opts out of motion; stays agent-settable (the default `agent: true`).
    animatable: false,
  },
  {
    key: 'fill.shader.speed',
    label: 'Speed',
    kind: 'slider',
    min: 0,
    max: 4,
    step: 0.05,
    default: DEFAULT_SHADER_SPEC.speed,
    group: GROUP,
    hint: 'Animation rate multiplier for the effect; 0 = frozen (still).',
  },
]

/**
 * Build one ControlSpec per param the given catalog effect declares, addressed
 * under `<prefix>.p.<paramId>` (see the module doc above for why `.p.`, not
 * `.params.`). Float params become sliders; enum params become selects.
 *
 * Enum params carry `{ label, value: number }` options (see EffectParamDef in
 * ~/lib/shaderfx/types), but ControlSpec's `select` kind only has a flat
 * `options: string[]` — no separate label/value pair. Every other `select` control
 * in this codebase (canvas.layout, layer.blend, ...) stores the option text itself
 * as the value, so there is no existing convention for a numeric-valued enum. This
 * uses each option's LABEL as both the displayed and stored string, matching that
 * convention — resolving a label back to the effect's numeric uniform value is the
 * write-path resolver's job (see the module doc's "known gap"), not this function's.
 */
export function derivedShaderFillControls(effect: EffectDef, prefix: string): ControlSpec[] {
  const out: ControlSpec[] = []
  for (const p of effect.params) {
    const key = `${prefix}.p.${unprefixedKey(p.uniform)}`
    if (p.type === 'enum') {
      const options = p.options ?? []
      const labels = options.map((o) => o.label)
      const defaultLabel = options.find((o) => o.value === p.default)?.label ?? labels[0] ?? ''
      out.push({ key, label: p.label, kind: 'select', options: labels, default: defaultLabel, group: 'Effect' })
    } else {
      out.push({
        key,
        label: p.label,
        kind: 'slider',
        min: p.min ?? 0,
        max: p.max ?? 1,
        step: p.step ?? 0.01,
        default: p.default,
        group: 'Effect',
        // No `animatable` field: sliders are animatable by default (ControlMeta's
        // doc in ~/lib/spacetype/effect.ts), which is the point — motion tracks
        // come free for every effect param without this function opting in per-key.
      })
    }
  }
  return out
}
