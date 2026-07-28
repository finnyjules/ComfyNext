/**
 * TIER 3 — the honest raster embed, for the three fills that cannot be vector.
 *
 * `ombre` and `noise` are per-pixel stochastic dithers with no SVG primitive to
 * express them, and `shader` is a WebGL2 fragment program — pixels by
 * construction, with no geometric description to recover. The user chose all
 * nine fill types knowing this. So the goal here is not to hide the degradation:
 * it is that the export is CORRECT and DECLARED, which means a real, working,
 * self-contained `<pattern><image href="data:image/png;base64,…">` rather than a
 * flat colour that silently throws the fill away.
 *
 * What this file pins, none of which a picture can see:
 *
 *  - **The spine stays pure.** `lib/vector/svg.ts` is documented "no DOM, no
 *    canvas, no fetch" — the property that makes it reusable (Shape Studio is
 *    its intended second consumer). The data URL is encoded in
 *    `vectortype/canvas.ts` and PASSED IN. Asserted against the spine's own
 *    source text, not just its behaviour.
 *  - **The embed is at EXPORT resolution.** `resolveField` clamps a live request
 *    to 512 px; an export that inherits that clamp embeds a soft bitmap. The
 *    export path passes `bake: true` and asks for the document's own size, and
 *    the raster scale can never fall BELOW 1:1.
 *  - **The bridge survives only where there are no pixels to be had.** With no
 *    canvas (SSR, a worker, this test environment by default) the flat colour is
 *    still the answer — an empty fill would be worse than a wrong one.
 *  - **A raster never beats real geometry.** Offer one to `grid` and it must
 *    still emit its rectangles.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type Affine,
  type VectorPattern,
  type VectorShape,
  isVectorPattern,
  shapesToSVG,
} from '~/lib/vector/svg'
import { paintIsVector, paintToVectorPaint } from '~/lib/paint/toVector'
import { DEFAULT_FILL, DEFAULT_SHADER_SPEC, type Fill, type FillType } from '~/lib/spacetype/fillTile'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import { DEFAULT_CONFIG, mergeConfig, type VectorTypeConfig } from '~/lib/vectortype/config'

// ── the two mocks, and why they are the only two ────────────────────────────
//
// The PIXELS are not under test here — they cannot be, in a node environment
// with no canvas, and their correctness is a pixel diff against the canvas
// renderer in a browser, not an assertion about a string. What IS under test is
// the WIRING: that the export asks for a bake-resolution field, that it copies
// once per box and no more, and that the encoded string reaches the spine.
//
// So `resolvePaint` is stubbed to a flat colour (it is `lib/paint/resolve`'s, and
// exercising it would mean re-implementing a 2D canvas), and `withFieldFrame` is
// a pass-through that records what the export asked its field span for.

const paintCalls: Array<{ w: number; h: number }> = []
vi.mock('~/lib/paint/resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/paint/resolve')>()
  return {
    ...actual,
    resolvePaint: (_ctx: unknown, _paint: unknown, box: { w: number; h: number }) => {
      paintCalls.push({ ...box })
      return '#ff00ff'
    },
  }
})

const spans: Array<Array<{ w: number; h: number; bake?: boolean; t: number }>> = []
vi.mock('~/lib/shaderfill/field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/shaderfill/field')>()
  return {
    ...actual,
    withFieldFrame: (requests: any[], fn: (frozen: number, token: number) => unknown) => {
      spans.push(requests.map(r => ({ w: r.w, h: r.h, bake: r.bake, t: r.t })))
      return fn(0, 7)
    },
  }
})

// Imported AFTER the mocks so the module graph picks them up.
const { vectorTypeSVG } = await import('~/lib/vectortype/canvas')

// ── fixtures ────────────────────────────────────────────────────────────────

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return { id: 'inter-subset', axes: normaliseAxes(raw?.variationAxes), unitsPerEm: Number(raw?.unitsPerEm) || 1000, raw }
}
const font = loadFixtureFont()
const BOX = { width: 800, height: 300 }
const UNIT_BOX = { x: 0, y: 0, width: 240, height: 120 }
const RASTER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
/** The three that cannot be vector at any tier. Not a list the code consults —
 *  the emitters decide, and `paintIsVector` is asked to confirm it below. */
const RASTER_KINDS: FillType[] = ['ombre', 'noise', 'shader']

function fill(type: FillType, patch: Partial<Fill> = {}): Fill {
  return { ...DEFAULT_FILL, type, a: '#ffe600', b: '#111111', angle: 35, density: 8, ...patch }
}

