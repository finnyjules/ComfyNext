// The Shader Studio's agent VOCABULARY (2026-08-25 tuner upgrade): the ungated
// stage controls, the `effect` macro, and the guidance derived from the live
// catalog. Everything here is checked against the REAL manifest the backend
// serves — the same list the studio's own picker enumerates — so a renamed or
// deleted effect fails here rather than teaching the model a name that is gone.
import { describe, expect, it, vi } from 'vitest'

// studioTune is imported only for the honesty clause it owns; ofetch (its network
// seam) is not resolvable in the unit environment, so stub it as that spec does.
vi.mock('ofetch', () => ({ $fetch: () => { throw new Error('no network in unit tests') } }))

import { readFileSync } from 'node:fs'
import catalogJson from '../../../shader_effects/manifest.json'
import type { EffectDef } from '~/lib/shaderfx/types'
import { defaultConfig, EFFECT_SWITCH_RESET_FIELDS, ensureEffectMasks, switchStudioEffect } from '~/lib/shaderstudio/types'
import {
  buildShaderGuidance,
  effectsWithUnsettableModes,
  shaderAgentControls,
  shaderEffectIndex,
  shaderEffectMacro,
  SHADER_EFFECT_MACRO_KEY,
  SHADER_GUIDANCE_CEILING,
  SHADER_HONESTY_CLAUSE,
  SHADER_LOOK_CLUSTERS,
  SHADER_TUNE_EXAMPLES,
} from '~/lib/shaderstudio/agentControls'
import { makeConfigParams } from '~/lib/agent/configParams'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import { APPROXIMATION_HONESTY_GUIDANCE } from '~/lib/agent/studioTune'

const CATALOG = (catalogJson as { effects: EffectDef[] }).effects
const byId = new Map(CATALOG.map(e => [e.id, e]))

/** A config with a real effect selected + resting masks — what the tuner describes. */
function cfgWith(effectId: string) {
  const cfg = defaultConfig()
  ensureEffectMasks(cfg)
  switchStudioEffect(cfg, 0, byId.get(effectId)!)
  return cfg
}

describe('stage vocabulary (the deliberate ungating grant)', () => {
  // Was: a stage's controls appeared only once the stage was already ON, which
  // made "add a bloom" unsayable — the bloom knobs did not exist to be set.
  it('offers every stage’s enable switch AND its params on an all-off config', () => {
    const keys = new Map(shaderAgentControls(defaultConfig(), null).map(c => [c.key, c]))
    for (const k of ['duotone.enabled', 'gradientMap.enabled', 'adjust.enabled', 'post.blur.enabled', 'post.chromatic.enabled', 'post.bloom.enabled']) {
      expect(keys.get(k)?.kind, `${k} must be an agent-settable switch`).toBe('switch')
    }
    for (const k of ['duotone.ink', 'duotone.paper', 'gradientMap.mix', 'adjust.saturation', 'adjust.temperature', 'post.blur.maxBlur', 'post.chromatic.amount', 'post.bloom.intensity']) {
      expect(keys.has(k), `${k} must be offered even while its stage is off`).toBe(true)
    }
  })

  it('lets ONE patch enable a stage and tune it (the whole point of the grant)', () => {
    const cfg = defaultConfig()
    const params = makeConfigParams(() => cfg)
    const described = describeControls(shaderAgentControls(cfg, null), params)
    const patch = validatePatch({ 'post.bloom.enabled': 'true', 'post.bloom.intensity': 2.2 }, described)
    for (const [k, v] of Object.entries(patch)) params[k] = v
    expect(cfg.post.bloom.enabled).toBe(true)
    expect(cfg.post.bloom.intensity).toBe(2.2)
  })
})

