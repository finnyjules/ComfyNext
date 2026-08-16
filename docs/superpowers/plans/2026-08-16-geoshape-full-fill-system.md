# Shape Studio full Paint fill system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give Shape Studio's Fill + Overlap-fill the full compositor `Paint` system (solid/gradient/patterns/image/shader) via `FillControl`, rendering through the shared `resolvePaint` (canvas) and `paintToVectorPaint` (SVG).

**Architecture:** geoshape config stores compositor `Paint` for `fill`/`overlapFill`. The composite carries the authored `Paint` on each shape (`GeoVectorShape = VectorShape & { paint?: Paint }`); `drawToCanvas` resolves it via `resolvePaint`, `toSvg` converts it via `paintToVectorPaint`. Image/shader fills warm through caches (async repaint) and export as embedded raster.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, existing `lib/compositor/paint`, `lib/paint/resolve`, `lib/paint/toVector`, `FillControl.vue`. Vitest + Browser pane.

## Global Constraints

- **`config.ts` stays dependency-light:** import `Paint` as a **type-only** import (`import type { Paint } from '~/lib/compositor/paint'`) — never a value import (that drags `fillTile`/`imageFillCache` into the Collection dynamic-import graph). Paint validation in `mergeConfig` is a LOCAL loose validator.
- **Defaults unchanged:** `DEFAULT_CONFIG.fill`/`overlapFill` stay `'#111111'` (a solid string is a valid `Paint`), so the default mark is identical.
- **Reuse, don't reinvent:** canvas via `resolvePaint(ctx, paint, box, field, spread?)` from `~/lib/paint/resolve`; SVG via `paintToVectorPaint(paint, opts)` from `~/lib/paint/toVector`; editor via `~/components/vue-canvas/compositor/FillControl.vue`.
- **Render-proof rule:** a gradient in the preview must be proven with a pixel-variance sample, never "it drew".
- Run tests from `frontend/`: `npx vitest run <path>`.

## File structure

- Modify `frontend/app/lib/geoshape/config.ts` — `fill`/`overlapFill: Paint` + validator (Task 1)
- Modify `frontend/app/lib/geoshape/boolean.ts` — carry `paint` on shapes (Task 2)
- Modify `frontend/app/lib/geoshape/render.ts` — `drawToCanvas`→resolvePaint, `toSvg`→paintToVectorPaint (Task 2), async warm+raster (Task 4)
- Modify `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` — FillControl (Task 3)

---

### Task 1: Config stores `Paint`

**Files:** Modify `frontend/app/lib/geoshape/config.ts`; Test `frontend/tests/unit/geoshape-config.unit.spec.ts` (extend).

- [ ] **Step 1: Failing test** — extend the config spec:

```ts
import type { Paint } from '~/lib/compositor/paint'
// ...
it('accepts a gradient Paint for fill and round-trips it', () => {
  const grad: Paint = { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] }
  const cfg = mergeConfig({ ...DEFAULT_CONFIG, fill: grad })
  expect(cfg.fill).toEqual(grad)
})
it('accepts a pattern Fill and an ImageFill for fill', () => {
  const patt: any = { type: 'stripes', a: '#111', b: '#eee', textColor: '#000', angle: 0, density: 8 }
  const img: any = { type: 'image', src: 'data:image/png;base64,AAAA', fit: 'cover' }
  expect(mergeConfig({ ...DEFAULT_CONFIG, fill: patt }).fill).toEqual(patt)
  expect(mergeConfig({ ...DEFAULT_CONFIG, overlapFill: img }).overlapFill).toEqual(img)
})
it('falls back to default for junk paint (bad/absent type)', () => {
  expect(mergeConfig({ ...DEFAULT_CONFIG, fill: { type: 'bogus' } }).fill).toBe(DEFAULT_CONFIG.fill)
  expect(mergeConfig({ ...DEFAULT_CONFIG, fill: 42 }).fill).toBe(DEFAULT_CONFIG.fill)
})
it('a solid string stays a solid string', () => {
  expect(mergeConfig({ ...DEFAULT_CONFIG, fill: '#abcdef' }).fill).toBe('#abcdef')
})
```

- [ ] **Step 2:** Run → fail (`fill` still typed `VectorPaint`; validator rejects gradients/patterns/images or has different shape).

