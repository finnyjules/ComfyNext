import { describe, it, expect } from 'vitest'
import { SHAPE_CONTROLS, SHAPE_SECTIONS, visibleShapeControls } from '../../app/lib/shapefx/controls'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { makeConfigParams } from '../../app/lib/agent/configParams'
import { shapeAgentControls, SHAPE_GUIDANCE } from '../../app/lib/shapefx/agentControls'

const cfg = (over: any = {}): any => mergeConfig({ ...structuredClone(DEFAULT_CONFIG), ...over })

describe('SHAPE_CONTROLS integrity', () => {
  it('has unique keys', () => {
    const keys = SHAPE_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every control belongs to a declared section', () => {
    for (const c of SHAPE_CONTROLS) {
      expect(SHAPE_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('every select default is one of its own options', () => {
    for (const c of SHAPE_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, `${c.key}`).toContain(c.default)
    }
  })

  it('every slider default sits inside its own range', () => {
    for (const c of SHAPE_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBeGreaterThanOrEqual(c.min)
      expect(c.default, `${c.key} default`).toBeLessThanOrEqual(c.max)
      expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
    }
  })

  it('every key resolves against a real config leaf', () => {
    // The whole point of dotted keys: the agent writes through makeConfigParams.
    // A key that does not resolve is a control the agent can never actually set.
    const c = cfg()
    const params = makeConfigParams(() => c, () => 0)
    const unresolved = SHAPE_CONTROLS.map((s) => s.key).filter((k) => params[k] === undefined)
    expect(unresolved).toEqual([])
  })

  it('every slider default equals the value DEFAULT_CONFIG actually ships', () => {
    // Guards the schema against drifting from the real defaults, which is what
    // v-studio-reset double-click restores to.
    //
    // post.grainAmount and post.grainSize are the deliberate exceptions (Task 8):
    // their declared defaults (0.25 / 2, DEFAULT_POST's neutral "if you turn
    // grain on" starting point — what a reset restores) differ from what a truly
    // fresh DEFAULT_CONFIG-derived shape actually ships with (0.625 / 1) —
    // because DEFAULT_CONFIG.style.grain (20, unchanged since before this task:
    // every brand-new shape has always opened with a touch of grain) migrates
    // through mergeConfig into non-default post.grainAmount/grainSize (grainSize
    // force-pinned to 1 for the same cell-quantisation reason legacy saved docs
    // are). See config.ts's style.grain doc comment and
    // shapefx-config.unit.spec.ts's own coverage of this exact realization.
    const GRAIN_EXCEPTIONS = new Set(['post.grainAmount', 'post.grainSize'])
    const c = cfg()
    const params = makeConfigParams(() => c, () => 0)
    for (const s of SHAPE_CONTROLS) {
      if (s.kind !== 'slider') continue
      if (GRAIN_EXCEPTIONS.has(s.key)) continue
      expect(params[s.key], `${s.key}`).toBe(s.default)
    }
  })
})

describe('visibleShapeControls follows the surface predicates', () => {
  it('offers primitive controls in primitive mode and gem controls in gem mode', () => {
    const prim = visibleShapeControls(cfg({ shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive' } })).map((c) => c.key)
    expect(prim).toContain('shape.primitive')
    expect(prim).toContain('shape.density')
    expect(prim).not.toContain('shape.vertices')

    const gem = visibleShapeControls(cfg({ shape: { ...DEFAULT_CONFIG.shape, mode: 'gem' } })).map((c) => c.key)
    expect(gem).toContain('shape.vertices')
    expect(gem).toContain('shape.depth')
    expect(gem).not.toContain('shape.density')
  })

  it('offers palette controls for facets and fill controls for surface, never both', () => {
    const facets = visibleShapeControls(cfg({ fillMode: 'facets' })).map((c) => c.key)
    expect(facets).toContain('palette.harmony')
    expect(facets.some((k) => k.startsWith('fill.'))).toBe(false)

    const surface = visibleShapeControls(cfg({ fillMode: 'surface' })).map((c) => c.key)
    expect(surface).toContain('fill.type')
    expect(surface.some((k) => k.startsWith('palette.'))).toBe(false)
  })

  it('withholds palette.direction when coloring is scatter', () => {
    const keys = visibleShapeControls(cfg({ fillMode: 'facets', palette: { ...DEFAULT_CONFIG.palette, coloring: 'scatter' } })).map((c) => c.key)
    expect(keys).not.toContain('palette.direction')
  })

  it('returns only members of SHAPE_CONTROLS', () => {
    const all = new Set(SHAPE_CONTROLS.map((c) => c.key))
    for (const c of visibleShapeControls(cfg())) expect(all.has(c.key), c.key).toBe(true)
  })
})

describe('the primitive list cannot drift from the config', () => {
  it('offers exactly the primitives mergeConfig will accept', async () => {
    // controls.ts derives its list from config.ts's PRIMS. If someone adds a 9th
    // primitive, this stays green only because the schema picked it up too.
    const { PRIMS } = await import('../../app/lib/shapefx/config')
    const spec = SHAPE_CONTROLS.find((c) => c.key === 'shape.primitive')!
    expect(spec.kind).toBe('select')
    expect((spec as any).options).toEqual([...PRIMS])
  })
})

describe('shapeAgentControls', () => {
  it('emits plain ControlSpecs with no schema-only fields leaking', () => {
    for (const c of shapeAgentControls(cfg())) {
      expect(c, c.key).not.toHaveProperty('when')
      expect(c, c.key).not.toHaveProperty('agent')
      expect(c, c.key).not.toHaveProperty('animatable')
    }
  })

  it('tracks the layout predicates', () => {
    const facets = shapeAgentControls(cfg({ fillMode: 'facets' })).map((c) => c.key)
    const surface = shapeAgentControls(cfg({ fillMode: 'surface' })).map((c) => c.key)
    expect(facets).toContain('palette.baseHue')
    expect(surface).toContain('fill.type')
    expect(facets).not.toEqual(surface)
  })

  it('is a characterization snapshot for both fill modes', () => {
    expect(shapeAgentControls(cfg({ fillMode: 'facets' }))).toMatchSnapshot()
    expect(shapeAgentControls(cfg({ fillMode: 'surface' }))).toMatchSnapshot()
  })

  it('guidance names only keys that exist in the schema', () => {
    // The guidance is prose fed to the model; a stale key name silently teaches it
    // to set something that will be dropped by validatePatch.
    const keys = new Set(SHAPE_CONTROLS.map((c) => c.key))
    for (const m of SHAPE_GUIDANCE.matchAll(/\b(?:shape|palette|fill|style)\.[a-zA-Z.]+/g)) {
      expect(keys.has(m[0]), `guidance names unknown key ${m[0]}`).toBe(true)
    }
  })
})
