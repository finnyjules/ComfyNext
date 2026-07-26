import { describe, it, expect } from 'vitest'
import { gradientAgentControls } from '../../app/lib/gradientfx/agentControls'
import { defaultConfig } from '../../app/lib/gradientfx/randomize'
import { makeConfigParams } from '../../app/lib/agent/configParams'
import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { GRADIENT_CONTROLS, GRADIENT_SECTIONS, visibleGradientControls } from '../../app/lib/gradientfx/controls'

/**
 * Characterization tests. These pin the CURRENT output of gradientAgentControls
 * so converting it into a derivation over GRADIENT_CONTROLS is provably
 * behaviour-preserving. A change here means the agent's vocabulary moved, which
 * silently breaks saved Collection bindings (`params.<key>`) and the key strings
 * baked into GRADIENT_GUIDANCE.
 *
 * Note: the brief that spawned this file assumed a zero-arg default-config
 * factory lives in `app/lib/gradientfx/types.ts`. The real factory is
 * `defaultConfig` from `app/lib/gradientfx/randomize.ts` (types.ts only has
 * `ensureConfigDefaults`, which needs an existing GradientConfig-shaped input).
 * `defaultConfig(seed = randomSeed())` is effectively zero-arg for our purposes;
 * the random seed has no effect on gradientAgentControls's output (it never
 * reads cfg.seed, and every slider's `default` field is hardcoded to 0), so the
 * snapshots below are deterministic despite the random seed.
 */

function cfgWithLayout(layout: string) {
  const c: any = defaultConfig()
  c.canvas.layout = layout
  // Match how the app actually loads a config: loadConfig() always normalizes
  // through ensureConfigDefaults, which backfills focus/center/light/flow and
  // (for mesh layouts) layer 0's mesh points. Characterizing an un-normalized
  // config would pin behavior that never occurs at runtime.
  return ensureConfigDefaults(c)
}

const LAYOUTS_UNDER_TEST = ['linear', 'radial', 'orbit', 'liquid', 'mesh'] as const

describe('gradientAgentControls characterization', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    it(`emits stable full specs for layout=${layout}`, () => {
      expect(gradientAgentControls(cfgWithLayout(layout))).toMatchSnapshot()
    })
  }

  it('emits stable specs with includePreset', () => {
    expect(gradientAgentControls(cfgWithLayout('linear'), { includePreset: true })).toMatchSnapshot()
  })

  it('includePreset adds exactly one control, at the front', () => {
    const withPreset = gradientAgentControls(cfgWithLayout('linear'), { includePreset: true })
    const without = gradientAgentControls(cfgWithLayout('linear'))
    expect(withPreset).toHaveLength(without.length + 1)
    expect(withPreset[0]!.key).toBe('preset')
  })

  it('emits focus.angle only when focus.shape is linear', () => {
    const off: any = cfgWithLayout('linear')
    expect(gradientAgentControls(off).some((c) => c.key === 'focus.angle')).toBe(false)
    const lin: any = cfgWithLayout('linear')
    lin.focus = { ...(lin.focus ?? {}), shape: 'linear' }
    expect(gradientAgentControls(lin).some((c) => c.key === 'focus.angle')).toBe(true)
  })

  it('emits one colour control per stop, in ramp order', () => {
    const cfg: any = cfgWithLayout('linear')
    const stops = cfg.layers[0].color.stops.length
    const colours = gradientAgentControls(cfg).filter((c) => c.key.startsWith('layer.color.stops.'))
    expect(colours).toHaveLength(stops)
    expect(colours[0]!.key).toBe('layer.color.stops.0.color')
    expect(colours[0]!.label).toBe('Colour 1')
  })
})

describe('gradientAgentControls integrity', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    it(`every emitted key resolves against a real config leaf for layout=${layout}`, () => {
      const cfg = cfgWithLayout(layout)
      const params = makeConfigParams(() => cfg, () => 0)
      const unresolved = gradientAgentControls(cfg)
        .map((c) => c.key)
        .filter((k) => params[k] === undefined)
      expect(unresolved).toEqual([])
    })

    it(`has no duplicate keys for layout=${layout}`, () => {
      const keys = gradientAgentControls(cfgWithLayout(layout)).map((c) => c.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it(`every slider declares a finite range for layout=${layout}`, () => {
      for (const c of gradientAgentControls(cfgWithLayout(layout))) {
        if (c.kind !== 'slider') continue
        expect(Number.isFinite(c.min), `${c.key} min`).toBe(true)
        expect(Number.isFinite(c.max), `${c.key} max`).toBe(true)
        expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
      }
    })
  }
})

describe('GRADIENT_CONTROLS schema integrity', () => {
  it('has unique keys', () => {
    const keys = GRADIENT_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every control belongs to a declared section', () => {
    for (const c of GRADIENT_CONTROLS) {
      expect(GRADIENT_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('every select default is one of its own options', () => {
    for (const c of GRADIENT_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, `${c.key} options`).toContain(c.default)
    }
  })

  it('every slider keeps the inert default of 0', () => {
    for (const c of GRADIENT_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBe(0)
    }
  })

  it('visibleGradientControls only returns members of GRADIENT_CONTROLS or synthesized colour controls', () => {
    // Colour controls have runtime cardinality (one per gradient stop / mesh point) and
    // are deliberately NOT in the static GRADIENT_CONTROLS array — see the "Colours:
    // runtime cardinality" comment in controls.ts. Allow that documented pattern through.
    const all = new Set(GRADIENT_CONTROLS.map((c) => c.key))
    const colourKey = /^layer\.(color\.stops|mesh\.points)\.\d+\.color$/
    for (const c of visibleGradientControls(defaultConfig() as any)) {
      expect(all.has(c.key) || colourKey.test(c.key), `${c.key} not in GRADIENT_CONTROLS`).toBe(true)
    }
  })

  it('declares Shape controls that are withheld from the agent', () => {
    const shape = GRADIENT_CONTROLS.filter((c) => c.group === 'Shape')
    expect(shape.length).toBeGreaterThan(0)
    for (const c of shape) expect((c as any).agent, `${c.key}`).toBe(false)
  })
})

describe('relief light is offered where it actually does something', () => {
  // Ground truth is the shader: shaders.ts gates the u_light branch on
  // `u_layout < 3.5` (linear/radial/orbit/stack), and the liquid branch is explicit
  // that it uses "its own light, not u_light". The legacy agent builder had these
  // under isLiquid — exactly inverted — so the agent was offered them where they do
  // nothing and denied them where they work. This pins the corrected placement.
  const lightKeys = ['relief.light.azimuth', 'relief.light.elevation']

  for (const layout of ['linear', 'radial', 'orbit'] as const) {
    it(`offers the light controls for the banded layout ${layout}`, () => {
      const keys = gradientAgentControls(cfgWithLayout(layout)).map((c) => c.key)
      for (const k of lightKeys) expect(keys, `${layout} / ${k}`).toContain(k)
    })
  }

  for (const layout of ['liquid', 'mesh'] as const) {
    it(`withholds the light controls for ${layout}, where u_light is unused`, () => {
      const keys = gradientAgentControls(cfgWithLayout(layout)).map((c) => c.key)
      for (const k of lightKeys) expect(keys, `${layout} / ${k}`).not.toContain(k)
    })
  }
})
