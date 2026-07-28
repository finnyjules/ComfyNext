/**
 * Vector Type — the export tier, folded over the APPEARANCE STACK.
 *
 * `exportTier(paint)` (pinned by `vector-export-tier.unit.spec.ts`) answers for
 * ONE paint by asking the emitter. This spec is about what that means for a
 * DOCUMENT with several layers in it, and there are four distinct claims:
 *
 *  1. **The fold.** The whole export is as bad as its worst layer — one raster
 *     layer makes the file raster — and `vector`/`pattern` compose the same way.
 *  2. **Extrude is vector.** An extrude emits glyph outlines, so its tier is its
 *     PAINT's tier and an extruded gradient stack still reports `vector`. This
 *     is the case a `kind`-aware implementation would get wrong.
 *  3. **It names the layer.** Not "this file contains a raster" — which layer.
 *  4. **Only painting layers count**, and "painting" means what the RENDERER
 *     means by it. Those four drop rules are the one thing `exportTier.ts`
 *     restates rather than imports (`vtPaintLayers` is private to `canvas.ts`),
 *     so every one of them is checked here against the shapes `vectorTypeSVG`
 *     really emitted — not against a second reading of the same intention.
 *
 * The `describe` blocks are ordered by how easy each would be to fake, hardest
 * last: the last block builds real SVG documents with the shared Inter subset
 * and counts `<path>` elements.
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
  mergeConfig,
  vtLayer,
  type VectorTypeConfig,
  type VtAppearanceLayer,
} from '~/lib/vectortype/config'
import { vectorTypeSVG } from '~/lib/vectortype/canvas'
import { vtExportTier, vtRasterNote } from '~/lib/vectortype/exportTier'
import { exportTier } from '~/lib/paint/toVector'
import { DEFAULT_FILL, FILL_TYPES, type Fill } from '~/lib/spacetype/fillTile'

// ── fixtures ────────────────────────────────────────────────────────────────

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return {
    id: 'inter-subset',
    axes: normaliseAxes(raw?.variationAxes),
    unitsPerEm: Number(raw?.unitsPerEm) || 1000,
    raw,
  }
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
const fill = (type: Fill['type']): Fill => ({ ...DEFAULT_FILL, type })
const paths = (svg: string): string[] => [...svg.matchAll(/<path\b[^>]*\/>/g)].map(m => m[0] as string)

/** The three kinds that have no vector form of their own, DERIVED — asking the
 *  same helper the studio asks, so this fixture cannot be the thing that rots. */
const RASTER_KINDS = FILL_TYPES.filter(t => exportTier(fill(t)) === 'raster')
const VECTOR_KINDS = FILL_TYPES.filter(t => exportTier(fill(t)) !== 'raster')

// ── 1. the fold ─────────────────────────────────────────────────────────────

describe('the tier folds over the stack — the file is as bad as its worst layer', () => {
  it('reports RASTER for a stack containing ONE shader layer', () => {
    // The headline. Two perfectly-vector layers do not rescue the document.
    const c = stack(
      { kind: 'fill', paint: fill('gradient') },
      { kind: 'stroke', width: 4, paint: '#101014' },
      { kind: 'fill', paint: fill('shader') },
    )
    expect(vtExportTier(c).tier).toBe('raster')
  })

  it('reports VECTOR when every layer is vector, however many there are', () => {
    const c = stack(
      { kind: 'stroke', width: 8, paint: '#00c8ff' },
      { kind: 'fill', paint: fill('gradient') },
      { kind: 'fill', paint: '#ff2200' },
      { kind: 'stroke', width: 2, paint: fill('solid') },
    )
    expect(vtExportTier(c).tier).toBe('vector')
    expect(vtExportTier(c).layers).toHaveLength(4)
    expect(vtRasterNote(vtExportTier(c))).toBeNull()
  })

  it('reports PATTERN when the worst layer is a pattern, and raster still beats it', () => {
    const withPattern = stack(
      { kind: 'fill', paint: fill('gradient') },
      { kind: 'fill', paint: fill('stripes') },
    )
    expect(vtExportTier(withPattern).tier).toBe('pattern')
    // …and pattern does not survive a raster layer joining it.
    const withBoth = stack(
      { kind: 'fill', paint: fill('stripes') },
      { kind: 'fill', paint: fill('noise') },
    )
    expect(vtExportTier(withBoth).tier).toBe('raster')
  })

  it('is order-independent — a raster layer at the bottom taints just as much', () => {
    const top = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'fill', paint: fill('shader') })
    const bottom = stack({ kind: 'fill', paint: fill('shader') }, { kind: 'fill', paint: '#ff2200' })
    expect(vtExportTier(top).tier).toBe('raster')
    expect(vtExportTier(bottom).tier).toBe('raster')
  })

  it('calls an EMPTY stack vector — an empty document is not a raster one', () => {
    const empty = vtExportTier(cfg({ appearance: [] }))
    expect(empty.tier).toBe('vector')
    expect(empty.layers).toEqual([])
    expect(vtRasterNote(empty)).toBeNull()
  })

  it('agrees with `exportTier` layer for layer — the fold adds nothing of its own', () => {
    const c = stack(
      { kind: 'fill', paint: fill('qr') },
      { kind: 'extrude', depth: 4, paint: fill('gradient') },
      { kind: 'stroke', width: 3, paint: fill('ombre') },
    )
    const t = vtExportTier(c)
    for (const l of t.layers) {
      expect(l.tier, l.label).toBe(exportTier(c.appearance[l.index]!.paint))
    }
  })

  it('covers every fill type the catalog has, on a stack, with no kind list of its own', () => {
    // Exhaustive over FILL_TYPES in BOTH directions: a tenth type is answered on
    // the day it is added, and a kind that stops being raster stops warning.
    expect(RASTER_KINDS.length).toBeGreaterThan(0)
    expect(VECTOR_KINDS.length).toBeGreaterThan(0)
    for (const type of FILL_TYPES) {
      const c = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'fill', paint: fill(type) })
      expect(vtExportTier(c).tier === 'raster', type).toBe(RASTER_KINDS.includes(type))
    }
  })
})