describe('every offered key addresses a real config leaf (dead-property guard)', () => {
  // The dotted-path writer CREATES missing intermediates, so a key that does not
  // already exist on the config writes junk that is saved and never rendered.
  it('writes then reads back every control through makeConfigParams', () => {
    const cfg = cfgWith('halftone')
    const params = makeConfigParams(() => cfg)
    const controls = shaderAgentControls(cfg, byId.get('halftone')!, 0, { catalog: CATALOG })
    for (const c of controls) {
      if (c.key === SHADER_EFFECT_MACRO_KEY) continue // a verb, asserted below
      expect(params[c.key], `${c.key} does not exist on the config — dead property`).not.toBeUndefined()
      const probe = c.kind === 'switch' ? true : c.kind === 'slider' ? c.min : c.default
      params[c.key] = probe as never
      expect(params[c.key], `${c.key} did not read back what was written`).toBe(probe)
    }
  })

  it('the `effect` macro is the ONLY key that is not a config leaf', () => {
    const cfg = cfgWith('halftone')
    const params = makeConfigParams(() => cfg)
    const orphans = shaderAgentControls(cfg, byId.get('halftone')!, 0, { catalog: CATALOG })
      .filter(c => params[c.key] === undefined)
      .map(c => c.key)
    expect(orphans).toEqual([SHADER_EFFECT_MACRO_KEY])
  })
})

describe('mask vocabulary', () => {
  it('is offered whether or not the mask is ON, once the layer HAS a mask', () => {
    const cfg = cfgWith('halftone')
    expect(cfg.effects[0]!.mask!.enabled).toBe(false)
    const keys = new Map(shaderAgentControls(cfg, byId.get('halftone')!).map(c => [c.key, c]))
    expect(keys.get('effects.0.mask.enabled')?.kind).toBe('switch')
    expect(keys.get('effects.0.mask.shape')?.kind).toBe('select')
    expect(keys.has('effects.0.mask.size')).toBe(true)
  })

  it('is WITHHELD on a layer with no mask object, so nothing fabricates a half-built one', () => {
    const cfg = defaultConfig()
    switchStudioEffect(cfg, 0, byId.get('halftone')!) // no ensureEffectMasks
    expect(cfg.effects[0]!.mask).toBeUndefined()
    expect(shaderAgentControls(cfg, byId.get('halftone')!).some(c => c.key.includes('.mask.'))).toBe(false)
  })
})

describe('the `effect` macro', () => {
  it('offers every catalog id, in catalog order, only when a catalog is passed', () => {
    const macro = shaderEffectMacro(CATALOG, 'halftone')!
    expect(macro.key).toBe('effect')
    expect(macro.kind).toBe('select')
    expect((macro as { options: string[] }).options).toEqual(CATALOG.map(e => e.id))
    expect(shaderEffectMacro(null)).toBeNull()
    expect(shaderEffectMacro([])).toBeNull()
    expect(shaderAgentControls(defaultConfig(), null).some(c => c.key === 'effect')).toBe(false)
  })

  it('switchStudioEffect seeds the new effect’s defaults and preserves the layer’s identity', () => {
    const cfg = cfgWith('gaussian_blur')
    const before = cfg.effects[0]!
    const { layerId, blend, opacity, enabled, mask } = before
    expect(before.params.u_radius).toBeDefined()
    switchStudioEffect(cfg, 0, byId.get('halftone')!)
    const after = cfg.effects[0]!
    expect(after.id).toBe('halftone')
    expect(after.params.u_angle).toBe(45)         // a param unique to the NEW effect
    expect(after.params.u_radius).toBeUndefined() // the old effect's uniform is gone
    expect({ layerId: after.layerId, blend: after.blend, opacity: after.opacity, enabled: after.enabled, mask: after.mask })
      .toEqual({ layerId, blend, opacity, enabled, mask })
  })
})

