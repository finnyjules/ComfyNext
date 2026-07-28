/**
 * KineticType → Vector Type migration.
 *
 * This is the one step of the Vector Type plan that touches SAVED PROJECTS, so
 * it is tested as a pure function over saved-blob fixtures rather than through
 * the canvas. The hostile-input block is the point: a migration that throws on
 * load makes a project unopenable, which is worse than any wrong value it could
 * possibly produce.
 */
import { describe, it, expect } from 'vitest'
import {
  DROPPED_REASONS,
  LEGACY_KINETIC_TYPE,
  kineticParamsToVectorType,
  mappedPresetIds,
  migrateKineticNode,
  migrateKineticWorkflow,
  presetFidelity,
} from '~/lib/vectortype/migrateKinetic'
import { KINETIC_PRESETS_BY_ID } from '~/data/kinetic-presets'
import { DEFAULT_FILL, paintPrimaryColor } from '~/lib/spacetype/fillTile'
import { applyMotion, glyphTransform } from '~/lib/vectortype/motion'
import { vtBaseAppearance } from '~/lib/vectortype/config'

/** A realistic saved `params` blob, in the shape WidgetKineticType.parse read. */
const SAVED_PARAMS = {
  text: 'LAUNCH',
  presetId: 'slide-up',
  fontId: 'inter',
  fontSource: 'variable',
  googleFamily: '',
  googleAxes: [],
  googleWeights: [],
  weight: 700,
  axes: { wght: 700, slnt: 0 },
  color: '#ff2200',
  bg: 'transparent',
  size: 180,
  letterSpacing: 0.05,
  duration: 3,
  stagger: 0.06,
  ease: 'power2.out',
  fps: 24,
  rendered: ['kinetic_0001.png', 'kinetic_0002.png', 'kinetic_0003.png'],
  axisKeyframes: [],
}

/** The saved node as it sits in a project file: one `params` string widget. */
function savedKineticNode(params: unknown = JSON.stringify(SAVED_PARAMS)) {
  return {
    id: 12,
    type: LEGACY_KINETIC_TYPE,
    title: 'Kinetic Typography',
    pos: [400, 120],
    size: [220, 260],
    widgets_values: [typeof params === 'string' ? params : JSON.stringify(params)],
    properties: { 'Node name for S&R': LEGACY_KINETIC_TYPE },
    outputs: [
      { name: 'frames', type: 'IMAGE', links: [7] },
      { name: 'masks', type: 'MASK', links: null },
    ],
    inputs: [],
  }
}

