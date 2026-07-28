# Vector Type — fills

**Date:** 2026-07-27
**Status:** Plan, ready to execute
**Follows:** the Vector Type Studio (`003ac333a`..`7423d4fad`) and its motion preset gallery (`173249a1c`..`7a5f251cc`)

## The ask

Vector Type stores a flat `#rrggbb`. Give it the product's real fill vocabulary.

## Decision taken (2026-07-27)

**All nine `FILL_TYPES`, including shader fills** — full parity with Shape Studio and Space Type,
including the 63-effect catalog on type.

**The consequence, accepted deliberately:** three of the nine cannot be exported as vector. So the
export must degrade **loudly**. That is not polish in this plan — it is the thing that keeps the
studio's "real editable vector" claim honest, and it is Task 7.

## What exists (do not rebuild any of it)

| piece | file | note |
|---|---|---|
| `Fill`, `FILL_TYPES`, `ShaderSpec`, normalisers | `lib/spacetype/fillTile.ts` (335) | CPU-only, no `three`, no DOM at module scope |
| `Paint`, `Gradient`, `isGradient`/`isFill`, `paintTileBox` | `lib/compositor/paint.ts` (81) | `Paint` is the real union; multi-stop + radial live **here**, not on `Fill` |
| the field renderer | `lib/shaderfill/field.ts` | *"the ONLY place in the product that turns a ShaderFill into pixels"* |
| fill picker UI | `compositor/FillControl.vue` (218) | emits a `Paint`; `nested` prop already precedents filtering the canonical list |
| shader authoring UI | `widgets/ShaderFillEditor.vue` (302) | reused verbatim by all three existing hosts |
| the anchor convention | `lib/spacetype/fills.ts:44-105` | `uFillAnchor` 0=object 1=frame, across ~28 effect shaders |

`Fill` is **not** a discriminated union — one flat interface, `a`/`b` (two colours max), `angle`,
`density`. `Paint = string | Gradient | Fill` is the union. Multi-stop and radial are `Paint`-only.

## The six traps — pin these before writing code

1. **`resolvePaint`/`resolveFill`/`resolveShaderFill` are trapped in a Vue composable.**
   `useCompositorLayers.ts:550-700`, all module-private, all depending on module-level `_fieldCtx`
   frame state that only `paintLayerStack` sets up. Extraction is a **real task with real risk**
   (Task 1), not a move.
2. **Two origin conventions already coexist.** `paintTileBox` uses **corner** origin; `resolvePaint`
   uses **centred**. Documented at `paint.ts:44-48`. Pick one per call site knowingly.
3. **`lib/vector/svg.ts` is documented pure — no DOM, no canvas, no fetch.** A raster embed needs a
   data URL, so it must be **passed in pre-encoded** from `vectortype/canvas.ts`. Generating it inside
   the spine breaks the property that makes the spine reusable.
4. **`resolveField` returns a cache-owned canvas that consumers MUST NOT copy** — copying was measured
   at ~4× regression. But Task 6 must copy it (`toDataURL`) for the embed. That is legitimate
   **only** on the export path, never per frame. Make the distinction explicit in code.
5. **Saved configs hold `fill: '#ffffff'` — a string.** Every existing Vector Type node. `mergeConfig`
   must lift a string to a solid `Fill`, and **`ensureConfigDefaults` is NOT on the universal load
   path** (this exact assumption nearly shipped broken in the Gradient work — the node card, the bake
   and the frame source all read the raw blob). Verify every read path, don't assume.
6. **`Defs` is typed `kind: 'b' | 'c'`** (`vector/svg.ts:295`). A third and fourth kind touches
   `signature()`, `empty`, `idFor` and `render()`. Check whether `vector-svg-defs.unit.spec.ts` pins
   the id-numbering scheme before widening it.

Also: `shapefx/config.ts:113` keeps a **hand-maintained duplicate** of the nine type strings for its
`oneOf` validator. Real drift risk; dedupe it when convenient (Task 2 touches the neighbourhood).

## Two design decisions this plan makes

**Store a real `Fill`, not a parallel struct.** Shape Studio's `SurfaceFill` is a near-copy that drops
`textColor`, and the mapping function that re-adds it silently dropped a field and shipped broken once
(see the doc comment at `shapefx/config.ts:60-70`). Vector Type stores `Paint` directly.

**Three anchors, not two.** Space Type has `object | frame`. Type needs a middle term — a gradient
across a **word** is the single most-wanted treatment and neither existing anchor expresses it:

- `glyph` — each letter carries its own fill (canvas: `fillStyle` inside the per-glyph transform, which
  is where it is today; SVG: `gradientUnits="objectBoundingBox"`)
- `word` — one fill spans the whole run, letters are windows onto it (canvas: hoist `fillStyle` above
  the loop with a run-level box; SVG: `userSpaceOnUse` referenced from an **untransformed wrapper `<g>`**,
  the same trick already used for clip and blur)
- `frame` — one fill spans the canvas, type moves over it (the existing frame anchor; canvas recipe is
  the matrix inversion at `useCompositorLayers.ts:657-700`)