describe('switchStudioEffect stays equivalent to the surface’s pickEffect', () => {
  // The two are PARALLEL implementations: the spec wanted one seam, but
  // ShaderStudioSurface.vue had foreign WIP when this landed, so the .vue keeps
  // its own hand-written copy. This pin is what stops them drifting — the next
  // field added to StudioEffect that a switch must clear has to appear in BOTH,
  // or this fails. (Both sites carry a comment naming the other.)
  const vue = readFileSync(new URL('../../app/components/vue-canvas/ShaderStudioSurface.vue', import.meta.url), 'utf8')

  /** The fields `pickEffect` assigns after its spread, read out of the source. */
  function pickEffectResetFields(src: string): string[] {
    const at = src.indexOf('function pickEffect')
    expect(at, 'pickEffect not found — the twin was renamed; update this pin').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}', at))
    const line = body.split('\n').find(l => l.includes('= {') && l.includes('...'))
    expect(line, 'pickEffect no longer assigns a spread object literal').toBeTruthy()
    // Everything after the spread expression's trailing comma, minus the closing brace.
    const tail = line!.slice(line!.indexOf('...')).replace(/\}\s*$/, '')
    return tail.split(',').slice(1)
      .map(seg => /^\s*([A-Za-z_$][\w$]*)/.exec(seg)?.[1])
      .filter((f): f is string => !!f)
  }

  it('resets exactly the same field set on both sides', () => {
    const fromVue = pickEffectResetFields(vue)
    expect(fromVue.length, 'extracted no fields — the pin is not actually reading the twin').toBeGreaterThan(0)
    expect([...fromVue].sort()).toEqual([...EFFECT_SWITCH_RESET_FIELDS].sort())
  })

  it('preserves every OTHER field of the layer, on the lib side', () => {
    const cfg = cfgWith('gaussian_blur')
    const before = { ...cfg.effects[0]! }
    switchStudioEffect(cfg, 0, byId.get('halftone')!)
    const after = cfg.effects[0]!
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      if ((EFFECT_SWITCH_RESET_FIELDS as readonly string[]).includes(k)) continue
      expect(after[k], `${k} must survive an effect switch`).toEqual(before[k])
    }
  })

  it('is a NO-OP for the effect that is already selected (never a silent reset)', () => {
    const cfg = cfgWith('halftone')
    cfg.effects[0]!.params = { u_size: 0.08, u_angle: 15, u_softness: 0.4 }
    switchStudioEffect(cfg, 0, byId.get('halftone')!)
    expect(cfg.effects[0]!.params).toEqual({ u_size: 0.08, u_angle: 15, u_softness: 0.4 })
  })
})