describe('kineticParamsToVectorType — what carries across', () => {
  it('carries the text, font, size, colour and spacing', () => {
    const m = kineticParamsToVectorType(JSON.stringify(SAVED_PARAMS))
    expect(m.config.text).toBe('LAUNCH')
    expect(m.config.fontId).toBe('inter')
    expect(m.config.size).toBe(180)
    // The colour carries across LIFTED: `config.fill` is a `Paint` as of the
    // fills work, and `mergeConfig` turns the migration's flat colour into a
    // solid `Fill` carrying it. A saved KineticType node's colour is still the
    // colour that gets painted — it just lives on `a` now.
    // The colour lands on the ONE fill layer the appearance-stack migration
    // builds — KineticType had one colour and no outline, so the stack is a
    // single fill and no stroke.
    expect(m.config.appearance.map((l) => l.kind)).toEqual(['fill'])
    expect(vtBaseAppearance(m.config).fill).toEqual({ ...DEFAULT_FILL, a: '#ff2200' })
    // 0.05em spacing → 50 (1/1000 em), Vector Type's tracking unit.
    expect(m.config.tracking).toBe(50)
  })

  it('carries axis positions, and folds `weight` into wght when absent', () => {
    expect(kineticParamsToVectorType(JSON.stringify(SAVED_PARAMS)).config.axes).toEqual({ wght: 700, slnt: 0 })
    const noAxes = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, axes: {}, weight: 250 }))
    expect(noAxes.config.axes.wght).toBe(250)
    // An explicit axes.wght always wins over the legacy `weight` field.
    const both = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, axes: { wght: 900 }, weight: 250 }))
    expect(both.config.axes.wght).toBe(900)
  })

  it('carries clip duration, fps and the per-glyph stagger', () => {
    const m = kineticParamsToVectorType(JSON.stringify(SAVED_PARAMS))
    expect(m.config.motion.duration).toBe(3)
    expect(m.config.motion.fps).toBe(24)
    expect(m.config.motion.stagger.delay).toBeCloseTo(0.06, 6)
    expect(m.config.motion.stagger.order).toBe('forward')
  })

  it('scales the stagger by the preset multiplier the original applied', () => {
    // `spin-loop` delayed each char by `i * opts.stagger * 2`.
    const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: 'spin-loop' }))
    expect(m.config.motion.stagger.delay).toBeCloseTo(0.12, 6)
  })

  it('maps transparent background to null and a hex background through', () => {
    expect(kineticParamsToVectorType(JSON.stringify(SAVED_PARAMS)).background).toBeNull()
    expect(kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, bg: '#101820' })).background).toBe('#101820')
  })

  it('keeps the baked frame sequence', () => {
    expect(kineticParamsToVectorType(JSON.stringify(SAVED_PARAMS)).frames)
      .toEqual(['kinetic_0001.png', 'kinetic_0002.png', 'kinetic_0003.png'])
  })

  it('drops a Google-hosted family rather than inventing a catalog id', () => {
    const m = kineticParamsToVectorType(JSON.stringify({
      ...SAVED_PARAMS, fontSource: 'google', googleFamily: 'Bricolage Grotesque', fontId: 'inter',
    }))
    expect(m.config.text).toBe('LAUNCH')       // the work survives
    expect(m.config.fontId).toBe('inter')      // ...on the default catalog font
  })

  it('preserves what an EMPTY blob rendered — the old default word, not the new one', () => {
    const m = kineticParamsToVectorType('{}')
    expect(m.config.text).toBe('Hello')
  })
})