function shaderFill(anchor: 'object' | 'frame' = 'object'): Fill {
  return fill('shader', { shader: { ...DEFAULT_SHADER_SPEC, anchor } })
}

function cfg(patch: Partial<VectorTypeConfig> & Record<string, unknown> = {}): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: 'Sail', size: 150, ...patch })
}

// ── the fake canvas, which is also the measuring instrument ─────────────────
//
// `toDataURL` encodes the canvas's own pixel dimensions into the returned
// string, so an assertion on the emitted `href` is an assertion on the
// resolution the export rasterised at. That is the whole point: a 512-clamped
// embed and a full-resolution one produce SVG that is otherwise identical.

interface FakeCanvas { width: number; height: number; transforms: number[][] }
const encoded: FakeCanvas[] = []

function installFakeDom(): void {
  ;(globalThis as any).document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
      const c: any = { width: 0, height: 0, transforms: [] as number[][] }
      const ctx: any = {
        fillStyle: '',
        setTransform: (...m: number[]) => { c.transforms.push(m) },
        getTransform: () => ({ tag: 'base' }),
        translate: () => {},
        fillRect: () => {},
      }
      c.getContext = (kind: string) => (kind === '2d' ? ctx : null)
      c.toDataURL = () => {
        encoded.push({ width: c.width, height: c.height, transforms: c.transforms })
        return `data:image/png;base64,STUB-${c.width}x${c.height}`
      }
      return c
    },
  }
}

beforeEach(() => {
  encoded.length = 0
  spans.length = 0
  paintCalls.length = 0
  installFakeDom()
})
afterEach(() => { delete (globalThis as any).document })

// ── the spine ───────────────────────────────────────────────────────────────

describe('<pattern><image> — the spine emits a raster it was HANDED', () => {
  const square: VectorShape['commands'] = [
    { command: 'moveTo', args: [0, 0] },
    { command: 'lineTo', args: [10, 0] },
    { command: 'lineTo', args: [10, 10] },
    { command: 'closePath', args: [] },
  ]
  const imagePattern = (image: string, w = 240, h = 120): VectorPattern => ({
    type: 'pattern', width: w, height: h, rects: [], image,
  })

  it('has NO encoder of its own — pinned against the spine\'s source, not its output', () => {
    // Trap 3. The property that makes this module reusable is that it touches no
    // DOM, and a raster embed is exactly the feature that would break it: the
    // obvious implementation reaches for a canvas. Behaviour cannot prove the
    // absence of a call that only fires on some input, so this reads the file.
    const src = readFileSync(fileURLToPath(new URL('../../app/lib/vector/svg.ts', import.meta.url)), 'utf8')
    for (const forbidden of ['createElement', 'toDataURL', 'getContext', 'fetch(', 'OffscreenCanvas', 'window.', 'ImageData']) {
      expect(src).not.toContain(forbidden)
    }
    // …and it does emit one when handed the finished string.
    const svg = shapesToSVG([{ commands: square, fill: imagePattern(RASTER) }], { width: 20, height: 20 })
    expect(svg).toContain(`href="${RASTER}"`)
    expect(svg).toMatch(/<image id="[^"]+" width="240" height="120" preserveAspectRatio="none" href="data:image\/png/)
    expect(svg).toMatch(/<pattern[^>]*><use href="#[^"]+"\/><\/pattern>/)
  })

  it('stretches the image onto the tile exactly, whatever its pixel dimensions', () => {
    // `preserveAspectRatio="none"` plus the tile's own extent. The encoded bitmap
    // is a ROUNDING of the tile size, and the default `xMidYMid meet` would
    // letterbox that rounding into a visible seam at the tile boundary.
    const svg = shapesToSVG([{ commands: square, fill: imagePattern(RASTER, 129.694, 64.847) }], { width: 20, height: 20 })
    const img = /<image[^>]*\/>/.exec(svg)?.[0] as string
    expect(img).toContain('width="129.694"')
    expect(img).toContain('height="64.847"')
    expect(img).toContain('preserveAspectRatio="none"')
    expect(img).not.toContain('x="')                     // the tile sits at the origin
  })

  it('carries no background and no rects under the image', () => {
    const svg = shapesToSVG([{ commands: square, fill: imagePattern(RASTER) }], { width: 20, height: 20 })
    const pat = /<pattern[^>]*>.*?<\/pattern>/s.exec(svg)?.[0] as string
    expect((pat.match(/<rect/g) ?? []).length).toBe(0)
    expect((pat.match(/<use/g) ?? []).length).toBe(1)
    expect((svg.match(/<image/g) ?? []).length).toBe(1)
  })

  it('shares ONE pattern between shapes carrying the same raster, and splits on a different one', () => {
    const two = (a: string, b: string) => shapesToSVG([
      { commands: square, fill: imagePattern(a) },
      { commands: square, fill: imagePattern(b) },
    ], { width: 20, height: 20 })
    expect((two(RASTER, RASTER).match(/<pattern /g) ?? []).length).toBe(1)
    expect((two(RASTER, `${RASTER}AAAA`).match(/<pattern /g) ?? []).length).toBe(2)
    // …and one COPY of the picture per distinct picture, however many patterns
    // place it: a run-anchored fill under per-glyph motion emits one pattern per
    // letter, all carrying the same raster.
    expect((two(RASTER, RASTER).match(/<image /g) ?? []).length).toBe(1)
    expect((two(RASTER, `${RASTER}AAAA`).match(/<image /g) ?? []).length).toBe(2)
  })

  it('leaves a pattern with no image exactly as it was — the four vector tiles are untouched', () => {
    const svg = shapesToSVG([{
      commands: square,
      fill: { type: 'pattern', width: 10, height: 10, background: '#fff', rects: [{ x: 0, y: 0, width: 5, height: 5, fill: '#000' }] },
    }], { width: 20, height: 20 })
    expect(svg).not.toContain('<image')
    expect(svg).toContain('<rect width="10" height="10" fill="#fff"/>')
  })
})

