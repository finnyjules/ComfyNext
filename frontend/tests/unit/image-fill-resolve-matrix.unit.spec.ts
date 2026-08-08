/**
 * `resolveImageFill` (in `~/lib/paint/resolve.ts`) — the canvas pattern-transform
 * matrix for an `ImageFill` paint. This is the highest-risk, currently-unverified
 * part of the image-fill feature: a corner-origin mistake here would offset every
 * image fill by half the box, and nothing else in the suite would catch it.
 *
 * `resolveFill`'s own pattern matrix is already pinned this way in
 * `paint-spread.unit.spec.ts` — this file does the same for `resolveImageFill`,
 * reusing that spec's `RecCtx`/`FakeMatrix`/DOMMatrix-stub scaffolding.
 *
 * Convention under test (see resolve.ts's header comment): patterns are built
 * CENTRED on the origin — box `{w,h}` maps to `[-w/2..w/2] × [-h/2..h/2]` — so for
 * a 120×60 box the expected translate is always `(-60, -30)` before any `offset`
 * is applied, not `(0, 0)`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/paint/imageFillCache', () => ({
  getFillBitmap: () => ({ naturalWidth: 100, naturalHeight: 100, width: 100, height: 100 }),
  ensureFillBitmaps: () => Promise.resolve(),
}))

// Static, not dynamic: `vi.mock` is hoisted above this import by vitest, so the
// bitmap stub is in place before `lib/paint/resolve` binds `getFillBitmap`.
import { resolvePaint, type ShaderFieldFrameCtx } from '~/lib/paint/resolve'
import type { ImageFill } from '~/lib/compositor/paint'

// ── node stubs (copied from paint-spread.unit.spec.ts) ──────────────────────

type Mat = [number, number, number, number, number, number]

class FakeMatrix {
  constructor(public a = 1, public b = 0, public c = 0, public d = 1, public e = 0, public f = 0) {}
  static from(m: Mat): FakeMatrix { return new FakeMatrix(...m) }
  get mat(): Mat { return [this.a, this.b, this.c, this.d, this.e, this.f] }
  multiply(o: FakeMatrix): FakeMatrix {
    return new FakeMatrix(
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    )
  }
  translate(x: number, y: number): FakeMatrix { return this.multiply(new FakeMatrix(1, 0, 0, 1, x, y)) }
  scale(x: number, y = x): FakeMatrix { return this.multiply(new FakeMatrix(x, 0, 0, y, 0, 0)) }
  // The MUTATING spellings `resolveImageFill` actually uses for the pattern matrix.
  translateSelf(x: number, y: number): FakeMatrix {
    const m = this.translate(x, y)
    Object.assign(this, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f })
    return this
  }
  scaleSelf(x: number, y = x): FakeMatrix {
    const m = this.scale(x, y)
    Object.assign(this, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f })
    return this
  }
}

interface PatternCall { image: unknown; repetition: string | null | undefined; matrix: Mat | null }

/** A recorder with a real CTM. `createPattern` returns a live object so the
 *  pattern MATRIX is recorded too. */
class RecCtx {
  patterns: PatternCall[] = []
  private m: Mat = [1, 0, 0, 1, 0, 0]

  getTransform(): FakeMatrix { return FakeMatrix.from(this.m) }
  setTransform(...a: unknown[]) {
    if (a.length === 1 && a[0] instanceof FakeMatrix) this.m = (a[0] as FakeMatrix).mat
    else this.m = (a as number[]).slice(0, 6) as Mat
  }
  createPattern(image: unknown, repetition?: string | null) {
    const call: PatternCall = { image, repetition, matrix: null }
    this.patterns.push(call)
    return { setTransform: (m: FakeMatrix) => { call.matrix = m.mat } }
  }
}

let hadDocument: unknown, hadDOMMatrix: unknown
beforeAll(() => {
  hadDocument = (globalThis as any).document
  hadDOMMatrix = (globalThis as any).DOMMatrix
  ;(globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  }
  ;(globalThis as any).DOMMatrix = FakeMatrix
})
afterAll(() => {
  ;(globalThis as any).document = hadDocument
  ;(globalThis as any).DOMMatrix = hadDOMMatrix
})