describe('kineticParamsToVectorType — preset mapping', () => {
  it('produces real glyph tracks for a mapped preset', () => {
    const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: 'slide-up' }))
    expect(m.fidelity).toBe('honest')
    const paths = m.config.motion.tracks.map(t => t.path).sort()
    expect(paths).toEqual(['glyph.dy', 'glyph.opacity'])
    const dy = m.config.motion.tracks.find(t => t.path === 'glyph.dy')!
    expect([dy.from, dy.to]).toEqual([40, 0])
  })

  it('leaves motion EMPTY for a preset with no honest equivalent', () => {
    for (const id of ['scramble-in', 'blur-in', 'jello', 'color-cycle', 'marquee']) {
      const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: id }))
      expect(m.fidelity, id).toBe('dropped')
      expect(m.config.motion.tracks, id).toEqual([])
      expect(m.config.text, id).toBe('LAUNCH')   // the text still crosses
    }
  })

  it('treats an unknown preset id as dropped, not as the default preset', () => {
    const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: 'preset-from-the-future' }))
    expect(m.fidelity).toBe('dropped')
    expect(m.config.motion.tracks).toEqual([])
    expect(m.config.text).toBe('LAUNCH')
  })

  it('every mapped preset id is a REAL preset id, and every track targets a glyph field', () => {
    const GLYPH_FIELDS = ['glyph.dx', 'glyph.dy', 'glyph.scale', 'glyph.rotate', 'glyph.opacity']
    for (const id of mappedPresetIds()) {
      expect(KINETIC_PRESETS_BY_ID[id], `${id} is not a real kinetic preset`).toBeTruthy()
      const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: id }))
      expect(m.config.motion.tracks.length, id).toBeGreaterThan(0)
      for (const t of m.config.motion.tracks) expect(GLYPH_FIELDS, id).toContain(t.path)
    }
  })

  it('every DROPPED_REASONS entry names a real preset, and none of them is secretly mapped', () => {
    for (const id of Object.keys(DROPPED_REASONS)) {
      expect(KINETIC_PRESETS_BY_ID[id], `${id} is not a real kinetic preset`).toBeTruthy()
      expect(presetFidelity(id), id).toBe('dropped')
    }
  })

  it('accounts for EVERY preset in the catalog — mapped or documented as dropped', () => {
    const unaccounted = Object.keys(KINETIC_PRESETS_BY_ID)
      .filter(id => presetFidelity(id) === 'dropped' && !(id in DROPPED_REASONS))
    expect(unaccounted, 'presets with neither a mapping nor a written reason').toEqual([])
  })

  it('the mapped motion actually MOVES when the evaluator reads it', () => {
    // Not "the tracks exist" — the real evaluator, on the real config, at two
    // times, giving two different glyph transforms. A track pointing at a path
    // nothing reads would pass the shape checks above and fail this one.
    const m = kineticParamsToVectorType(JSON.stringify({ ...SAVED_PARAMS, presetId: 'slide-up', stagger: 0 }))
    const start = glyphTransform(m.config, 0, 0, 6)
    const end = glyphTransform(m.config, m.config.motion.duration, 0, 6)
    expect(start.dy).toBeCloseTo(40, 3)
    expect(start.opacity).toBeCloseTo(0, 3)
    expect(end.dy).toBeCloseTo(0, 3)
    expect(end.opacity).toBeCloseTo(1, 3)
  })

  it('an axis keyframe pair becomes an axis track the evaluator applies', () => {
    const m = kineticParamsToVectorType(JSON.stringify({
      ...SAVED_PARAMS,
      presetId: 'unmapped-on-purpose',
      axes: { wght: 100 },
      axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }],
    }))
    const track = m.config.motion.tracks.find(t => t.path === 'axes.wght')
    expect(track).toBeTruthy()
    expect([track!.from, track!.to]).toEqual([100, 900])
    expect(applyMotion(m.config, m.config.motion.duration).axes.wght).toBeCloseTo(900, 3)
  })

  it('drops axis keyframes it cannot express as one from→to', () => {
    const m = kineticParamsToVectorType(JSON.stringify({
      ...SAVED_PARAMS,
      presetId: 'unmapped-on-purpose',
      axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 0.5, axes: { wght: 900 } }, { t: 1, axes: { wght: 100 } }],
    }))
    expect(m.config.motion.tracks).toEqual([])
  })
})