// ── 2. extrude is vector ────────────────────────────────────────────────────

describe('an EXTRUDE is vector — its tier is its paint’s, never its kind’s', () => {
  it('reports VECTOR for an extruded GRADIENT stack', () => {
    // The required case. An extrude emits `depth` copies of the glyph OUTLINE;
    // there is nothing raster about drawing a path more than once.
    const c = stack(
      { kind: 'extrude', depth: 8, distance: 3, angle: 135, paint: fill('gradient') },
      { kind: 'fill', paint: fill('gradient') },
    )
    expect(vtExportTier(c).tier).toBe('vector')
    expect(vtExportTier(c).layers.map(l => l.kind)).toEqual(['extrude', 'fill'])
  })

  it('reports VECTOR for a SOLID extrude too — the union is still geometry', () => {
    const c = stack(
      { kind: 'extrude', depth: 8, solid: true, paint: fill('gradient') },
      { kind: 'fill', paint: '#ff2200' },
    )
    expect(vtExportTier(c).tier).toBe('vector')
  })

  it('still reports RASTER for an extrude painted with a raster fill', () => {
    // The other half of the same rule: the KIND is not consulted in either
    // direction. A shader-painted extrude embeds a picture like any other layer.
    for (const type of RASTER_KINDS) {
      const c = stack({ kind: 'extrude', depth: 6, paint: fill(type) }, { kind: 'fill', paint: '#ff2200' })
      expect(vtExportTier(c).tier, type).toBe('raster')
    }
  })
})

// ── 3. it names the layer ───────────────────────────────────────────────────

describe('the note names WHICH layer, not just “this file has a raster”', () => {
  it('names the offending layer by position and fill type', () => {
    const c = stack(
      { kind: 'fill', paint: '#ff2200' },
      { kind: 'stroke', width: 4, paint: '#101014' },
      { kind: 'fill', paint: fill('shader') },
    )
    const t = vtExportTier(c)
    expect(t.raster).toHaveLength(1)
    expect(t.raster[0]).toMatchObject({ index: 2, kind: 'fill', fillType: 'shader' })
    expect(vtRasterNote(t)).toBe('Layer 3 (shader) exports as an embedded image')
  })

  it('prefers the stack UI’s own derived labels when it is given them', () => {
    // Positional names renumber on reorder; the panel's labels do not. The
    // helper takes them rather than owning a second naming scheme.
    const c = stack(
      { kind: 'fill', paint: '#ff2200' },
      { kind: 'fill', paint: fill('shader') },
    )
    expect(vtRasterNote(vtExportTier(c, ['Fill', 'Fill 2'])))
      .toBe('Fill 2 (shader) exports as an embedded image')
  })

  it('names EVERY offender when a stack has several, and pluralises', () => {
    const c = stack(
      { kind: 'fill', paint: fill('ombre') },
      { kind: 'fill', paint: '#ff2200' },
      { kind: 'fill', paint: fill('shader') },
    )
    const note = vtRasterNote(vtExportTier(c))!
    expect(note).toContain('Layer 1 (ombre)')
    expect(note).toContain('Layer 3 (shader)')
    expect(note).not.toContain('Layer 2')
    expect(note).toMatch(/export as embedded images$/)
  })

  it('the index it reports addresses the layer the user would click', () => {
    // Not the index within the *painting* subset: a disabled layer above the
    // offender must not shift the number the note prints.
    const c = stack(
      { kind: 'fill', enabled: false, paint: '#ff2200' },
      { kind: 'fill', paint: '#00c8ff' },
      { kind: 'fill', paint: fill('noise') },
    )
    const t = vtExportTier(c)
    expect(t.layers.map(l => l.index)).toEqual([1, 2])
    expect(t.raster[0]!.index).toBe(2)
    expect(vtRasterNote(t)).toBe('Layer 3 (noise) exports as an embedded image')
  })

  it('says nothing about a layer whose paint has no fill type to name', () => {
    // A `Gradient` (multi-stop / radial) is a Paint arm with no `type` field —
    // `isFill` is what makes naming safe, and the label falls back to the layer.
    const grad = { type: 'linear' as const, angle: 45, stops: [{ offset: 0, color: '#ff2200' }, { offset: 1, color: '#0044ff' }] }
    const c = stack({ kind: 'fill', paint: grad })
    expect(vtExportTier(c).layers[0]!.fillType).toBeNull()
    // …and a bare colour string is LIFTED to a solid Fill by `mergeConfig`, so
    // the only configs that reach the string arm are unmerged ones.
    expect(vtExportTier(stack({ kind: 'fill', paint: '#ff2200' })).layers[0]!.fillType).toBe('solid')
  })
})