- [ ] **Step 3: Implement** — in `config.ts`:
  - Change the `fill`/`overlapFill` interface fields to `Paint`; add `import type { Paint } from '~/lib/compositor/paint'`. Remove the now-unused `VectorGradient`/`VectorPattern` type imports if only paint used them.
  - Replace the `paint()` validator (and its `isValidVectorGradient`/`isValidVectorPattern` helpers) with a LOCAL loose `Paint` validator:
    ```ts
    const PAINT_TYPES = new Set(['linear', 'radial', 'image', 'solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr', 'shader'])
    function paint(v: unknown, d: Paint): Paint {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && typeof (v as any).type === 'string' && PAINT_TYPES.has((v as any).type)) {
        // structurally plausible Paint — deep-copy so callers can't mutate DEFAULT
        return JSON.parse(JSON.stringify(v)) as Paint
      }
      return d
    }
    ```
    (Confirm the exact `Fill.type` value set against `spacetype/fillTile`'s `FillType` + `Gradient`/`ImageFill` discriminants; the set above mirrors them. Keep it permissive — the FillControl only ever emits valid Paints; this just rejects non-objects and unknown discriminants.)
  - `mergeConfig`: `fill: paint(o.fill, d.fill)`, `overlapFill: paint(o.overlapFill, d.overlapFill)`.

- [ ] **Step 4:** Run → pass (config + existing geoshape tests). **Step 5: Commit** `feat(geoshape): store compositor Paint for fill/overlapFill`.

---

### Task 2: Carry `Paint` on shapes; canvas via resolvePaint; SVG via paintToVectorPaint

**Files:** Modify `boolean.ts`, `render.ts`; Test `geoshape-render.unit.spec.ts` (extend), `geoshape-boolean.unit.spec.ts` (adjust if it asserts `.fill`).

**Interfaces:** `GeoVectorShape = VectorShape & { paint?: Paint }` (declare in `render.ts` or a shared spot; import into boolean.ts).

- [ ] **Step 1: Failing test** — SVG conversion is pure/asserted:

```ts
it('toSvg emits a real <linearGradient> for a gradient fill', async () => {
  const grad: any = { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }
  const svg = await toSvg({ ...DEFAULT_CONFIG, fill: grad })
  expect(svg).toMatch(/<linearGradient/)
  expect(svg).toContain('#ff0000')
})
it('toSvg emits a <pattern> for a procedural pattern fill', async () => {
  const patt: any = { type: 'stripes', a: '#111111', b: '#eeeeee', textColor: '#000', angle: 0, density: 8 }
  const svg = await toSvg({ ...DEFAULT_CONFIG, fill: patt })
  expect(svg).toMatch(/<pattern/)
})
it('a solid fill stays a plain fill attribute (no defs)', async () => {
  const svg = await toSvg({ ...DEFAULT_CONFIG, fill: '#123456' })
  expect(svg).toContain('#123456')
  expect(svg).not.toMatch(/<linearGradient|<pattern/)
})
```

- [ ] **Step 2:** Run → fail (toSvg doesn't convert Paint; gradients would appear as a solid or crash).

- [ ] **Step 3a: `boolean.ts`** — the composite currently sets `fill: cfg.fill` etc. on the VectorShapes. Change so it carries the authored `Paint` and a solid fallback:
  - Type the returned shapes as `GeoVectorShape[]`.
  - Base shape: `paint: cfg.fill`, and `fill: solidOf(cfg.fill)` where `solidOf(p) = typeof p === 'string' ? p : '#808080'` (a fallback so any `.fill` reader still works). Keep `stroke`/`strokeWidth`/`fillRule` as today.
  - Overlap shape: `paint: cfg.overlapFill`, `fill: solidOf(cfg.overlapFill)`.
  - `cfg.fill`/`cfg.overlapFill` are now `Paint` (from Task 1). `cfg.stroke` stays string.

- [ ] **Step 3b: `render.ts` `toSvg`** — after `renderShapes` + `contentBounds`, convert each shape's `paint` → `VectorPaint`:

```ts
import { paintToVectorPaint } from '~/lib/paint/toVector'
// in toSvg, after const b = contentBounds(shapes):
const box = { x: b.minX, y: b.minY, width: b.w, height: b.h }
for (const s of shapes as GeoVectorShape[]) {
  if (s.paint && typeof s.paint !== 'string') {
    const vp = paintToVectorPaint(s.paint, { units: 'userSpaceOnUse', box })
    if (vp) s.fill = vp  // null (e.g. image/shader with no raster) → keep the solid fallback (Task 4 supplies the raster)
  }
}
```
(Confirm `VectorPaintOptions`/`VectorRect` field names in `paint/toVector.ts`; `box` is `{x,y,width,height}`.)

- [ ] **Step 3c: `render.ts` `drawToCanvas`** — replace `canvasFillStyle` with the shared resolver so gradients/patterns paint on canvas:

```ts
import { resolvePaint } from '~/lib/paint/resolve'
// build a still field ctx once (read resolve.ts's ShaderFieldFrameCtx ~line 225 and
// construct a time-0 frame ctx; shader fills use it, others ignore it):
const STILL_FIELD: ShaderFieldFrameCtx = /* … per resolve.ts … */
// in the per-shape loop (already inside the fit transform), with box = {w:b.w, h:b.h}:
const paint = (s as GeoVectorShape).paint ?? s.fill
const style = resolvePaint(ctx, paint as any, { w: b.w, h: b.h }, STILL_FIELD)
ctx.fillStyle = style as any
ctx.fill(path, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
```
Delete `canvasFillStyle`/`FALLBACK_FILL` (or keep FALLBACK_FILL as the STILL default color). Confirm `resolvePaint`'s `box` arg shape (`{w,h}` centered-origin per its doc) and the exact `ShaderFieldFrameCtx` constructor — read `paint/resolve.ts`. Image/shader will return a fallback until warmed (Task 4); gradients/patterns/solid resolve synchronously now.

- [ ] **Step 4:** Run → pass (`geoshape-render`, `geoshape-boolean`; fix any boolean test that asserted `.fill === cfg.fill` — it now asserts `.paint === cfg.fill` and `.fill` is the solid fallback). **Step 5: Commit** `feat(geoshape): paint-carrying shapes — gradient/pattern on canvas + real vector SVG`.

---

### Task 3: FillControl in the surface

**Files:** Modify `frontend/app/components/vue-canvas/ShapeStudioSurface.vue`.

- [ ] **Step 1:** Import `FillControl` (`~/components/vue-canvas/compositor/FillControl.vue`) and `type Paint`. Remove the `paintToHex` reduction + `fillHex`/`overlapFillHex` computeds (fill/overlapFill are full `Paint` now; stroke keeps its hex computed).
- [ ] **Step 2:** In the `#control-fill` slot: `<FillControl allow-image :model-value="config.fill" @update:model-value="setGeoControl('fill', $event)" />`. Same for `#control-overlapFill` with `config.overlapFill` (its `when: overlapMode==='shape'` gate is already on the control). Keep `#control-stroke` as `StudioColorField` (solid). Match FillControl's real prop/event names (`modelValue` / `update:modelValue`, `allowImage`).
- [ ] **Step 3:** Confirm `setGeoControl` writes the whole `Paint` object to `config.fill` (it sets a dotted key to a value — a full object value is fine). Autosave persists `config` (mergeConfig validates on hydrate).
- [ ] **Step 4: Verify (no browser):** `npx vue-tsc --noEmit -p . 2>&1 | grep -iE "ShapeStudioSurface|FillControl"` — no NEW errors. **Step 5: Commit** `feat(shape-studio): FillControl paint picker for fill + overlap-fill`.

---

### Task 4: Image + shader fills — async warm/repaint + raster SVG export

**Files:** Modify `frontend/app/lib/geoshape/render.ts` and `ShapeStudioSurface.vue` (renderPreview warm step).

- [ ] **Step 1: Canvas warm-and-repaint.** In `render.ts`, add an async helper that, given the shapes' paints + box, warms image (`getFillBitmap` from `~/lib/paint/imageFillCache`) and shader (`resolveField` from `~/lib/shaderfill/field`) caches, resolving when ready. In `ShapeStudioSurface.vue`'s `renderPreview`: after the synchronous `drawToCanvas`, if any shape paint `isImageFill`/`isFill`-with-shader, `await warmPaints(...)` then `drawToCanvas` again (guarded by `renderToken`). Read how the Compositor warms these (it already does — mirror its call). This makes image/shader appear once loaded.
- [ ] **Step 2: SVG raster embed.** In `toSvg`, for a shape whose `paintToVectorPaint(...)` returned `null` (image/shader, TIER 3), rasterize the paint over `box` to a `data:` URL (offscreen canvas + the same resolve path) and pass it as `VectorPaintOptions.raster` so `paintToVectorPaint` returns a `<pattern>`-with-`<image>`. Confirm the `raster` opt name/shape in `paint/toVector.ts`.
- [ ] **Step 3: Test** — pure-assertable part: `toSvg` with an `ImageFill` (a tiny data-URL src) yields a `<pattern`/`<image` (raster embedded); a `Fill` with a shader spec, given a stubbed raster, yields a `<pattern`. (Canvas warm is proven live in Task 5.)
- [ ] **Step 4:** Run → pass. **Step 5: Commit** `feat(geoshape): image + shader fills — async canvas warm + raster SVG export`.

---

### Task 5: Live render-proof + final review

- [ ] **Step 1: Live proof (Browser pane, dev server on 127.0.0.1:3000).** In the studio: set Fill to a **gradient** (via FillControl) → preview shows the gradient. Objective check via `javascript_tool`: sample the preview canvas pixels over the mark and assert the fill has **>1 distinct color** (a gradient varies; a flat wash would be one color — guards the "flat-wash passed" trap). Then a **pattern**, an **image** (paste a data-URL), a **shader** → each shows. Download SVG for the gradient and confirm `<linearGradient>`; for the shader confirm an embedded `<image>`. Screenshot each.
- [ ] **Step 2:** If anything's off, fix and re-verify.
- [ ] **Step 3: Full sweep:** `npx vitest run tests/unit/geoshape-*.unit.spec.ts` green; then request the whole-branch review (superpowers:requesting-code-review) over the fill-system commits.

## Self-Review

- Coverage: config Paint (T1) · canvas+SVG for gradient/pattern (T2) · editor (T3) · image+shader async+raster (T4) · proof+review (T5). All spec sections mapped.
- Placeholders: T2/T4 flag two "confirm the real API shape" reads (`ShaderFieldFrameCtx` constructor; `VectorPaintOptions.raster`/`box`) — these are verification instructions against named files, not TODOs.
- Types: `GeoVectorShape` defined in T2 and used in T2/T4; `Paint` type-only in config (T1) and value-imported where guards/resolve are used (render/surface). `resolvePaint`/`paintToVectorPaint` signatures pinned from the source.