---

## Tasks

### Task 1: Extract the 2D paint resolver into `lib/`

Widest blast radius, least interesting, so it goes first — the Compositor is the incumbent consumer and
must not move.

**Files:** create `lib/paint/resolve.ts`; modify `useCompositorLayers.ts`.

- [ ] **Step 1:** Move `hasPaint`, `resolvePaint`, `resolveFill`, `resolveShaderFill` verbatim. The
      `_fieldCtx` frame state moves with them or becomes an explicit parameter — decide and justify.
- [ ] **Step 2:** Keep the centred-origin convention exactly as-is. **No behaviour change, no
      "improvements".** Trap 2 is live here.
- [ ] **Step 3:** Repoint all 13 call sites in `useCompositorLayers.ts`.
- [ ] **Step 4:** Verify in a browser that Compositor layers still paint — gradients, patterns **and**
      a shader fill. Pixel evidence, not "it rendered".
- [ ] **Step 5:** Commit — `refactor(paint): extract the 2D paint resolver into lib`

---

### Task 2: `Paint` in the Vector Type config

**Files:** `lib/vectortype/config.ts`, `controls.ts`, tests.

- [ ] **Step 1:** `fill: Paint`. **`mergeConfig` must accept a legacy string** and lift it to
      `{type:'solid', a:<string>, …}`. Trap 5 — trace every read path (node card, bake, frame source,
      thumbnail, SVG) and confirm each one goes through the lift. A saved node that renders black is
      the failure mode.
- [ ] **Step 2:** Decide whether `stroke` also becomes a `Paint`. Say which and why; a gradient stroke
      is cheap on canvas and free in SVG, but it doubles the control surface.
- [ ] **Step 3:** Controls via `when` predicates, exactly as `shapefx/controls.ts:33-35,82-86` does
      (`fillNeedsB`, `fillHasAngle`, `fillHasDensity`). Add the `fill.anchor` select (glyph/word/frame),
      declared `animatable: false` — it is a mode, and animating it would jump sampling spaces.
- [ ] **Step 4:** Tests: every control key resolves via `makeConfigParams`; hostile blobs (`null`, a
      bare string, an unknown type, a nested shader) survive; the characterization snapshot moves only
      by the additions.
- [ ] **Step 5:** Commit — `feat(vectortype): Paint-typed fill`

---

### Task 3: Canvas rendering, with the three anchors

**Files:** `lib/vectortype/canvas.ts`.

- [ ] **Step 1:** Replace `ctx.fillStyle = fill` (`canvas.ts:409`) with the extracted resolver.
- [ ] **Step 2:** Implement all three anchors. `glyph` is the current in-loop position; `word` hoists
      above the loop with a run-level box; `frame` uses the inverse-CTM recipe. **Scale by the
      *returned* field canvas's `.width`/`.height`, never the requested size** — `resolveField` clamps
      live requests to 512, and this exact bug has shipped here before.
- [ ] **Step 3:** Verify each anchor is visibly different — a gradient that spans the word vs repeats
      per letter vs stays put while type moves. Measure, don't eyeball.
- [ ] **Step 4:** Commit — `feat(vectortype): paint fills with glyph/word/frame anchors`

---

### Task 4: SVG tier 1 — gradient paint servers

**Files:** `lib/vector/svg.ts`, `lib/vectortype/render.ts`.

- [ ] **Step 1:** Widen `VectorShape.fill` beyond `string | null`. Add a `gradients` registry to `Defs`
      alongside `blurs`/`clips` (trap 6). The two-pass structure and content-hashed id prefix already
      generalise — follow them rather than inventing a parallel scheme.
- [ ] **Step 2:** `<linearGradient>` (angle → `x1/y1/x2/y2`, the same trig as `fillTileBox:306`) and
      `<radialGradient>`. Dedupe by value; two exports pasted into one document must not collide.
- [ ] **Step 3:** `gradientUnits` follows the anchor: `objectBoundingBox` for glyph, `userSpaceOnUse`
      from an untransformed wrapper `<g>` for word/frame.
- [ ] **Step 4:** Rasterise the export and diff against canvas, **with a deliberately broken control**
      (wrong `gradientUnits`, or the gradient ref stripped) to show the check can detect what it rules
      out. Report both percentages.
- [ ] **Step 5:** Commit — `feat(vector): gradient paint servers in the SVG spine`

---

### Task 5: SVG tier 2 — procedural `<pattern>` emitters

**Files:** `lib/vector/svg.ts` or a new `lib/vector/patterns.ts`.

grid, stripes, checkerboard, qr — as real `<pattern>` geometry.

- [ ] **Step 1:** One emitter per kind. **These must mirror the canvas pickers in `fillTileBox`, and
      that sync burden is permanent.** The codebase has been bitten by mirror-the-renderer drift before
      (`texturefx/fills.ts:22`). Put the shared cell maths in one place if you can.
- [ ] **Step 2:** Angled `stripes` is the risk: the canvas uses a **per-pixel dot product**, not a
      rotated tile, so `<pattern>` may need a `patternTransform` and may still not tile identically.
      Measure it; if it cannot match, say so and treat stripes as tier 3 rather than shipping a lie.