const FIELD: ShaderFieldFrameCtx = { frameW: 400, frameH: 200, t: 0, fps: 30, base: null, bake: false, token: 0 }
const BOX = { w: 120, h: 60 }
const imgFill = (p: Partial<ImageFill> = {}): ImageFill =>
  ({ type: 'image', src: 'blob:fixture', fit: 'cover', ...p })

describe('resolveImageFill — pattern matrix is centred on the box origin', () => {
  it('fit:cover — one no-repeat tile, translate(-bw/2,-bh/2), unit scale', () => {
    const ctx = new RecCtx()
    resolvePaint(ctx as unknown as CanvasRenderingContext2D, imgFill({ fit: 'cover' }), BOX, FIELD)
    expect(ctx.patterns).toHaveLength(1)
    expect(ctx.patterns[0]!.repetition).toBe('no-repeat')
    expect(ctx.patterns[0]!.matrix).toEqual([1, 0, 0, 1, -60, -30])
  })

  it('fit:contain — same centred matrix, no-repeat', () => {
    const ctx = new RecCtx()
    resolvePaint(ctx as unknown as CanvasRenderingContext2D, imgFill({ fit: 'contain' }), BOX, FIELD)
    expect(ctx.patterns[0]!.repetition).toBe('no-repeat')
    expect(ctx.patterns[0]!.matrix).toEqual([1, 0, 0, 1, -60, -30])
  })

  it('fit:stretch — same centred matrix, no-repeat', () => {
    const ctx = new RecCtx()
    resolvePaint(ctx as unknown as CanvasRenderingContext2D, imgFill({ fit: 'stretch' }), BOX, FIELD)
    expect(ctx.patterns[0]!.repetition).toBe('no-repeat')
    expect(ctx.patterns[0]!.matrix).toEqual([1, 0, 0, 1, -60, -30])
  })

  it('fit:tile, no offset — repeats, same centred matrix as the box forms', () => {
    const ctx = new RecCtx()
    resolvePaint(ctx as unknown as CanvasRenderingContext2D, imgFill({ fit: 'tile' }), BOX, FIELD)
    expect(ctx.patterns[0]!.repetition).toBe('repeat')
    expect(ctx.patterns[0]!.matrix).toEqual([1, 0, 0, 1, -60, -30])
  })

  it('fit:tile with offset {x:0.1,y:-0.2} — translate shifts by offset·box, scale unchanged', () => {
    const ctx = new RecCtx()
    resolvePaint(ctx as unknown as CanvasRenderingContext2D, imgFill({ fit: 'tile', offset: { x: 0.1, y: -0.2 } }), BOX, FIELD)
    expect(ctx.patterns[0]!.repetition).toBe('repeat')
    // translate(-60 + 0.1*120, -30 + -0.2*60) = (-48, -42); scale unchanged.
    expect(ctx.patterns[0]!.matrix).toEqual([1, 0, 0, 1, -48, -42])
  })
})

describe('resolveImageFill — a missing bitmap paints nothing', () => {
  it('an unresolved/failed src falls back to "transparent" with no pattern recorded', async () => {
    vi.resetModules()
    vi.doMock('~/lib/paint/imageFillCache', () => ({
      getFillBitmap: () => null,
      ensureFillBitmaps: () => Promise.resolve(),
    }))
    const { resolvePaint: resolvePaintNoBitmap } = await import('~/lib/paint/resolve')
    const ctx = new RecCtx()
    const style = resolvePaintNoBitmap(ctx as unknown as CanvasRenderingContext2D, imgFill(), BOX, FIELD)
    expect(style).toBe('transparent')
    expect(ctx.patterns).toHaveLength(0)
    vi.doUnmock('~/lib/paint/imageFillCache')
    vi.resetModules()
  })
})
