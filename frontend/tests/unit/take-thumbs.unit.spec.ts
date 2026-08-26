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
import { describe, expect, it, vi } from 'vitest'
import { docAspect, isTakeThumbStudioId, TAKE_THUMB_STUDIO_IDS, takeThumbFor, thumbDims, thumbDimsFor } from '~/lib/agent/takeThumbs'

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
    expect(body).toMatch(/thumbDimsFor/)
    expect(body).not.toMatch(/render\(cfg, size, size/)
  })
})


// ── every studio's tile carries ITS document's shape ────────────────────────
//
// The same defect class the gradient fix proved: a tile rendered square while
// the studio renders wide is a different picture, and the promise checker and
// the duplicate-separation pass both measure the tile. Four adapters still
// assumed square. Two of them genuinely are; two were not.
describe('thumbDims reaches the adapters that have a shape', () => {
  const src = readFileSync(fileURLToPath(new URL('../../app/lib/agent/takeThumbs.ts', import.meta.url)), 'utf8')
  const bodyOf = (name: string) => {
    const i = src.indexOf(`async function ${name}`)
    const rest = src.slice(i)
    return rest.slice(0, rest.indexOf('\n}\n') + 2)
  }

  it('the adapter signature accepts the aspect its studio knows', () => {
    // Shape and Vector Type keep their canvas dimensions on the NODE, not in
    // the config the adapter receives, so the studio has to hand it over.
    expect(src).toMatch(/aspect\?: number/)
  })

  it('vector type renders at the passed aspect', () => {
    expect(bodyOf('vectorTypeThumb')).toMatch(/thumbDims/)
  })

  it('shape renders at the passed aspect', () => {
    expect(bodyOf('shapeThumb')).toMatch(/thumbDims/)
  })

  it('texture and shader say IN WORDS why they stay square', () => {
    // Not an oversight either way: a texture tile is a repeating unit with no
    // aspect of its own, and the shader studio has no canvas dimensions at all.
    // Both must say so, so the next reader does not "fix" them.
    expect(bodyOf('textureThumb')).toMatch(/square/i)
    expect(bodyOf('shaderThumb')).toMatch(/square/i)
  })
})


// ── integration: REAL configs, the REAL argument shapes the surfaces pass ────
//
// Owner report #7 was "every tile, including yours, says couldn't draw" — the
// adapter's null-on-throw path firing for everything. It was not reproducible at
// HEAD (see the task report), but the episode exposed two real defects worth
// fixing regardless: the dimension decision was duplicated inline in five
// adapters where no test could see it, and the catch that hid the failure said
// nothing at all. This block tests the decision against configs the studios
// really produce — the class of bug a hand-mocked adapter cannot show.
describe('thumbDimsFor — real configs, real argument shapes', () => {
  it('reads the gradient document\u2019s own aspect string', async () => {
    const { defaultConfig } = await import('~/lib/gradientfx/randomize')
    const cfg: any = defaultConfig('#p')
    cfg.canvas.aspect = '16:9'
    expect(thumbDimsFor('gradient', cfg, 160)).toEqual({ w: 160, h: 90 })
    cfg.canvas.aspect = '9:16'
    expect(thumbDimsFor('gradient', cfg, 160)).toEqual({ w: 90, h: 160 })
  })

  it('survives every wrong-shaped aspect a persisted gradient config could carry', () => {
    // `aspectRatio` splits a STRING. A config that ever carried a number, a
    // null, or a nonsense label must yield a usable tile, not a thrown adapter
    // that turns the whole strip into error tiles.
    for (const aspect of [undefined, null, 1.7777, '', 'custom', '0:0', ':', { w: 16 }, ['16', '9']]) {
      const dims = thumbDimsFor('gradient', { canvas: { aspect } }, 160)
      expect(dims.w).toBeGreaterThanOrEqual(1)
      expect(dims.h).toBeGreaterThanOrEqual(1)
    }
    expect(thumbDimsFor('gradient', undefined, 160)).toEqual({ w: 160, h: 160 })
    expect(thumbDimsFor('gradient', null, 160)).toEqual({ w: 160, h: 160 })
  })

  it('takes the studio-supplied aspect for the two studios whose shape is node state', () => {
    expect(thumbDimsFor('shape', {}, 160, 16 / 9)).toEqual({ w: 160, h: 90 })
    expect(thumbDimsFor('vectortype', {}, 160, 16 / 9)).toEqual({ w: 160, h: 90 })
    // …and squares them when the studio says nothing.
    expect(thumbDimsFor('shape', {}, 160)).toEqual({ w: 160, h: 160 })
    expect(thumbDimsFor('vectortype', {}, 160)).toEqual({ w: 160, h: 160 })
  })

  it('ignores a supplied aspect for the two studios that are genuinely square', () => {
    expect(thumbDimsFor('texture', {}, 160, 16 / 9)).toEqual({ w: 160, h: 160 })
    expect(thumbDimsFor('shader', {}, 160, 16 / 9)).toEqual({ w: 160, h: 160 })
  })

  it('every registered studio has a dimension answer, and it is always drawable', () => {
    for (const id of TAKE_THUMB_STUDIO_IDS) {
      for (const aspect of [undefined, 0, -1, Number.NaN, 1e9]) {
        const { w, h } = thumbDimsFor(id, {}, 160, aspect as number)
        expect(Number.isFinite(w) && w >= 1, `${id}/${aspect}`).toBe(true)
        expect(Number.isFinite(h) && h >= 1, `${id}/${aspect}`).toBe(true)
      }
    }
  })
})

describe('docAspect — what the surfaces hand over', () => {
  it('is width over height', () => {
    expect(docAspect(1280, 720)).toBeCloseTo(16 / 9, 5)
  })

  it('never yields something thumbDims has to rescue', () => {
    for (const [w, h] of [[0, 0], [1024, 0], [0, 1024], [-5, 10], [Number.NaN, 100], [100, Number.NaN]]) {
      const a = docAspect(w as number, h as number)
      expect(Number.isFinite(a)).toBe(true)
      expect(a).toBeGreaterThan(0)
    }
  })

  it('is what BOTH studios with node-side dimensions actually call', async () => {
    const fs = await import('node:fs')
    for (const f of ['ShapeStudioSurface.vue', 'VectorTypeSurface.vue']) {
      const src = fs.readFileSync(`${process.cwd()}/app/components/vue-canvas/${f}`, 'utf8')
      // One shared, tested helper rather than an inline expression per surface —
      // an inline `w / h` is exactly where a 0 or a NaN slips in unseen.
      expect(src, f).toMatch(/aspect: \(\) => docAspect\(/)
    }
  })
})

describe('the adapter never fails silently', () => {
  it('says which studio failed and why', async () => {
    // The standing lesson, applied: a graceful fallback that says nothing turns
    // an integration failure into a day of guessing. In node there is no
    // `document`, so every real adapter throws for real inside its own try —
    // this exercises the actual catch, not a stub of it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await takeThumbFor('gradient')({}, 160)).toBeNull()
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls.flat().join(' '))).toContain('gradient')
    warn.mockRestore()
  })

  it('an unknown studio is not a failure and says nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await takeThumbFor('nope')({}, 160)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
