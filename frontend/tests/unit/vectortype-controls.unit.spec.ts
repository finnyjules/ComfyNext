/**
 * Vector Type — the declarative control schema.
 *
 * The schema is the factory: one `ControlSpec[]` list feeds the agent, motion,
 * Collection sweeps and the inspector. These tests pin the two ways that goes
 * silently wrong — a key that does not resolve against the config (a control
 * that does nothing), and guidance prose naming a key that does not exist (a
 * patch `validatePatch` drops without a word) — plus the strictness of
 * `mergeConfig`, which is all that stands between a saved blob and the renderer.
 *
 * NO NETWORK. Where a real font is needed, it is the same local Inter subset the
 * outline spec uses.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, it, expect, vi } from 'vitest'

/**
 * The shader-fx catalog is a NETWORK resource (`$fetch('/sailor/shader_effects')`),
 * and `getEffectSync` reads whatever a page has already fetched. That module-level
 * cache is the seam: mocking it hands `vtAgentControls` a real-shaped `EffectDef`
 * without a request, and lets a test also exercise the "catalog has not resolved
 * this id" branch, which is otherwise unreachable offline.
 *
 * The mocked effect deliberately declares BOTH param types — a float and an enum —
 * because `derivedShaderFillControls` addresses them through two different code
 * paths and only the float one would be covered by a single-param fixture.
 */
const { CATALOG_EFFECT } = vi.hoisted(() => ({
  CATALOG_EFFECT: {
    id: 'kaleidoscope',
    name: 'Kaleidoscope',
    params: [
      { uniform: 'u_segments', label: 'Segments', type: 'float', min: 2, max: 24, default: 6 },
      { uniform: 'u_zoom', label: 'Zoom', type: 'float', min: 0.1, max: 4, default: 1 },
      { uniform: 'u_mode', label: 'Mode', type: 'enum', default: 0, options: [{ label: 'Wedge', value: 0 }, { label: 'Nested', value: 1 }] },
    ],
  } as any,
}))
vi.mock('~/lib/shaderfx/catalog', () => ({
  getEffectSync: (id: string) => (id === CATALOG_EFFECT.id ? CATALOG_EFFECT : null),
}))

import { makeConfigParams } from '~/lib/agent/configParams'
import { DEFAULT_FILL, paintPrimaryColor } from '~/lib/spacetype/fillTile'
import { isValidAxisTag, normaliseAxes, type VtAxis } from '~/lib/vectortype/font'
import { animatableTargets } from '~/lib/vectortype/motion'
import {
  DEFAULT_CONFIG,
  VT_ALIGNS,
  VT_FILL_ANCHORS,
  VT_FONT_IDS,
  cloneConfig,
  isAxisTag,
  mergeConfig,
  type VectorTypeConfig,
} from '~/lib/vectortype/config'
import {
  VT_AXES_GROUP,
  VT_CONTROLS,
  VT_SECTIONS,
  derivedAxisControls,
  visibleVtControls,
} from '~/lib/vectortype/controls'
import { VT_GUIDANCE, vtAgentControls } from '~/lib/vectortype/agentControls'
import { SHADER_FILL_CONTROLS, derivedShaderFillControls } from '~/lib/shaderfill/controls'

const cfg = (over: Partial<VectorTypeConfig> = {}): VectorTypeConfig =>
  mergeConfig({ ...cloneConfig(DEFAULT_CONFIG), ...over })

const paramsFor = (c: VectorTypeConfig) => makeConfigParams(() => c, () => 0)

/** A Roboto-Flex-shaped axis set: two familiar axes and two exotic ones, so the
 *  derived vocabulary is exercised on the tags the design doc calls the point. */
const RICH_AXES: VtAxis[] = [
  { tag: 'wght', name: 'Weight', min: 100, max: 1000, default: 400 },
  { tag: 'wdth', name: 'Width', min: 25, max: 151, default: 100 },
  { tag: 'GRAD', name: 'Grade', min: -200, max: 150, default: 0 },
  { tag: 'XOPQ', name: 'Thick stroke', min: 27, max: 175, default: 96 },
]

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))
function fixtureAxes(): VtAxis[] {
  const raw: any = (fontkit as any).create(new Uint8Array(readFileSync(FIXTURE)))
  return normaliseAxes(raw?.variationAxes)
}