describe('kineticParamsToVectorType — hostile input', () => {
  const HOSTILE: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['malformed JSON', '{"text": "oops"'],
    ['JSON null', 'null'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"just a string"'],
    ['a JSON number', '42'],
    ['a bare number', 42],
    ['an already-parsed object', { text: 'parsed', presetId: 'fade-in' }],
    ['wrong types everywhere', JSON.stringify({
      text: 42, presetId: 99, fontId: [], axes: 'nope', size: 'big', letterSpacing: null,
      duration: NaN, stagger: 'slow', fps: {}, color: 'chartreuse', bg: 12, rendered: 'frames.png',
      axisKeyframes: 'yes',
    })],
    ['nulls everywhere', JSON.stringify({
      text: null, presetId: null, fontId: null, axes: null, size: null, letterSpacing: null,
      duration: null, stagger: null, fps: null, color: null, bg: null, rendered: null, axisKeyframes: null,
    })],
    ['NaN/Infinity smuggled in as an object', {
      size: Number.NaN, duration: Number.POSITIVE_INFINITY, fps: -Infinity, stagger: Number.NaN,
    }],
  ]

  for (const [label, input] of HOSTILE) {
    it(`survives ${label} and still yields a usable config`, () => {
      const m = kineticParamsToVectorType(input)
      expect(typeof m.config.text).toBe('string')
      expect(m.config.text.length).toBeGreaterThan(0)
      expect(Number.isFinite(m.config.size)).toBe(true)
      expect(Number.isFinite(m.config.tracking)).toBe(true)
      expect(Number.isFinite(m.config.motion.duration)).toBe(true)
      expect(m.config.motion.duration).toBeGreaterThan(0)
      expect(Number.isFinite(m.config.motion.fps)).toBe(true)
      expect(m.config.motion.fps).toBeGreaterThan(0)
      expect(Array.isArray(m.config.motion.tracks)).toBe(true)
      expect(Array.isArray(m.frames)).toBe(true)
      // Through the same collapse the renderer uses, so this still asserts
      // "a usable colour reaches the canvas" rather than a storage shape.
      expect(paintPrimaryColor(vtBaseAppearance(m.config).fill)).toMatch(/^#[0-9a-f]{6}$/)
      expect(m.background === null || typeof m.background === 'string').toBe(true)
    })
  }

  it('drops non-string entries from a half-corrupt frame list', () => {
    const m = kineticParamsToVectorType(JSON.stringify({ rendered: ['a.png', null, 7, '', 'b.png'] }))
    expect(m.frames).toEqual(['a.png', 'b.png'])
  })
})

describe('migrateKineticNode — the saved node', () => {
  it('rewrites the node type, keeping the wire and the position', () => {
    const node = savedKineticNode()
    expect(migrateKineticNode(node)).toBe(true)
    expect(node.type).toBe('VectorType')
    expect(node.pos).toEqual([400, 120])
    expect(node.outputs[0]!.links).toEqual([7])
    expect(node.properties['Node name for S&R']).toBe('VectorType')
    expect(node.title).toBe('Vector Type')
  })

  it('lands the config where the Vector Type node card reads it', () => {
    const node = savedKineticNode()
    migrateKineticNode(node)
    const blob = (node.properties as any).sailor_vectorType
    expect(blob.config.text).toBe('LAUNCH')
    expect(blob.background).toBeNull()
    expect(blob.canvasW).toBe(1280)
    expect(node.widgets_values).toEqual([])
  })

  it('keeps the baked frames where the timeline surfaces read them', () => {
    const node = savedKineticNode()
    migrateKineticNode(node)
    const legacy = (node.properties as any).sailor_kineticLegacy
    expect(legacy.frames).toHaveLength(3)
    expect(legacy.presetId).toBe('slide-up')
    expect(legacy.fps).toBe(24)
  })

  it('keeps a title the user chose', () => {
    const node = { ...savedKineticNode(), title: 'HERO TITLE' }
    migrateKineticNode(node)
    expect(node.title).toBe('HERO TITLE')
  })

  it('ignores every node that is not a KineticType', () => {
    for (const n of [null, undefined, 42, 'KineticType', {}, { type: 'VectorType' }, { type: 'LoadImage' }]) {
      expect(migrateKineticNode(n as any)).toBe(false)
    }
  })

  it('survives a node whose widgets_values is missing, short, or an object', () => {
    for (const wv of [undefined, [], [null], {}, { params: '{"text":"OBJ"}' }, 'not-an-array']) {
      const node: any = { ...savedKineticNode(), widgets_values: wv }
      expect(() => migrateKineticNode(node)).not.toThrow()
      expect(node.type).toBe('VectorType')
      expect(typeof node.properties.sailor_vectorType.config.text).toBe('string')
    }
    const objNode: any = { ...savedKineticNode(), widgets_values: { params: '{"text":"OBJ"}' } }
    migrateKineticNode(objNode)
    expect(objNode.properties.sailor_vectorType.config.text).toBe('OBJ')
  })

  it('survives a node whose properties are missing or not an object', () => {
    for (const props of [undefined, null, 'nope', []]) {
      const node: any = { ...savedKineticNode(), properties: props }
      expect(() => migrateKineticNode(node)).not.toThrow()
      expect(node.properties.sailor_vectorType.config.text).toBe('LAUNCH')
    }
  })
})

describe('migrateKineticWorkflow — the saved project', () => {
  /** A project: a KineticType wired into a Timeline whose editor state already
   *  holds a clip of the length the sequence gave it. */
  function savedProject() {
    return {
      last_node_id: 20,
      nodes: [
        savedKineticNode(),
        {
          id: 13,
          type: 'Timeline',
          pos: [800, 120],
          widgets_values: [],
          properties: {
            edit_state: JSON.stringify({
              fps: 24,
              tracks: [{
                id: 'track-1', kind: 'video', clips: [
                  { id: 'clip-1', kind: 'workflow', port_index: 1, start_frame: 0, in_frame: 0, length: 90 },
                ],
              }],
            }),
          },
          inputs: [{ name: 'clip1', type: 'IMAGE', link: 7 }],
          outputs: [],
        },
        { id: 14, type: 'LoadImage', pos: [0, 0], widgets_values: ['cat.png'], properties: {} },
      ],
      links: [[7, 12, 0, 13, 0, 'IMAGE']],
    }
  }

  it('migrates only the KineticType nodes and leaves everything else byte-identical', () => {
    const wf = savedProject()
    const timelineBefore = JSON.stringify(wf.nodes[1])
    const loadImageBefore = JSON.stringify(wf.nodes[2])
    const linksBefore = JSON.stringify(wf.links)

    expect(migrateKineticWorkflow(wf)).toBe(1)

    expect(wf.nodes[0]!.type).toBe('VectorType')
    expect(JSON.stringify(wf.nodes[1])).toBe(timelineBefore)
    expect(JSON.stringify(wf.nodes[2])).toBe(loadImageBefore)
    expect(JSON.stringify(wf.links)).toBe(linksBefore)
  })

  it('leaves the timeline clip LENGTH exactly as saved', () => {
    // The trap this whole task circles: a saved clip's duration lives in the
    // Timeline's own edit_state, not in the source node — so the migration must
    // not touch it, and re-deriving it must not be necessary.
    const wf = savedProject()
    migrateKineticWorkflow(wf)
    const state = JSON.parse((wf.nodes[1] as any).properties.edit_state)
    expect(state.tracks[0].clips[0].length).toBe(90)
    expect(state.fps).toBe(24)
  })

  it('keeps the frame count available so a re-added clip gets the same length', () => {
    // The other half: adding the clip AGAIN from the port list derives its
    // length from the frame count, which now lives in sailor_kineticLegacy.
    const wf = savedProject()
    migrateKineticWorkflow(wf)
    expect((wf.nodes[0] as any).properties.sailor_kineticLegacy.frames).toHaveLength(3)
  })

  it('is idempotent — a second pass finds nothing and changes nothing', () => {
    const wf = savedProject()
    migrateKineticWorkflow(wf)
    const after = JSON.stringify(wf)
    expect(migrateKineticWorkflow(wf)).toBe(0)
    expect(JSON.stringify(wf)).toBe(after)
  })

  it('never throws on a workflow that is not one', () => {
    for (const wf of [null, undefined, {}, { nodes: null }, { nodes: 'nope' }, { nodes: [null, 3, 'x'] }, []]) {
      expect(() => migrateKineticWorkflow(wf as any)).not.toThrow()
      expect(migrateKineticWorkflow(wf as any)).toBe(0)
    }
  })

  it('migrates the healthy nodes even when one is unmigratable', () => {
    // A frozen node cannot be rewritten; the rest of the project must still open.
    const bad = Object.freeze(savedKineticNode())
    const wf = { nodes: [bad, savedKineticNode()], links: [] }
    expect(() => migrateKineticWorkflow(wf)).not.toThrow()
    expect(wf.nodes[1]!.type).toBe('VectorType')
  })
})
