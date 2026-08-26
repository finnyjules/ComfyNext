/**
 * Four Takes (Task 3) — `lib/agent/takeThumbs.ts` registry.
 *
 * CONTRACT ONLY. This suite runs in vitest's default `node` environment
 * (see vitest.config.ts — no `@vitest-environment` docblock here), which has
 * no `document`, no WebGL, no canvas 2D context and no network `$fetch`. So
 * every adapter below throws the instant it tries to touch any of those —
 * which is exactly the scenario the registry's `try/catch → null` contract
 * exists for, and lets these tests exercise it for real (no mocking) rather
 * than only asserting the shape of the code. What this suite CANNOT prove —
 * that a thumbnail actually LOOKS like the take's config — is Task 5's live
 * (browser) pass; see docs/superpowers/specs/2026-08-25-four-takes-design.md
 * scope item 3.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTakeThumbStudioId, TAKE_THUMB_STUDIO_IDS, takeThumbFor, thumbDims } from '~/lib/agent/takeThumbs'

function takeThumbsSource(): string {
  return readFileSync(fileURLToPath(new URL('../../app/lib/agent/takeThumbs.ts', import.meta.url)), 'utf8')
}

describe('takeThumbFor — registry completeness', () => {
  it('covers exactly the five Milestone-A studios', () => {
    expect([...TAKE_THUMB_STUDIO_IDS].sort()).toEqual(
      ['gradient', 'shader', 'shape', 'texture', 'vectortype'].sort(),
    )
  })

  it('returns a callable adapter for every one of the five ids', () => {
    for (const id of TAKE_THUMB_STUDIO_IDS) {
      expect(typeof takeThumbFor(id)).toBe('function')
    }
  })

  it('isTakeThumbStudioId agrees with the id list, both ways', () => {
    for (const id of TAKE_THUMB_STUDIO_IDS) expect(isTakeThumbStudioId(id)).toBe(true)
    for (const bogus of ['scene3d', 'Gradient', 'vector-type', '', 'pattern']) {
      expect(isTakeThumbStudioId(bogus)).toBe(false)
    }
  })

  it('an unknown studio id still returns a callable adapter (never undefined, never throws to call)', () => {
    const adapter = takeThumbFor('scene3d')
    expect(typeof adapter).toBe('function')
  })
})

describe('takeThumbFor — source pin (each adapter wraps a real, named renderer)', () => {
  const src = takeThumbsSource()

  // Each pin names the exact call the studio's own node-card preview or
  // headless bake makes (see this file's own adapter comments for which).
  // A pin breaking is a signal this adapter silently stopped delegating to
  // that seam — not something a runtime test here can see, since every real
  // renderer throws in this environment anyway.
  it.each([
    ['gradient', 'gradientFx.render('],
    ['texture', 'textureFx.render('],
    ['shader', 'shaderFx.render('],
    ['shape', 'renderStudio(doc)'],
    ['shape', 'drawToCanvas(shapes'],
    ['vectortype', 'drawVectorTypeToCanvas('],
  ])('%s adapter source references %s', (_studio, needle) => {
    expect(src).toContain(needle)
  })

  it('imports each renderer from that studio\'s own module, not a duplicate/local reimplementation', () => {
    expect(src).toContain(`from '~/lib/gradientfx/renderer'`)
    expect(src).toContain(`from '~/lib/texturefx/renderer'`)
    expect(src).toContain(`from '~/lib/shaderfx/renderer'`)
    expect(src).toContain(`from '~/lib/geoshape/render'`)
    expect(src).toContain(`from '~/lib/vectortype/canvas'`)
  })
})

describe('takeThumbFor — null on throw (no browser globals in this environment)', () => {
  // `document`, WebGL and `$fetch` are all absent here, so every real adapter
  // fails inside its own try — proving the catch-to-null contract without a
  // single mock. A live pixel check (does the tile look right) is Task 5's.
  it.each(TAKE_THUMB_STUDIO_IDS)('%s adapter resolves null rather than throwing or rejecting', async (id) => {
    const adapter = takeThumbFor(id)
    await expect(adapter({})).resolves.toBeNull()
  })

  it('resolves null for a garbage config too (not just an empty object)', async () => {
    const adapter = takeThumbFor('gradient')
    await expect(adapter(null)).resolves.toBeNull()
    await expect(adapter('not a config')).resolves.toBeNull()
    await expect(adapter(42)).resolves.toBeNull()
  })

  it('an unknown studio id resolves null on every call, same as a failed real adapter', async () => {
    const adapter = takeThumbFor('does-not-exist')
    await expect(adapter({ anything: true })).resolves.toBeNull()
    await expect(adapter({}, 320)).resolves.toBeNull()
  })

  it('never throws SYNCHRONOUSLY — callers can always attach .catch/.then without a try', () => {
    for (const id of TAKE_THUMB_STUDIO_IDS) {
      expect(() => takeThumbFor(id)({})).not.toThrow()
    }
  })
})


// ── the tile must be a picture of the DOCUMENT, not a square crop of it ──────
//
// Live evidence (owner report #6, liquid 16:9 doc): the tile was rendered
// 160×160 while the studio renders 1516×852, so the field was sampled over a
// square window — a DIFFERENT picture from the one on screen. Measured on the
// same take: the square tile read "none" (v 17.53 / h 27.81, ratio 1.59) while
// the real 16:9 render read "horizontal" (v 22.18 / h 37.89, ratio 1.71). The
// promise checker only ever sees the tile, so it was judging a picture the user
// never gets — and a genuinely sideways gradient escaped its own direction check
// on the wrong side of the threshold.
describe('thumbDims — the tile carries the document\u2019s shape', () => {
  it('fits a wide document inside the box', () => {
    expect(thumbDims(16 / 9, 160)).toEqual({ w: 160, h: 90 })
  })

  it('fits a tall document inside the box', () => {
    expect(thumbDims(9 / 16, 160)).toEqual({ w: 90, h: 160 })
  })

  it('leaves a square document square', () => {
    expect(thumbDims(1, 160)).toEqual({ w: 160, h: 160 })
  })

  it('never returns a zero or negative dimension, whatever it is handed', () => {
    for (const a of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1e6, 1e-6]) {
      const { w, h } = thumbDims(a, 160)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(h).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(w) && Number.isFinite(h)).toBe(true)
    }
  })

  it('the gradient adapter renders at the config\u2019s aspect, not a square', async () => {
    // Source pin, house convention: the adapter must ASK the config how wide it
    // is rather than assume the box is square.
    const fs = await import('node:fs')
    const src = fs.readFileSync(`${process.cwd()}/app/lib/agent/takeThumbs.ts`, 'utf8')
    const body = src.slice(src.indexOf('async function gradientThumb'), src.indexOf('async function textureThumb'))
    expect(body).toMatch(/thumbDims/)
    expect(body).toMatch(/aspectRatio/)
    expect(body).not.toMatch(/render\(cfg, size, size/)
  })
})
