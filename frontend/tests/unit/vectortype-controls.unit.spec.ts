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
import { describe, it, expect } from 'vitest'
import { makeConfigParams } from '~/lib/agent/configParams'
import { isValidAxisTag, normaliseAxes, type VtAxis } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  VT_ALIGNS,
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

describe('VT_GUIDANCE', () => {
  /** Every key the prose names is backticked; this is the set. */
  const quoted = [...VT_GUIDANCE.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
  const staticKeys = new Set(VT_CONTROLS.map((c) => c.key))
  const isAxisKey = (t: string) => t.startsWith('axes.') && (t === 'axes.<tag>' || isAxisTag(t.slice(5)))

  it('names only keys that exist in the schema', () => {
    expect(quoted.length).toBeGreaterThan(0)
    for (const t of quoted) {
      expect(staticKeys.has(t) || isAxisKey(t), `guidance names unknown key \`${t}\``).toBe(true)
    }
  })

  it('names every control the agent can actually reach', () => {
    // A control the agent is offered but the prose never explains is a knob the
    // model will use blind.
    for (const c of VT_CONTROLS) {
      if ((c as any).agent === false) continue
      expect(quoted, `guidance never mentions ${c.key}`).toContain(c.key)
    }
  })

  it('leaves no un-backticked dotted key hiding in the prose', () => {
    // Second net: the rule above only sees backticked tokens, so anything
    // shaped like a path outside them is caught here.
    for (const m of VT_GUIDANCE.matchAll(/(?<!`)\b(?:axes|motion)\.[A-Za-z<>]+/g)) {
      const t = m[0]
      expect(staticKeys.has(t) || isAxisKey(t), `guidance names unknown key ${t}`).toBe(true)
    }
  })
})