describe('VT_CONTROLS integrity', () => {
  it('declares a non-empty schema', () => {
    // Guards every loop below from passing vacuously over an empty list.
    expect(VT_CONTROLS.length).toBeGreaterThan(0)
  })

  it('has unique keys', () => {
    const keys = VT_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every control belongs to a declared section', () => {
    for (const c of VT_CONTROLS) {
      expect(VT_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('reserves the derived-axis section without declaring a static member in it', () => {
    // "Declare the frame, derive the contents": the section exists in the schema,
    // its contents come from the loaded font.
    expect(VT_SECTIONS).toContain(VT_AXES_GROUP)
    expect(VT_CONTROLS.filter((c) => c.group === VT_AXES_GROUP)).toEqual([])
  })

  it('keeps the axes namespace clear of static keys', () => {
    // A static `axes.something` would collide with a derived key the moment a
    // font declared that tag, and the collision would be silent.
    for (const c of VT_CONTROLS) expect(c.key.startsWith('axes.'), c.key).toBe(false)
  })

  it('every select default is one of its own options', () => {
    for (const c of VT_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, `${c.key}`).toContain(c.default)
    }
  })

  it('every slider default sits inside its own range', () => {
    for (const c of VT_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBeGreaterThanOrEqual(c.min)
      expect(c.default, `${c.key} default`).toBeLessThanOrEqual(c.max)
      expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
    }
  })

  it('every colour default is the #rrggbb form validatePatch accepts', () => {
    for (const c of VT_CONTROLS) {
      if (c.kind !== 'color') continue
      expect(c.default, `${c.key}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('every key resolves against a real config leaf', () => {
    // The whole point of dotted keys: the agent, motion and Collection bindings
    // all write through makeConfigParams. A key that does not resolve is a
    // control that silently does nothing.
    const params = paramsFor(cfg({ strokeWidth: 4 }))
    const unresolved = VT_CONTROLS.map((s) => s.key).filter((k) => params[k] === undefined)
    expect(unresolved).toEqual([])
  })

  it('the resolution probe detects a key that does NOT resolve', () => {
    // Proves the test above is not vacuous: the same probe returns undefined for
    // a key with no leaf behind it. (Confirmed by hand too — renaming a real key
    // in VT_CONTROLS turns the test above red.)
    const params = paramsFor(cfg())
    expect(params.fill).toBeDefined()
    expect(params['nope']).toBeUndefined()
    expect(params['fill.deeper']).toBeUndefined()
    // Sparse by design: an unset axis has no leaf until it is written.
    expect(params['axes.wght']).toBeUndefined()
  })

  it('every slider default equals the value DEFAULT_CONFIG actually ships', () => {
    const params = paramsFor(cfg())
    for (const s of VT_CONTROLS) {
      if (s.kind !== 'slider') continue
      expect(params[s.key], `${s.key}`).toBe(s.default)
    }
  })

  it('offers exactly the font ids mergeConfig will accept', () => {
    // controls.ts derives its option list from config.ts's VT_FONT_IDS, which is
    // derived from the catalog. Adding a family cannot leave the picker behind.
    const spec = VT_CONTROLS.find((c) => c.key === 'fontId')!
    expect(spec.kind).toBe('select')
    expect((spec as any).options).toEqual(VT_FONT_IDS)
    expect(VT_FONT_IDS).toContain(DEFAULT_CONFIG.fontId)
  })
})

describe('visibleVtControls follows the surface predicates', () => {
  it('withholds the stroke colour until the stroke has width', () => {
    expect(visibleVtControls(cfg({ strokeWidth: 0 })).map((c) => c.key)).not.toContain('stroke')
    expect(visibleVtControls(cfg({ strokeWidth: 3 })).map((c) => c.key)).toContain('stroke')
  })

  it('emits in VT_SECTIONS order', () => {
    const groups = visibleVtControls(cfg({ strokeWidth: 3 })).map((c) => c.group)
    const order = groups.map((g) => VT_SECTIONS.indexOf(g as any))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('returns only members of VT_CONTROLS', () => {
    const all = new Set(VT_CONTROLS.map((c) => c.key))
    for (const c of visibleVtControls(cfg({ strokeWidth: 3 }))) expect(all.has(c.key), c.key).toBe(true)
  })
})

describe('derivedAxisControls — declare the frame, derive the contents', () => {
  it('derives one slider per axis of a REAL parsed variable font', () => {
    const axes = fixtureAxes()
    const derived = derivedAxisControls(axes)
    expect(derived.map((c) => c.key)).toEqual(axes.map((a) => `axes.${a.tag}`))
    expect(derived.map((c) => c.key)).toContain('axes.wght')
    for (const c of derived) {
      expect(c.kind).toBe('slider')
      expect(c.group).toBe(VT_AXES_GROUP)
    }
  })

  it('takes range and default from the font, not from a hand-written list', () => {
    const [wght] = derivedAxisControls([RICH_AXES[0]!]) as any[]
    expect(wght.min).toBe(100)
    expect(wght.max).toBe(1000)
    expect(wght.default).toBe(400)
    expect(wght.label).toBe('Weight')
  })

  it('derived keys resolve against the config once the axis is set', () => {
    const c = cfg({ axes: { wght: 700, XOPQ: 120 } })
    const params = paramsFor(c)
    for (const spec of derivedAxisControls(RICH_AXES)) {
      const set = spec.key === 'axes.wght' || spec.key === 'axes.XOPQ'
      expect(params[spec.key] !== undefined, spec.key).toBe(set)
    }
    expect(params['axes.wght']).toBe(700)
  })

  it('writing a derived key lands on the real axes record', () => {
    // The failure this guards is the one shader fills paid for: a key one segment
    // off the real path writes to a phantom object and never reaches the renderer.
    const c = cfg()
    const params = paramsFor(c)
    params['axes.GRAD'] = -80
    expect(c.axes.GRAD).toBe(-80)
    expect((c as any).axes.axes).toBeUndefined()
  })

  it('gives sub-unit axes a fine step and wide axes a whole one', () => {
    const [casl] = derivedAxisControls([{ tag: 'CASL', name: 'Casual', min: 0, max: 1, default: 0 }]) as any[]
    const [wght] = derivedAxisControls([RICH_AXES[0]!]) as any[]
    expect(casl.step).toBe(0.01)
    expect(wght.step).toBe(1)
  })

  it('every derived slider is a laid-out slider: max > min, default inside', () => {
    for (const c of derivedAxisControls([...RICH_AXES, ...fixtureAxes()]) as any[]) {
      expect(c.max, c.key).toBeGreaterThan(c.min)
      expect(c.default, c.key).toBeGreaterThanOrEqual(c.min)
      expect(c.default, c.key).toBeLessThanOrEqual(c.max)
    }
  })

  it('drops a zero-width axis rather than emitting an undraggable slider', () => {
    expect(derivedAxisControls([{ tag: 'DEAD', name: 'Dead', min: 5, max: 5, default: 5 }])).toEqual([])
  })

  it('is empty for a font that has not loaded yet', () => {
    expect(derivedAxisControls([])).toEqual([])
    expect(derivedAxisControls(undefined as any)).toEqual([])
  })

  it('leaves axis sliders animatable — the headline of the studio', () => {
    for (const c of derivedAxisControls(RICH_AXES)) {
      expect((c as any).animatable, c.key).not.toBe(false)
    }
  })
})

describe('the axis-tag rule cannot drift from the font layer', () => {
  it('config.isAxisTag agrees with font.isValidAxisTag', () => {
    // config.ts keeps its own copy so it never drags fontkit into the Collection
    // resolver; this is what stops the copy from diverging.
    const samples: unknown[] = [
      'wght', 'XOPQ', 'ital', 'a b ', 'abc', 'abcde', '', '  ', 'wghté', 'wg\nt',
      null, undefined, 42, {}, ['wght'],
    ]
    for (const s of samples) expect(isAxisTag(s), String(s)).toBe(isValidAxisTag(s))
  })
})

describe('mergeConfig is a strict rebuild', () => {
  it('returns the defaults for nothing at all', () => {
    for (const junk of [null, undefined, {}, [], 'nope', 42, true, NaN]) {
      expect(mergeConfig(junk), String(junk)).toEqual(DEFAULT_CONFIG)
    }
  })

  it('round-trips its own default and is idempotent', () => {
    expect(mergeConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG)
    const once = mergeConfig({ fontId: 'roboto-flex', axes: { wght: 900 }, strokeWidth: 3, motion: { tracks: [{ path: 'axes.wght', from: 100, to: 900, easing: 'pingpong', loops: 2, hold: 0.1, cycleOffset: 0.25, delay: 0.5 }] } })
    expect(mergeConfig(once)).toEqual(once)
  })

  it('replaces a wrong-typed field with the default, field by field', () => {
    const c = mergeConfig({
      text: 12, fontId: {}, axes: 'wght', size: 'big', tracking: null,
      align: 'diagonal', fill: [], stroke: 7, strokeWidth: 'thick', motion: 'later',
    })
    expect(c).toEqual(DEFAULT_CONFIG)
  })

  it('rejects NaN and Infinity on every numeric field', () => {
    const c = mergeConfig({ size: NaN, tracking: Infinity, strokeWidth: -Infinity })
    expect(c.size).toBe(DEFAULT_CONFIG.size)
    expect(c.tracking).toBe(DEFAULT_CONFIG.tracking)
    expect(c.strokeWidth).toBe(DEFAULT_CONFIG.strokeWidth)
  })

  it('falls back to the default font for an id the catalog does not have', () => {
    expect(mergeConfig({ fontId: 'helvetica-neue' }).fontId).toBe(DEFAULT_CONFIG.fontId)
    expect(mergeConfig({ fontId: 'roboto-flex' }).fontId).toBe('roboto-flex')
  })

  it('accepts every align the schema offers', () => {
    for (const a of VT_ALIGNS) expect(mergeConfig({ align: a }).align).toBe(a)
  })

  it('keeps the text verbatim, however long', () => {
    // Truncating here would silently rewrite a saved project; bounding the INPUT
    // is the surface's job.
    const long = 'A'.repeat(500)
    expect(mergeConfig({ text: long }).text).toBe(long)
    expect(mergeConfig({ text: '' }).text).toBe('')
  })

  describe('axes', () => {
    it('keeps four-char tags with finite numeric values', () => {
      expect(mergeConfig({ axes: { wght: 650, XOPQ: 96.5, GRAD: -80 } }).axes)
        .toEqual({ wght: 650, XOPQ: 96.5, GRAD: -80 })
    })

    it('drops malformed tags and non-numeric values', () => {
      expect(mergeConfig({
        axes: { weight: 700, wg: 1, wght: '700', opsz: NaN, slnt: null, ital: {}, wdth: 100 },
      }).axes).toEqual({ wdth: 100 })
    })

    it('KEEPS a tag the current font does not declare', () => {
      // Deliberate: the config layer does not know which font is loaded, and
      // switching font away and back must not discard the values you set.
      // clampCoords drops unknown tags at render time instead.
      expect(mergeConfig({ fontId: 'inter', axes: { CASL: 1 } }).axes).toEqual({ CASL: 1 })
    })

    it('survives an axes value that is not an object', () => {
      for (const junk of [null, [1, 2], 'wght=700', 5]) {
        expect(mergeConfig({ axes: junk }).axes, String(junk)).toEqual({})
      }
    })
  })

  describe('motion', () => {
    it('drops a track that targets nothing', () => {
      const m = mergeConfig({ motion: { tracks: [{ from: 0, to: 1 }, { path: '  ' }, null, 'track', { path: 'size', from: 10, to: 200 }] } }).motion
      expect(m.tracks.map((t) => t.path)).toEqual(['size'])
    })

    it('rebuilds a track field by field', () => {
      const [t] = mergeConfig({ motion: { tracks: [{ path: 'axes.wght', from: '100', to: 900, easing: 'wobble', loops: 0, hold: 9, cycleOffset: -3, delay: -5 }] } }).motion.tracks
      expect(t).toEqual({
        path: 'axes.wght', from: 0, to: 900, easing: 'linear',
        loops: 1, hold: 0.5, cycleOffset: 0, delay: 0,
      })
    })

    it('keeps a well-formed track exactly', () => {
      const track = { path: 'axes.GRAD', from: -200, to: 150, easing: 'pingpong' as const, loops: 3, hold: 0.2, cycleOffset: 0.5, delay: 1 }
      expect(mergeConfig({ motion: { tracks: [track] } }).motion.tracks).toEqual([track])
    })

    it('clamps the clip settings to what the exporter can do', () => {
      const m = mergeConfig({ motion: { duration: 0, fps: 500, size: 4321 } }).motion
      expect(m.duration).toBe(0.1)
      expect(m.fps).toBe(60)
      expect(m.size).toBe(1080)
      expect(mergeConfig({ motion: { size: 2160 } }).motion.size).toBe(2160)
    })

    it('survives a tracks value that is not an array', () => {
      expect(mergeConfig({ motion: { tracks: { 0: { path: 'size' } } } }).motion.tracks).toEqual([])
    })
  })

  /**
   * TRAP 5 — the one that can destroy user work.
   *
   * Every Vector Type node saved before the fill vocabulary landed holds
   * `fill: '#ffffff'`, a bare string. `Paint` still ACCEPTS a string, so nothing
   * throws and nothing looks obviously wrong — what breaks is every dotted
   * control key (`fill.type`, `fill.a`, …), which resolves against a string and
   * silently addresses nothing. The lift is what stops that, and these are the
   * tests that stop the lift from being quietly removed.
   */
  describe('a legacy string fill is LIFTED, not lost (trap 5)', () => {
    it('lifts `#rrggbb` to a solid Fill carrying that colour', () => {
      const c = mergeConfig({ fill: '#ff8800' })
      expect(c.fill).toEqual({ ...DEFAULT_FILL, a: '#ff8800' })
    })

    it('a legacy config still RENDERS its colour, through the one renderer', () => {
      // The failure mode is a saved node rendering black, and it does not throw.
      // So this asserts the value the canvas/SVG paint path actually reads —
      // `paintPrimaryColor`, the bridge `drawVectorType` and `vectorTypeSVG`
      // both collapse through — rather than just the stored shape.
      const legacy = { text: 'Saved', fontId: 'inter', size: 120, fill: '#22cc55' }
      expect(paintPrimaryColor(mergeConfig(legacy).fill, '#000000')).toBe('#22cc55')
      // …and the deliberately-broken control: WITHOUT the lift the same blob
      // would have taken this branch, which is indistinguishable from a colour
      // that happens to be right. The colour must survive the merge, not the
      // fallback.
      expect(paintPrimaryColor(undefined, '#000000')).toBe('#000000')
    })

    it('lifts every colour form a stored config could hold', () => {
      for (const hex of ['#fff', '#ffffff', '#ffffffcc', 'red', 'rgb(1,2,3)']) {
        expect((mergeConfig({ fill: hex }).fill as any).a, hex).toBe(hex)
      }
    })

    it('every dotted fill control key resolves on a LIFTED legacy config', () => {
      // The concrete consequence: before the lift these all addressed nothing.
      const params = paramsFor(mergeConfig({ fill: '#123456' }))
      for (const key of ['fill.type', 'fill.a', 'fill.b', 'fill.angle', 'fill.density', 'fillAnchor']) {
        expect(params[key], key).toBeDefined()
      }
      expect(params['fill.a']).toBe('#123456')
    })

    it('is idempotent — a lifted config re-merges to itself', () => {
      const once = mergeConfig({ fill: '#abcdef' })
      expect(mergeConfig(once)).toEqual(once)
    })
  })

  describe('mergeFill survives hostile paint blobs', () => {
    it('falls back to the default fill for junk of every shape', () => {
      for (const junk of [null, undefined, [], 42, true, NaN, { type: 'plaid' }, { stops: [] }]) {
        expect(mergeConfig({ fill: junk }).fill, String(junk)).toEqual(DEFAULT_FILL)
      }
    })

    it('keeps a Gradient as a Gradient — collapsing it would be data loss', () => {
      // Multi-stop and radial are `Paint`-only; `Fill` cannot express them.
      const g = { type: 'radial', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }
      expect(mergeConfig({ fill: g }).fill).toEqual(g)
      const lin = mergeConfig({ fill: { type: 'linear', angle: 90, stops: [{ offset: 0.5, color: '#ff0000' }] } }).fill
      expect(lin).toEqual({ type: 'linear', angle: 90, stops: [{ offset: 0.5, color: '#ff0000' }] })
    })

    it('enforces the DEPTH-1 shader guard rather than re-implementing it', () => {
      // A shader inside a shader hangs the renderer. `mergeFill` reuses
      // `normalizePaint`, whose own guard collapses the inner one to a gradient
      // — no second copy of the rule to fall out of sync.
      const nested = {
        type: 'shader',
        a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8,
        shader: {
          effectId: 'fbm_warp', params: {}, anchor: 'object', speed: 1,
          input: { type: 'shader', a: '#ff0000', b: '#00ff00', textColor: '#ffffff', angle: 0, density: 4, shader: {} },
        },
      }
      const out = mergeConfig({ fill: nested }).fill as any
      expect(out.type).toBe('shader')
      expect(out.shader.input.type).toBe('gradient')
      expect(out.shader.input.shader).toBeUndefined()
    })

    it('repairs a non-finite angle / density', () => {
      // Every other numeric field in this schema rejects NaN/Infinity (`num`),
      // because a non-finite number does not fall back at the renderer — it
      // propagates through the tile maths and paints nothing.
      const f = mergeConfig({ fill: { ...DEFAULT_FILL, angle: NaN, density: Infinity } }).fill as any
      expect(f.angle).toBe(DEFAULT_FILL.angle)
      expect(f.density).toBe(DEFAULT_FILL.density)
      // …inside a shader's input too, which is the one place it can nest.
      const s = mergeConfig({
        fill: {
          ...DEFAULT_FILL, type: 'shader',
          shader: { effectId: 'fbm_warp', params: {}, anchor: 'object', speed: 1, input: { ...DEFAULT_FILL, density: NaN } },
        },
      }).fill as any
      expect(s.shader.input.density).toBe(DEFAULT_FILL.density)
    })
  })

  describe('fillAnchor', () => {
    it('accepts every anchor the schema offers and rejects anything else', () => {
      for (const a of VT_FILL_ANCHORS) expect(mergeConfig({ fillAnchor: a }).fillAnchor).toBe(a)
      for (const junk of ['object', '', null, 3, {}]) {
        expect(mergeConfig({ fillAnchor: junk }).fillAnchor, String(junk)).toBe('glyph')
      }
    })

    it('is declared, and declared NOT animatable', () => {
      const spec = VT_CONTROLS.find((c) => c.key === 'fillAnchor')!
      expect(spec.kind).toBe('select')
      expect((spec as any).options).toEqual([...VT_FILL_ANCHORS])
      expect((spec as any).animatable).toBe(false)
      // And it is genuinely unreachable from the timeline, not merely labelled.
      expect(animatableTargets(cfg()).map((t) => t.path)).not.toContain('fillAnchor')
    })
  })

  it('cloneConfig shares nothing mutable with its source', () => {
    const a = cfg({ axes: { wght: 700 }, motion: { ...DEFAULT_CONFIG.motion, tracks: [{ path: 'size', from: 1, to: 2, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }] } })
    const b = cloneConfig(a)
    b.axes.wght = 100
    b.motion.tracks[0]!.to = 99
    expect(a.axes.wght).toBe(700)
    expect(a.motion.tracks[0]!.to).toBe(2)
  })
})

describe('vtAgentControls', () => {
  it('emits plain ControlSpecs with no schema-only fields leaking', () => {
    for (const c of vtAgentControls(cfg({ strokeWidth: 3 }), RICH_AXES)) {
      expect(c, c.key).not.toHaveProperty('when')
      expect(c, c.key).not.toHaveProperty('agent')
      expect(c, c.key).not.toHaveProperty('animatable')
    }
  })

  it('tracks the visibility predicate', () => {
    expect(vtAgentControls(cfg({ strokeWidth: 0 })).map((c) => c.key)).not.toContain('stroke')
    expect(vtAgentControls(cfg({ strokeWidth: 3 })).map((c) => c.key)).toContain('stroke')
  })

  it('grows the vocabulary with the loaded font, and shrinks back without one', () => {
    const withFont = vtAgentControls(cfg(), RICH_AXES).map((c) => c.key)
    const without = vtAgentControls(cfg()).map((c) => c.key)
    expect(withFont).toContain('axes.XOPQ')
    expect(without.some((k) => k.startsWith('axes.'))).toBe(false)
    expect(withFont.length).toBe(without.length + RICH_AXES.length)
  })

  it('every emitted key resolves once its value is set', () => {
    const c = cfg({ strokeWidth: 3, axes: Object.fromEntries(RICH_AXES.map((a) => [a.tag, a.default])) })
    const params = paramsFor(c)
    const unresolved = vtAgentControls(c, RICH_AXES).map((s) => s.key).filter((k) => params[k] === undefined)
    expect(unresolved).toEqual([])
  })

  it('is a characterization snapshot, with and without a font loaded', () => {
    expect(vtAgentControls(cfg())).toMatchSnapshot()
    expect(vtAgentControls(cfg({ strokeWidth: 3 }), RICH_AXES)).toMatchSnapshot()
  })
})

/**
 * SHADER FILLS in the agent's vocabulary.
 *
 * `VT_CONTROLS` declares no `fill.shader.*` key at all — the shader vocabulary is
 * shared across four host studios and lives in `~/lib/shaderfill/controls.ts`. So
 * `visibleVtControls`, which can only return members of `VT_CONTROLS`, can never
 * produce one, and `vtAgentControls` needs an explicit branch. These tests pin
 * that the branch exists, that it fires only when it should, and — the one that
 * matters — that every key it emits addresses REAL storage.
 */
describe('shader fills enter the agent vocabulary', () => {
  /** A config whose fill is a shader over the mocked catalog effect. Every param
   *  the effect declares is SET, because `makeConfigParams` is sparse: an unwritten
   *  leaf reads `undefined`, so an unset param would make the resolution probe
   *  below pass or fail for the wrong reason. */
  const shaderCfg = (over: Record<string, unknown> = {}) => cfg({
    fill: {
      ...DEFAULT_FILL,
      type: 'shader',
      shader: {
        effectId: 'kaleidoscope',
        params: { segments: 14, zoom: 2.5, mode: 1 },
        anchor: 'frame',
        speed: 1.5,
        input: { ...DEFAULT_FILL, type: 'gradient' },
        ...over,
      },
    },
  } as any)

  const keysOf = (c: VectorTypeConfig) => vtAgentControls(c).map((s) => s.key)

  it('offers the three frozen shader keys only when the fill type is shader', () => {
    // Measured before the branch was written: a shader-typed config emitted
    // `text, fontId, size, tracking, align, fill.type, fill.a, fill.b, fillAnchor,
    // strokeWidth, motion.stagger.*` and not one `fill.shader` key. Nothing derives
    // them; Shape Studio needed the same explicit branch.
    const frozen = SHADER_FILL_CONTROLS.map((c) => c.key)
    expect(frozen).toEqual(['fill.shader.effectId', 'fill.shader.anchor', 'fill.shader.speed'])
    for (const k of frozen) expect(keysOf(shaderCfg()), k).toContain(k)
    for (const k of frozen) expect(keysOf(cfg()), k).not.toContain(k)
    expect(keysOf(cfg({ fill: { ...DEFAULT_FILL, type: 'stripes' } } as any)).some((k) => k.startsWith('fill.shader'))).toBe(false)
  })

  it('strips the schema-only fields off the shared shader controls too', () => {
    // `fill.shader.anchor` carries `animatable: false`; leaking it into the agent's
    // ControlSpec[] would put a schema field in the model's prompt.
    for (const c of vtAgentControls(shaderCfg())) {
      expect(c, c.key).not.toHaveProperty('animatable')
      expect(c, c.key).not.toHaveProperty('when')
      expect(c, c.key).not.toHaveProperty('agent')
    }
  })

  it("derives the active effect's own params at the real ShaderSpec.params path", () => {
    const derived = keysOf(shaderCfg()).filter((k) => k.startsWith('fill.shader.params.'))
    expect(derived).toEqual([
      'fill.shader.params.segments',
      'fill.shader.params.zoom',
      'fill.shader.params.mode',
    ])
    // …and it is genuinely `derivedShaderFillControls`'s output, prefix and all,
    // not a second hand-built list that happens to agree today.
    expect(vtAgentControls(shaderCfg()).slice(-3))
      .toEqual(derivedShaderFillControls(CATALOG_EFFECT, 'fill.shader'))
  })

  it('degrades to the frozen three when the catalog has not resolved that effect', () => {
    // `getEffectSync` never fetches: before any page has loaded the catalog it
    // returns null for every id. The frozen keys must still be offered.
    const k = keysOf(shaderCfg({ effectId: 'nothing-in-the-catalog' }))
    expect(k).toContain('fill.shader.effectId')
    expect(k.some((x) => x.startsWith('fill.shader.params.'))).toBe(false)
  })

  /**
   * THE ONE THAT MATTERS. `makeConfigParams` does naive dotted traversal with no
   * special cases, so a derived key one segment off the real path resolves to
   * `undefined` on read and creates a phantom object on write — which is exactly
   * what an earlier `<prefix>.p.<id>` namespace did in this codebase: it wrote to
   * `fill.shader.p` next to the real `fill.shader.params` and silently never
   * reached the renderer, with nothing thrown anywhere.
   */
  it('every derived shader param key RESOLVES against the real config', () => {
    const c = shaderCfg()
    const params = paramsFor(c)
    const derived = vtAgentControls(c).map((s) => s.key).filter((k) => k.startsWith('fill.shader.'))
    const unresolved = derived.filter((k) => params[k] === undefined)
    expect(unresolved).toEqual([])
    // Not just "defined" — the ACTUAL stored numbers, so a key landing on some
    // other real leaf would still fail.
    expect(params['fill.shader.params.segments']).toBe(14)
    expect(params['fill.shader.params.zoom']).toBe(2.5)
    expect(params['fill.shader.params.mode']).toBe(1)
    expect(params['fill.shader.effectId']).toBe('kaleidoscope')
    expect(params['fill.shader.anchor']).toBe('frame')
    expect(params['fill.shader.speed']).toBe(1.5)
  })

  it('the probe is not vacuous: a key one segment off the real path resolves to nothing', () => {
    // The old `.p.` address, and a plausible near-miss, against the same config
    // that resolves every real key above. If this ever passes, the test above has
    // stopped proving anything.
    const params = paramsFor(shaderCfg())
    expect(params['fill.shader.p.segments']).toBeUndefined()
    expect(params['fill.shader.segments']).toBeUndefined()
    expect(params['fill.params.segments']).toBeUndefined()
  })

  it('WRITING a derived key lands on the real params bag, creating no phantom object', () => {
    const c = shaderCfg()
    const params = paramsFor(c)
    params['fill.shader.params.segments'] = 3
    const shader = (c.fill as any).shader
    expect(shader.params.segments).toBe(3)
    expect(shader.p).toBeUndefined()
    // And the write is visible to the OTHER naive resolver too — `setByPath` /
    // `getByPath`, which motion and Collection bindings use.
    expect(paramsFor(c)['fill.shader.params.segments']).toBe(3)
  })

  /**
   * The inert-`fill.a` decision, asserted rather than described.
   *
   * `effectiveTilePaint` unwraps a shader fill to `shader.input` and paints THAT,
   * so the outer Fill's `a`/`b` are read by nothing on the screen path. Offering
   * them to the agent means "make the fill red" writes a value that is stored,
   * survives the merge, and changes not one pixel — so they are withheld, by the
   * same `when` predicates that already withhold `stroke` and `fill.angle`.
   */
  it('withholds the inert fill.a / fill.b on a shader fill, in the panel AND the agent', () => {
    const shader = shaderCfg()
    expect(visibleVtControls(shader).map((c) => c.key)).not.toContain('fill.a')
    expect(visibleVtControls(shader).map((c) => c.key)).not.toContain('fill.b')
    expect(keysOf(shader)).not.toContain('fill.a')
    expect(keysOf(shader)).not.toContain('fill.b')
    // `fill.angle` / `fill.density` were already withheld — `shader` is in neither
    // predicate's list — so the rule now reads as one rule.
    expect(keysOf(shader).filter((k) => k.startsWith('fill.'))).toEqual([
      'fill.type', 'fill.shader.effectId', 'fill.shader.anchor', 'fill.shader.speed',
      'fill.shader.params.segments', 'fill.shader.params.zoom', 'fill.shader.params.mode',
    ])
  })

  it('is a characterization snapshot of the shader vocabulary', () => {
    // The two existing snapshots (above) are both SOLID fills, so neither moved
    // when this branch landed — the shader keys are `when`-gated and those
    // configs never reach them. This is the third one, so the shader vocabulary
    // is pinned rather than merely reachable.
    expect(vtAgentControls(shaderCfg())).toMatchSnapshot()
  })

  it('still offers fill.a everywhere it PAINTS something', () => {
    // The withholding must be about the shader arm, not a blanket loss: every
    // other fill type reads `fill.a`, and a `Gradient` paint reads neither.
    for (const type of ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr']) {
      expect(keysOf(cfg({ fill: { ...DEFAULT_FILL, type } } as any)), type).toContain('fill.a')
    }
    expect(keysOf(cfg({ fill: { ...DEFAULT_FILL, type: 'shader' } } as any))).not.toContain('fill.a')
  })
})

describe('VT_GUIDANCE', () => {
  /** Every key the prose names is backticked; this is the set. */
  const quoted = [...VT_GUIDANCE.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
  const staticKeys = new Set([...VT_CONTROLS, ...SHADER_FILL_CONTROLS].map((c) => c.key))
  const isAxisKey = (t: string) => t.startsWith('axes.') && (t === 'axes.<tag>' || isAxisTag(t.slice(5)))
  /** The shader params are DERIVED per effect, so no fixed key exists to name.
   *  The prose may name the placeholder — and only the placeholder: a concrete
   *  `fill.shader.params.segments` would be teaching the model a key that exists
   *  for some effects and not others. */
  const isShaderParamKey = (t: string) => t === 'fill.shader.params.<param>'

  it('names only keys that exist in the schema', () => {
    expect(quoted.length).toBeGreaterThan(0)
    for (const t of quoted) {
      expect(staticKeys.has(t) || isAxisKey(t) || isShaderParamKey(t),
        `guidance names unknown key \`${t}\``).toBe(true)
    }
  })

  it('names every control the agent can actually reach', () => {
    // A control the agent is offered but the prose never explains is a knob the
    // model will use blind. SHADER_FILL_CONTROLS is in here because
    // `vtAgentControls` now offers those three on a shader fill — a shared
    // module's keys still land in THIS studio's prompt.
    for (const c of [...VT_CONTROLS, ...SHADER_FILL_CONTROLS]) {
      if ((c as any).agent === false) continue
      expect(quoted, `guidance never mentions ${c.key}`).toContain(c.key)
    }
  })

  it('says out loud that fill.a / fill.b do not apply to a shader fill', () => {
    // Both keys are named by the prose (the rule above requires it) but they are
    // WITHHELD on a shader fill. Prose that named them without saying when they
    // vanish would teach the model to reach for a control that is not there.
    expect(VT_GUIDANCE).toMatch(/SHADER FILLS\./)
    expect(VT_GUIDANCE).toMatch(/withdrawn/)
  })

  it('leaves no un-backticked dotted key hiding in the prose', () => {
    // Second net: the rule above only sees backticked tokens, so anything
    // shaped like a path outside them is caught here. `fill` joined the
    // alternation with the shader vocabulary — `fill.shader.effectId` un-quoted
    // is exactly as invisible to the first net as `axes.wght` was.
    for (const m of VT_GUIDANCE.matchAll(/(?<!`)\b(?:axes|motion|fill)\.[A-Za-z<>.]+/g)) {
      const t = m[0].replace(/\.$/, '')
      expect(staticKeys.has(t) || isAxisKey(t) || isShaderParamKey(t),
        `guidance names unknown key ${t}`).toBe(true)
    }
  })
})