describe('derived effect index (auto-syncs with the catalog)', () => {
  const index = shaderEffectIndex(CATALOG)
  const listed = index.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' · ')[0]!)

  it('lists every catalog id exactly once and nothing else', () => {
    expect([...listed].sort()).toEqual(CATALOG.map(e => e.id).sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('groups under a header per category, covering every category present', () => {
    const cats = new Set(CATALOG.map(e => e.category.toUpperCase()))
    for (const c of cats) expect(index).toContain(`\n${c}\n`.trim())
  })
})

describe('look-word clusters resolve to REAL effect ids', () => {
  it.each(SHADER_LOOK_CLUSTERS)('$words', ({ ids }) => {
    for (const id of ids) expect(byId.has(id), `${id} is not in the shader catalog`).toBe(true)
  })
  it('names no id twice within one cluster', () => {
    for (const c of SHADER_LOOK_CLUSTERS) expect(new Set(c.ids).size).toBe(c.ids.length)
  })
})

describe('worked examples are valid patches, not plausible-looking ones', () => {
  it.each(SHADER_TUNE_EXAMPLES)('$ask', ({ patch }) => {
    const id = patch.effect as string
    const def = byId.get(id)
    expect(def, `example picks unknown effect "${id}"`).toBeTruthy()

    // Build the config the example DESCRIBES: the effect switched in, masks
    // materialized — then validate the example against that exact vocabulary.
    const cfg = defaultConfig()
    ensureEffectMasks(cfg)
    switchStudioEffect(cfg, 0, def!)
    const params = makeConfigParams(() => cfg)
    const described = describeControls(shaderAgentControls(cfg, def!, 0, { catalog: CATALOG }), params)
    const { effect: _macro, ...scalars } = patch
    const kept = validatePatch(scalars as Record<string, string | number | boolean>, described)
    expect(Object.keys(kept).sort(), 'every example key must survive validatePatch').toEqual(Object.keys(scalars).sort())

    // …and every uniform named belongs to THIS effect.
    for (const k of Object.keys(scalars)) {
      const m = /^effects\.0\.params\.(.+)$/.exec(k)
      if (m) expect(def!.params.some(p => p.uniform === m[1]), `${m[1]} is not a uniform of ${id}`).toBe(true)
    }
  })
})

describe('guidance', () => {
  const full = buildShaderGuidance(CATALOG)

  // NOT byte-equality with Texture's: Texture is a COMMAND surface ("the commands
  // above", answer in `message`), Shader is a param-patch surface (controls,
  // answer in `rationale`). Pinning them identical would force one of them to
  // name a protocol it is not using. What must hold is the SUBSTANCE.
  const HONESTY_CORE = [
    'do not force an exact match: configure the closest approximation you can',
    'name the requested look and state plainly that this only approximates it',
    'Never present an approximation as an exact match.',
  ]
  it('carries Texture’s honesty clause in substance, in this surface’s own nouns', () => {
    for (const core of HONESTY_CORE) {
      expect(SHADER_HONESTY_CLAUSE, `shader clause lost: ${core}`).toContain(core)
      expect(APPROXIMATION_HONESTY_GUIDANCE, `texture clause lost: ${core}`).toContain(core)
    }
    // …and it speaks to THIS protocol, not the command surface's.
    expect(SHADER_HONESTY_CLAUSE).toContain('"rationale"')
    expect(SHADER_HONESTY_CLAUSE).not.toContain('commands above')
    expect(full).toContain(SHADER_HONESTY_CLAUSE)
  })

  it('names the effects whose MODES the agent cannot set, derived from the catalog', () => {
    const withEnums = effectsWithUnsettableModes(CATALOG)
    expect(withEnums.length).toBeGreaterThan(0)
    expect(withEnums.sort()).toEqual(CATALOG.filter(e => e.params.some(p => p.type === 'enum')).map(e => e.id).sort())
    expect(full).toContain('MODES YOU CANNOT SET')
    for (const id of withEnums) expect(full, `${id} not named in the modes caveat`).toContain(id)
  })

  it('does not promise look-words that need an unsettable mode', () => {
    // crystal_prism only reads as "prismatic"/"chrome" in a non-default u_mode;
    // nothing in the catalog does "anamorphic" at all.
    const clusterWords = SHADER_LOOK_CLUSTERS.map(c => c.words).join(' ').toLowerCase()
    for (const word of ['prismatic', 'chrome', 'anamorphic']) {
      expect(clusterWords, `"${word}" promises a look the patch cannot reach`).not.toContain(word)
    }
  })

  it('addresses the layer the tuner actually offers (effects.0, not effects.N)', () => {
    expect(full).not.toMatch(/effects\.N\./)
    expect(full).toContain('effects.0.params.*')
  })

  it('teaches the ordering contract (effect first, then that effect’s params)', () => {
    expect(full).toMatch(/PICK THE EFFECT FIRST/)
    expect(full).toMatch(/OLD effect are dropped/)
  })

  it('degrades EXPLICITLY with no catalog — a stated limit, never an empty index', () => {
    const degraded = buildShaderGuidance(null)
    expect(degraded).toContain('EFFECT LIST UNAVAILABLE')
    expect(degraded).not.toContain('EFFECTS YOU MAY PICK')
    expect(degraded).not.toContain('LOOK WORDS')
    expect(degraded).toContain(SHADER_HONESTY_CLAUSE)
    // No effect id survives into the degraded text (the clusters/examples are gone).
    for (const id of ['block_glitch', 'halftone', 'gaussian_blur']) expect(degraded).not.toContain(id)
  })

  it('fits the stated prompt budget', () => {
    expect(full.length, `shader guidance is ${full.length} chars`).toBeLessThanOrEqual(SHADER_GUIDANCE_CEILING)
  })
})