- [ ] **Step 3:** Per-kind canvas-vs-SVG diff, each with a broken control.
- [ ] **Step 4:** Commit — `feat(vector): procedural pattern emitters`

---

### Task 6: SVG tier 3 — honest raster embed

**Files:** `lib/vectortype/canvas.ts`, `lib/vector/svg.ts`.

ombre, noise, shader. These **cannot** be vector; the goal is that they are correct and *declared*.

- [ ] **Step 1:** `<pattern><image href="data:image/png;base64,…">`. The data URL is encoded in
      `vectortype/canvas.ts` and **passed into** the spine — trap 3, `svg.ts` stays pure.
- [ ] **Step 2:** Copying `resolveField`'s canvas is allowed **here and only here** (trap 4). Gate it
      to the export path explicitly in code, with a comment saying why, so nobody reuses it per-frame.
- [ ] **Step 3:** Emit the raster at export resolution, not the 512 live clamp — pass `bake: true`.
- [ ] **Step 4:** Commit — `feat(vector): raster paint embed for non-vectorisable fills`

---

### Task 7: The export-tier warning — **the task that keeps the claim honest**

**Files:** `VectorTypeSurface.vue`, plus a small shared `exportTier(paint)` helper.

The Compositor's writer silently collapses every rich fill to a flat colour via `paintPrimaryColor`.
**Do not inherit that.** The user chose all nine knowing three cannot be vector; the deal is that the
product says so.

- [ ] **Step 1:** `exportTier(paint) → 'vector' | 'pattern' | 'raster'`, derived from the paint, not a
      hand-maintained list.
- [ ] **Step 2:** Surface it where the choice is made (the fill picker) **and** where the consequence
      lands (next to Export SVG). A user picking a shader fill should learn it before exporting, not after.
- [ ] **Step 3:** Word it plainly — what they get, not a scolding. *"Shader fills export as an embedded
      image, not editable vector."*
- [ ] **Step 4:** Commit — `feat(vectortype): declare each fill's export tier`

---

### Task 8: Shader fill wiring

**Files:** `VectorTypeSurface.vue`, `lib/vectortype/canvas.ts`.

Follow Shape Studio's ~130-150 lines exactly (`ad15d541c`, `b62725a5e`).

- [ ] **Step 1:** `<ShaderFillEditor>` slot, seed-on-type-switch, per-frame `refreshShaderFields`,
      bake unclamp, catalog preload.
- [ ] **Step 2:** **The frozen-field hint is mandatory, not optional.** At most
      `LIVE_FIELD_CEILING = 4` live fields render per host per frame; the rest freeze at `t=0` and the
      host **must surface that** — silent truncation reads as "my shader stopped working".
- [ ] **Step 3:** `resolveField` returns `null` while the catalog loads or on context loss — **fall
      back to `spec.input`**, never to nothing.
- [ ] **Step 4:** Commit — `feat(vectortype): shader fills`

---

### Task 9: Agent vocabulary

**Files:** `lib/vectortype/agentControls.ts`.

- [ ] **Step 1:** The shader branch, mirroring `shapeAgentControls`: push `SHADER_FILL_CONTROLS` plus
      `derivedShaderFillControls(effectDef, 'fill.shader')` when the type is `shader`. **This is not
      free** — Shape needed an explicit branch, so assume Vector Type does too.
- [ ] **Step 2:** Derived keys must be the **real dotted path** (`.params.<id>`). An earlier `.p.<id>`
      namespace created a phantom object that silently never reached the renderer.
- [ ] **Step 3:** Test that every key the guidance prose names exists.
- [ ] **Step 4:** Commit — `feat(vectortype): fill controls in the agent vocabulary`

---

### Task 10: Live verification

- [ ] All nine fill types applied and observed on real type.
- [ ] All three anchors visibly distinct.
- [ ] SVG export per tier: gradients open as editable paint servers; patterns tile correctly; shader
      exports as a declared raster.
- [ ] The export-tier warning appears for exactly the three raster kinds.
- [ ] PNG bake carries every fill type.
- [ ] A fill composed with motion + stagger — the fill must not jitter per frame.
- [ ] Collection sweep over a fill parameter produces **distinct** frames.
- [ ] The Compositor still paints (Task 1 moved its resolver).

**"I looked and it rendered" is not evidence.** Diff pixels, or compare against a broken control.

---

## Out of scope

Image fills (no image arm exists in this `Fill` model — Texture Studio has a separate one, deliberately
not merged here) · per-glyph *different* fills from a list (`fillAtlasTexture` does this on GPU; the
2D path has no equivalent) · animating `fill.anchor` · vectorising a shader (no tracer exists in the
frontend; the only path is a remote lossy API, which is the thing the design doc contrasts itself against).

## The number to watch

Six of nine fill types export as genuine vector; three do not. **If a user can reach the three without
being told, this plan has failed** — the studio's whole claim is that its output is real. Task 7 is not
garnish.