// ── the adapter ─────────────────────────────────────────────────────────────

describe('paintToVectorPaint — the three raster-only kinds, with pixels in hand', () => {
  it('emits ONE image over the whole box for every one of them', () => {
    for (const type of RASTER_KINDS) {
      const p = paintToVectorPaint(fill(type), { units: 'userSpaceOnUse', box: UNIT_BOX, raster: RASTER })
      if (!isVectorPattern(p)) throw new Error(`${type} did not emit a pattern`)
      expect(p.image).toBe(RASTER)
      expect(p.rects).toEqual([])
      expect(p.background).toBeUndefined()
      // The tile IS the box — like `qr`, which is also not periodic. Anything
      // smaller would tile a picture that has no period.
      expect(p.width).toBe(UNIT_BOX.width)
      expect(p.height).toBe(UNIT_BOX.height)
    }
  })

  it('anchors the image to the box corner, and cancels the shape transform under a run anchor', () => {
    const elementTransform: Affine = [1, 0, 0, 1, 30, -12]
    const box = { x: 140, y: 90, width: 240, height: 120 }
    const run = paintToVectorPaint(fill('noise'), { units: 'userSpaceOnUse', box, elementTransform, raster: RASTER })
    // inverse(T(30,-12)) · T(140,90) — the letter moves, the picture does not.
    expect((run as VectorPattern).transform).toEqual([1, 0, 0, 1, 110, 102])
    const glyph = paintToVectorPaint(fill('noise'), { units: 'objectBoundingBox', box, elementTransform, raster: RASTER })
    // The per-shape anchor does NOT cancel it: the fill is meant to ride the letter.
    expect((glyph as VectorPattern).transform).toEqual([1, 0, 0, 1, 140, 90])
  })

  it('stays on the bridge with no raster in hand — SSR, a worker, a unit test', () => {
    for (const type of RASTER_KINDS) {
      expect(paintToVectorPaint(fill(type), { units: 'userSpaceOnUse', box: UNIT_BOX })).toBeNull()
      expect(paintToVectorPaint(fill(type), { units: 'userSpaceOnUse', box: UNIT_BOX, raster: null })).toBeNull()
    }
  })

  it('refuses to place a raster with no box to place it in', () => {
    expect(paintToVectorPaint(fill('shader'), { units: 'objectBoundingBox', raster: RASTER })).toBeNull()
  })

  it('never lets a raster beat real geometry', () => {
    // Offering pixels to a kind that HAS a vector form must change nothing: the
    // four procedural fills keep emitting rectangles, and `solid`/`gradient` keep
    // their flat colour and their paint server.
    for (const type of ['grid', 'checkerboard', 'stripes', 'qr'] as FillType[]) {
      const p = paintToVectorPaint(fill(type), { units: 'userSpaceOnUse', box: UNIT_BOX, raster: RASTER }) as VectorPattern
      expect(p.image).toBeUndefined()
      expect(p.rects.length).toBeGreaterThan(0)
    }
    expect(paintToVectorPaint(fill('solid'), { units: 'userSpaceOnUse', box: UNIT_BOX, raster: RASTER })).toBe('#ffe600')
    const g = paintToVectorPaint(fill('gradient'), { units: 'userSpaceOnUse', box: UNIT_BOX, raster: RASTER })
    expect(isVectorPattern(g)).toBe(false)
  })

  it('leaves the export TIER answered by kind — a raster does not make a paint vector', () => {
    for (const type of RASTER_KINDS) expect(paintIsVector(fill(type))).toBe(false)
  })
})

