/**
 * Vector Type — the appearance-stack UI's own contracts.
 *
 * The panel itself lives in `VectorTypeSurface.vue`; what is pinned here is
 * everything the panel would be WRONG about silently:
 *
 *  1. **Labels are derived from what a layer IS, and are unique.** Positional
 *     names renumber on reorder, which renames a layer's motion targets with it
 *     — the bug `gradientfx/layerLabel.ts`'s header describes, reproduced here
 *     as an assertion rather than avoided by convention.
 *  2. **A new stroke layer is visible immediately**, checked against the real
 *     SVG exporter rather than against the default constant. The invisible
 *     stroke — width 0, colour control gated behind a non-zero width — is the
 *     bug this whole feature exists to fix.
 *  3. **`layer.opacity` and `layer.blend` are declared.** Both have rendered
 *     since Task 3 and were unreachable from any UI; a control that cannot be
 *     written is as dead as one that cannot be read.
 *  4. **The remap scheme matches the paths motion really emits**, so add /
 *     remove / reorder move a track WITH its layer instead of re-aiming it at
 *     whatever slid into the slot. Asserted by the layer's stable `id`, which is
 *     the only thing a positional path cannot fake.
 *
 * NO NETWORK, NO DOM.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  LAYER_DEFAULTS,
  VT_DEFAULT_STROKE_WIDTH,
  VT_LAYER_KINDS,
  mergeConfig,
  vtLayer,
  type VectorTypeConfig,
  type VtAppearanceLayer,
  type VtMotionTrack,
} from '~/lib/vectortype/config'
import { vtLayerLabel, vtLayerLabels } from '~/lib/vectortype/layerLabel'
import { VT_CONTROLS, VT_GUIDANCE, visibleVtControls } from '~/lib/vectortype/controls'
import { VT_APPEARANCE_REMAP, animatableTargets } from '~/lib/vectortype/motion'
import { vectorTypeSVG } from '~/lib/vectortype/canvas'
import { makeConfigParams } from '~/lib/agent/configParams'
import { BLEND_MODES } from '~/lib/studio/blend'

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))
function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return { id: 'inter-subset', axes: normaliseAxes(raw?.variationAxes), unitsPerEm: Number(raw?.unitsPerEm) || 1000, raw }
}
const font = loadFixtureFont()
const WORD = 'Sail'
const N = WORD.length
const BOX = { width: 400, height: 200 }

function cfg(patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, ...patch })
}
function stack(...layers: Partial<VtAppearanceLayer>[]): VectorTypeConfig {
  return cfg({ appearance: layers.map((l, i) => vtLayer({ id: `L${i}`, ...l })) })
}
const pathCount = (c: VectorTypeConfig): number => (vectorTypeSVG(font, c, 0, BOX).svg.match(/<path\b/g) ?? []).length

// ── 1. labels ───────────────────────────────────────────────────────────────

describe('layer labels are derived from what the layer IS, not where it sits', () => {
  it('names each layer for its kind', () => {
    const c = stack({ kind: 'fill' }, { kind: 'stroke' }, { kind: 'extrude' })
    expect(vtLayerLabels(c.appearance)).toEqual(['Fill', 'Stroke', 'Extrude'])
  })

  it('de-duplicates with ordinals, so two fills are tellable apart', () => {
    const c = stack({ kind: 'fill' }, { kind: 'fill' }, { kind: 'stroke' }, { kind: 'fill' })
    expect(vtLayerLabels(c.appearance)).toEqual(['Fill', 'Fill 2', 'Stroke', 'Fill 3'])
  })

  it('is UNIQUE for every stack shape — motion builds its dropdown from these', () => {
    // Two identical labels make two different motion targets indistinguishable.
    // Every arrangement of six layers over three kinds would be 729 configs; a
    // handful of the shapes that actually collide is the useful subset.
    const shapes: Partial<VtAppearanceLayer>[][] = [
      [{ kind: 'fill' }, { kind: 'fill' }, { kind: 'fill' }, { kind: 'fill' }, { kind: 'fill' }, { kind: 'fill' }],
      [{ kind: 'stroke' }, { kind: 'stroke' }, { kind: 'extrude' }, { kind: 'extrude' }],
      [{ kind: 'extrude' }, { kind: 'fill' }, { kind: 'extrude' }, { kind: 'fill' }, { kind: 'stroke' }],
    ]
    for (const s of shapes) {
      const labels = vtLayerLabels(stack(...s).appearance)
      expect(new Set(labels).size, labels.join(' / ')).toBe(labels.length)
      for (const l of labels) expect(l).toBeTruthy()
    }
  })

  it('does NOT renumber the whole stack when one layer moves', () => {
    // The failure the header names: with positional names, moving the top layer
    // to the bottom renamed every other layer too, and their motion targets
    // looked like they had jumped. The kind-derived names move WITH the layer.
    const before = stack({ kind: 'fill' }, { kind: 'stroke' }, { kind: 'extrude' })
    const moved = [...before.appearance]
    const [top] = moved.splice(2, 1)
    moved.unshift(top!)
    expect(vtLayerLabels(before.appearance)).toEqual(['Fill', 'Stroke', 'Extrude'])
    expect(vtLayerLabels(moved)).toEqual(['Extrude', 'Fill', 'Stroke'])
    // Every name that existed still exists — nothing was renamed, only reordered.
    expect(new Set(vtLayerLabels(moved))).toEqual(new Set(vtLayerLabels(before.appearance)))
  })

  it('falls back to a positional name only for a kind no renderer understands', () => {
    const weird = [vtLayer({ id: 'L0', kind: 'fill' }), { ...vtLayer({ id: 'L1' }), kind: 'sparkle' } as unknown as VtAppearanceLayer]
    expect(vtLayerLabels(weird)).toEqual(['Fill', 'Layer 2'])
  })

  it('is never sparse, and answers for a single index the same way', () => {
    const c = stack({ kind: 'fill' }, { kind: 'fill' })
    expect(vtLayerLabels(c.appearance)).toHaveLength(2)
    expect(vtLayerLabel(c.appearance, 1)).toBe('Fill 2')
    expect(vtLayerLabel(c.appearance, 9)).toBe('Layer 10')
    expect(vtLayerLabels([])).toEqual([])
    expect(vtLayerLabels(undefined)).toEqual([])
  })

  it('covers every kind the config declares — no kind falls through to a number', () => {
    for (const kind of VT_LAYER_KINDS) {
      expect(vtLayerLabels([vtLayer({ id: 'L0', kind })])[0], kind).not.toMatch(/^Layer \d/)
    }
  })
})

// ── 2. a new stroke layer is visible immediately ────────────────────────────

describe('a NEW layer paints, and a new STROKE paints without touching a slider', () => {
  it('gives a fresh stroke layer a non-zero width', () => {
    expect(VT_DEFAULT_STROKE_WIDTH).toBeGreaterThan(0)
    expect(vtLayer({ kind: 'stroke' }).width).toBe(VT_DEFAULT_STROKE_WIDTH)
    expect(LAYER_DEFAULTS.width).toBe(VT_DEFAULT_STROKE_WIDTH)
  })

  it('EXPORTS that stroke — the claim is about ink, not about a constant', () => {
    // The old flat `strokeWidth` defaulted to 0, so the renderer dropped the
    // stroke and the colour control was gated behind a width nobody knew to
    // raise. Asked of the real writer: adding a default stroke layer adds N
    // paths, one per glyph.
    const oneFill = stack({ kind: 'fill', paint: '#ff2200' })
    const plusStroke = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'stroke', paint: '#00c8ff' })
    expect(pathCount(oneFill)).toBe(N)
    expect(pathCount(plusStroke)).toBe(N * 2)
  })

  it('shows the stroke width control the moment a stroke layer is active', () => {
    // The other half of the old bug: the control was hidden, so a user who DID
    // look for it found nothing. It is gated on the KIND now, not on the value.
    const c = stack({ kind: 'fill' }, { kind: 'stroke' })
    expect(visibleVtControls(c, 1).map(x => x.key)).toContain('layer.width')
    expect(visibleVtControls(c, 0).map(x => x.key)).not.toContain('layer.width')
  })

  it('would catch a zero-width default — the regression that started this', () => {
    // Negative control: a stroke layer explicitly at width 0 exports nothing,
    // which is exactly the picture the old default produced.
    const zero = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'stroke', width: 0, paint: '#00c8ff' })
    expect(pathCount(zero)).toBe(N)
  })

  it('gives a fresh EXTRUDE layer enough depth to be seen', () => {
    expect(LAYER_DEFAULTS.depth).toBeGreaterThan(0)
    const plusExtrude = stack({ kind: 'extrude', paint: '#00c8ff' }, { kind: 'fill', paint: '#ff2200' })
    expect(pathCount(plusExtrude)).toBe(N * LAYER_DEFAULTS.depth + N)
  })
})

// ── 3. layer.opacity and layer.blend are declared ───────────────────────────

describe('`layer.opacity` and `layer.blend` are reachable controls, not just fields', () => {
  const opacity = VT_CONTROLS.find(c => c.key === 'layer.opacity')!
  const blend = VT_CONTROLS.find(c => c.key === 'layer.blend')!

  it('declares both, in the Paint section', () => {
    expect(opacity).toBeDefined()
    expect(blend).toBeDefined()
    expect(opacity.group).toBe('Paint')
    expect(blend.group).toBe('Paint')
  })

  it('offers exactly the blends `mergeLayer` will accept', () => {
    // A picker offering a mode the merge throws away is a control that forgets
    // itself on the next load. Derived from the shared list, not typed out.
    expect(blend.kind).toBe('select')
    expect((blend as { options: string[] }).options).toEqual(BLEND_MODES)
    expect((blend as { options: string[] }).options).toContain(LAYER_DEFAULTS.blend)
  })

  it('spans the whole 0..1 opacity range and defaults to the stored value', () => {
    expect(opacity.kind).toBe('slider')
    expect(opacity).toMatchObject({ min: 0, max: 1, default: LAYER_DEFAULTS.opacity })
  })

  it('applies to ALL THREE kinds — neither is gated', () => {
    // Unlike `layer.width` and the extrude knobs, these two paint on every kind,
    // so gating them would hide a control that does something.
    for (const kind of VT_LAYER_KINDS) {
      const keys = visibleVtControls(stack({ kind }), 0).map(c => c.key)
      expect(keys, kind).toContain('layer.opacity')
      expect(keys, kind).toContain('layer.blend')
    }
  })

  it('resolves against a real leaf on the ACTIVE layer', () => {
    const c = stack({ kind: 'fill', opacity: 1, blend: 'normal' }, { kind: 'fill', opacity: 0.4, blend: 'multiply' })
    const params = makeConfigParams(() => c, () => 1, 'appearance')
    expect(params['layer.opacity']).toBe(0.4)
    expect(params['layer.blend']).toBe('multiply')
    params['layer.opacity'] = 0.25
    expect(c.appearance[1]!.opacity).toBe(0.25)
    // …and it wrote to layer 1, not layer 0.
    expect(c.appearance[0]!.opacity).toBe(1)
  })

  it('makes opacity a motion target on every layer, and blend on none', () => {
    const paths = animatableTargets(stack({ kind: 'fill' }, { kind: 'stroke' })).map(t => t.path)
    expect(paths).toContain('appearance.0.opacity')
    expect(paths).toContain('appearance.1.opacity')
    // A blend is a MODE; tweening `multiply` towards `screen` interpolates nothing.
    expect(paths.some(p => p.endsWith('.blend'))).toBe(false)
  })

  it('is explained to the agent, by name', () => {
    expect(VT_GUIDANCE).toContain('`layer.opacity`')
    expect(VT_GUIDANCE).toContain('`layer.blend`')
  })
})

// ── 4. the mutations keep motion tracks on their own layer ──────────────────

describe('stack mutations remap motion tracks — a track follows its layer', () => {
  // THE scheme the surface uses — imported, not restated, so this spec cannot
  // pass against a scheme the panel does not actually apply.
  const REMAP = VT_APPEARANCE_REMAP

  const three = () => stack(
    { kind: 'fill', paint: '#ff2200' },
    { kind: 'stroke', paint: '#00c8ff' },
    { kind: 'extrude', paint: '#ffee00' },
  )

  it('matches the paths `animatableTargets` really emits — not a guessed shape', () => {
    // The trap this test exists for: Shader's scheme needs `mid: 'params'` and a
    // non-empty leaf, and either knob set wrongly here would silently match
    // nothing and remap nothing.
    const targets = animatableTargets(three()).filter(t => t.path.startsWith('appearance.'))
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) {
      expect(REMAP.indexOf(t.path), t.path).not.toBeNull()
      expect(REMAP.indexOf(t.path), t.path).toBe(Number(t.path.split('.')[1]))
    }
  })

  /** Which layer id each track addresses, read through the path. */
  const aimedAt = (c: VectorTypeConfig, tracks: VtMotionTrack[]): (string | undefined)[] =>
    tracks.map(t => c.appearance[REMAP.indexOf(t.path)!]?.id)

  const track = (path: string): VtMotionTrack =>
    ({ path, from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 })

  it('keeps every track on its own layer through a REORDER', () => {
    const c = three()
    const tracks = [track('appearance.0.opacity'), track('appearance.1.width'), track('appearance.2.depth')]
    expect(aimedAt(c, tracks)).toEqual(['L0', 'L1', 'L2'])
    // Move the bottom layer to the top — the surface's `reorderLayer`.
    const [moved] = c.appearance.splice(0, 1)
    c.appearance.splice(2, 0, moved!)
    const after = REMAP.onReorder(tracks, 0, 2)
    expect(c.appearance.map(l => l.id)).toEqual(['L1', 'L2', 'L0'])
    expect(aimedAt(c, after)).toEqual(['L0', 'L1', 'L2'])
    // Without the remap the same splice re-aims all three — the silent bug.
    expect(aimedAt(c, tracks)).toEqual(['L1', 'L2', 'L0'])
  })

  it('drops the removed layer’s tracks and keeps the rest pointing right', () => {
    const c = three()
    const tracks = [track('appearance.0.opacity'), track('appearance.1.width'), track('appearance.2.depth')]
    c.appearance.splice(1, 1)
    const after = REMAP.onRemove(tracks, 1)
    expect(after).toHaveLength(2)
    expect(aimedAt(c, after)).toEqual(['L0', 'L2'])
  })

  it('shifts the tracks above an INSERT, which is what duplicate does', () => {
    const c = three()
    const tracks = [track('appearance.0.opacity'), track('appearance.2.depth')]
    c.appearance.splice(1, 0, vtLayer({ id: 'Lnew', kind: 'fill' }))
    const after = REMAP.onInsert(tracks, 1)
    expect(aimedAt(c, after)).toEqual(['L0', 'L2'])
  })

  it('leaves an APPEND alone — nothing can point past the old end', () => {
    // Add pushes onto the end of the array (the front of the picture), so no
    // existing index moves and there is nothing to remap.
    const c = three()
    const tracks = [track('appearance.0.opacity'), track('appearance.2.depth')]
    c.appearance.push(vtLayer({ id: 'Lnew', kind: 'stroke' }))
    expect(aimedAt(c, tracks)).toEqual(['L0', 'L2'])
  })

  it('never touches a track outside the stack', () => {
    const tracks = [track('axes.wght'), track('size'), track('glyph.dy')]
    for (const kind of [
      REMAP.onReorder(tracks, 0, 2),
      REMAP.onRemove(tracks, 1),
      REMAP.onInsert(tracks, 0),
    ]) {
      expect(kind.map(t => t.path)).toEqual(['axes.wght', 'size', 'glyph.dy'])
    }
  })
})