// ── 4. only layers that actually paint count — against the real document ────

describe('the drop rules agree with the document `vectorTypeSVG` really writes', () => {
  /** How many layers put shapes in the file, read off the emitted SVG. Only
   *  valid for fill/stroke stacks, which emit exactly one path per glyph. */
  const paintedLayers = (c: VectorTypeConfig): number => paths(vectorTypeSVG(font, c, 0, BOX).svg).length / N

  const DROPPED: Array<[string, () => VectorTypeConfig]> = [
    ['disabled', () => stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'fill', enabled: false, paint: fill('shader') })],
    ['zero opacity', () => stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'fill', opacity: 0, paint: fill('shader') })],
    ['zero-width stroke', () => stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'stroke', width: 0, paint: fill('shader') })],
    // `mergeFill` LIFTS a bare string — including `'none'` — into a solid Fill,
    // which always paints. So the non-painting-colour drop is only reachable on
    // a hand-written stack, and this case has to bypass `mergeConfig` to exist
    // at all (Task 3's spec makes the same distinction on the canvas side).
    ['non-painting colour on a hand-written stack', () => ({
      ...cfg({ appearance: [vtLayer({ id: 'L0', kind: 'fill', paint: '#ff2200' })] }),
      appearance: [
        vtLayer({ id: 'L0', kind: 'fill', paint: '#ff2200' }),
        { ...vtLayer({ id: 'L1', kind: 'fill' }), paint: 'none' } as VtAppearanceLayer,
      ],
    })],
  ]

  for (const [why, build] of DROPPED) {
    it(`ignores a ${why} layer — and so does the exporter`, () => {
      const c = build()
      // The exporter emits nothing for it…
      expect(paintedLayers(c), 'paths in the real document').toBe(1)
      // …so neither does the tier, and a hidden shader is not a warning.
      expect(vtExportTier(c).layers).toHaveLength(1)
      expect(vtExportTier(c).tier).toBe('vector')
    })
  }

  it('ignores a depth-0 extrude, which the exporter also draws nothing for', () => {
    const c = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'extrude', depth: 0, paint: fill('shader') })
    expect(paintedLayers(c)).toBe(1)
    expect(vtExportTier(c).tier).toBe('vector')
  })

  it('COUNTS the same layers the exporter emits, over a mixed stack', () => {
    // The agreement, stated as a number rather than case by case: three of these
    // five layers paint, and the document holds exactly 3 × N paths.
    const c = stack(
      { kind: 'fill', paint: '#ff2200' },
      { kind: 'fill', enabled: false, paint: '#00c8ff' },
      { kind: 'stroke', width: 0, paint: '#ffee00' },
      { kind: 'stroke', width: 4, paint: '#101014' },
      { kind: 'fill', opacity: 0.5, paint: fill('gradient') },
    )
    expect(paintedLayers(c)).toBe(3)
    expect(vtExportTier(c).layers.map(l => l.index)).toEqual([0, 3, 4])
  })

  it('detects the drift it is aimed at — an enabled raster layer DOES paint', () => {
    // Negative control for the block above: the drop tests would pass vacuously
    // if a shader-painted fill emitted no path at all in this environment.
    const c = stack({ kind: 'fill', paint: '#ff2200' }, { kind: 'fill', paint: fill('shader') })
    expect(paintedLayers(c)).toBe(2)
    expect(vtExportTier(c).tier).toBe('raster')
  })

  it('reads a PRE-STACK blob through the same migration the renderer uses', () => {
    // A config that never went through `mergeConfig` has no `appearance` array
    // at all; `vtDrawLayers` migrates it, and the tier must see the migrated
    // fill rather than an empty stack reading "vector" by default.
    const legacy = { text: WORD, fill: fill('shader'), strokeWidth: 0 } as unknown as VectorTypeConfig
    expect(vtExportTier(legacy).tier).toBe('raster')
    expect(vtExportTier(legacy).layers.length).toBeGreaterThan(0)
  })
})