// ── the export path: where the data URL is made ─────────────────────────────

describe('vectorTypeSVG — the raster embed, end to end', () => {
  // The embed lives ONCE in `<defs>` as a shared `<image>`; each pattern `<use>`s
  // it (see `Defs.images` — five patterns under motion carried five identical
  // copies before that).
  const href = (svg: string) => /<image[^>]*href="([^"]+)"/.exec(svg)?.[1] as string

  it('embeds a real data URL for every one of the three, on every anchor', () => {
    for (const type of RASTER_KINDS) {
      for (const anchor of ['glyph', 'word', 'frame']) {
        const { svg } = vectorTypeSVG(font, cfg({ fill: fill(type), fillAnchor: anchor }), 0, BOX)
        expect(svg).toContain('<pattern ')
        expect(svg).toMatch(/fill="url\(#[^"]+-p\d+\)"/)
        expect(href(svg)).toMatch(/^data:image\/png;base64,/)
        // The glyphs are still real outlines — the raster is the FILL, not the
        // artwork. A traced/rasterised export would have neither.
        expect(svg).toMatch(/<path d="M/)
      }
    }
  })

  it('rasterises at EXPORT resolution — the 512 live clamp cannot reach it', () => {
    // The frame anchor's box is the whole document, so the number in the stub URL
    // is the document at the embed scale. 512 would be the live clamp; 800 would
    // be 1:1; the default supersamples one doubling past that.
    const { svg } = vectorTypeSVG(font, cfg({ fill: shaderFill(), fillAnchor: 'frame' }), 0, BOX)
    expect(href(svg)).toBe('data:image/png;base64,STUB-1600x600')
    expect(encoded).toEqual([{ width: 1600, height: 600, transforms: expect.anything() }])
  })

  it('asks the field for a BAKE at that size — not a live, ceiling-limited one', () => {
    // Trap: `resolveField` clamps a non-bake request to 512 px, and the span has
    // to budget the SAME key `resolveShaderFill` then asks for or the field
    // silently freezes at t=0. A frame-anchored field is asked for at the frame's
    // own embed size; an object-anchored one at the fixed OBJECT_SHADER_FIELD_PX.
    vectorTypeSVG(font, cfg({ fill: shaderFill('frame'), fillAnchor: 'frame' }), 0, BOX)
    expect(spans.at(-1)).toEqual([{ w: 1600, h: 600, bake: true, t: 0 }])
    vectorTypeSVG(font, cfg({ fill: shaderFill('object'), fillAnchor: 'word' }), 0, BOX)
    expect(spans.at(-1)).toEqual([{ w: 1024, h: 1024, bake: true, t: 0 }])
  })

  it('honours rasterScale, and can never be pushed BELOW 1:1', () => {
    const at = (fillIn: Fill, rasterScale?: number) => {
      const { svg } = vectorTypeSVG(font, cfg({ fill: fillIn, fillAnchor: 'frame' }), 0, { ...BOX, rasterScale })
      return href(svg)
    }
    expect(at(fill('ombre'), 1)).toBe('data:image/png;base64,STUB-800x300')
    expect(at(fill('ombre'), 4)).toBe('data:image/png;base64,STUB-3200x1200')
    // The floor is the whole point of the clamp: an export must never be softer
    // than the document it is an export of.
    expect(at(fill('ombre'), 0.25)).toBe('data:image/png;base64,STUB-800x300')
    expect(at(fill('ombre'), Number.NaN)).toBe('data:image/png;base64,STUB-800x300')
  })

  it('defaults a DITHER to 1:1 and a shader FIELD to 2x — the measured split', () => {
    // A shader field is a continuous function being sampled, so supersampling it
    // measured 0.0000 % against the canvas — free crispness. A dither's raster
    // grid IS the artwork, and supersampling it measured 56-91 % of core pixels
    // different (an 8x8 block mean off by 10-17/255): a FINER grain, not a
    // sharper picture. An explicit request still wins for either.
    const at = (fillIn: Fill, rasterScale?: number) => {
      const { svg } = vectorTypeSVG(font, cfg({ fill: fillIn, fillAnchor: 'frame' }), 0, { ...BOX, rasterScale })
      return href(svg)
    }
    for (const type of ['ombre', 'noise'] as FillType[]) {
      expect(at(fill(type))).toBe('data:image/png;base64,STUB-800x300')
    }
    expect(at(shaderFill())).toBe('data:image/png;base64,STUB-1600x600')
    expect(at(shaderFill(), 1)).toBe('data:image/png;base64,STUB-800x300')
    expect(at(fill('ombre'), 2)).toBe('data:image/png;base64,STUB-1600x600')
  })

  it('spends ONE encode for the run, and one per INKED letter', () => {
    // A shared image at the glyph anchor would be the wrong picture on five of
    // six letters; a per-letter image at the word anchor would be six copies of
    // the same one. And a space has no path in the output, so it costs nothing.
    vectorTypeSVG(font, cfg({ fill: fill('noise'), fillAnchor: 'word' }), 0, BOX)
    expect(encoded.length).toBe(1)
    encoded.length = 0
    const { svg } = vectorTypeSVG(font, cfg({ text: 'Sa il', fill: fill('noise'), fillAnchor: 'glyph' }), 0, BOX)
    expect(encoded.length).toBe(4)                       // 5 glyphs, one of them a space
    expect((svg.match(/<pattern /g) ?? []).length).toBe(4)
    // Each letter's tile is its own ink box, so no two are the same size.
    expect(new Set(encoded.map(c => `${c.width}x${c.height}`)).size).toBe(4)
  })

  it('resolves each embed over the box it will be stretched onto', () => {
    // The resolver is asked for the box in DOCUMENT units (its geometry is built
    // in those), while the canvas it draws into is that box at the embed scale.
    // Getting this pair crossed is how a gradient inside a shader's input ends up
    // twice the size of the tile that carries it.
    vectorTypeSVG(font, cfg({ fill: shaderFill(), fillAnchor: 'frame' }), 0, BOX)
    expect(paintCalls).toEqual([{ w: 800, h: 300 }])
    expect(encoded[0]).toMatchObject({ width: 1600, height: 600 })
  })

  it('carries ONE copy of the picture under motion, however many patterns place it', () => {
    // A run-anchored paint under per-glyph motion needs one pattern PER GLYPH —
    // each carrying that glyph's own inverse transform, which is what pins the
    // paint in document space. The picture inside every one of them is the same,
    // and before the shared `<image>` each pattern carried its own base64 copy:
    // measured in Chrome on a six-letter word, 161 KB still and 794 KB moving.
    const moving = mergeConfig({
      ...cfg({ fill: fill('noise'), fillAnchor: 'word' }),
      motion: {
        duration: 4, fps: 30,
        tracks: [{ path: 'glyph.dx', from: -40, to: 40, easing: 'linear' }],
        stagger: { delay: 0.12, order: 'first-to-last', seed: 0 },
      },
    } as never)
    const { svg } = vectorTypeSVG(font, moving, 0.37, BOX)
    expect((svg.match(/<pattern /g) ?? []).length).toBeGreaterThan(1)
    expect((svg.match(/<image /g) ?? []).length).toBe(1)
    expect((svg.match(/<use href="#/g) ?? []).length).toBe((svg.match(/<pattern /g) ?? []).length)
    // …and ONE encode, not one per pattern.
    expect(encoded.length).toBe(1)
  })

  it('degrades to the flat colour with no canvas at all — the surviving bridge', () => {
    delete (globalThis as any).document
    for (const type of RASTER_KINDS) {
      const { svg } = vectorTypeSVG(font, cfg({ fill: fill(type) }), 0, BOX)
      expect(svg).not.toContain('<image')
      expect(svg).not.toContain('<pattern')
      expect(svg).toContain('fill="#ffe600"')
    }
  })

  it('never embeds a raster for a fill that HAS a vector form, or for no fill at all', () => {
    for (const type of ['solid', 'gradient', 'grid', 'checkerboard', 'stripes', 'qr'] as FillType[]) {
      const { svg } = vectorTypeSVG(font, cfg({ fill: fill(type) }), 0, BOX)
      expect(svg).not.toMatch(/<image|base64|data:image/)
    }
    // An absent/unrecognised fill has no vector form either, and must NOT be
    // handed to the resolver: it comes back `undefined`, and a canvas fills
    // BLACK for it. The flat fallback is the right answer here.
    const { svg } = vectorTypeSVG(font, cfg({ fill: undefined as any }), 0, BOX)
    expect(svg).not.toContain('<image')
    expect(encoded.length).toBe(0)
  })
})
