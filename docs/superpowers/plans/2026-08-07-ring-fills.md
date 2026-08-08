# Ring fills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the ring's words a global fill (solid/gradient/ombre/grid/noise) and each card its own fill, with **image** as one card fill kind — reusing Space Type's fill engine.

**Architecture:** `tile.ts` gains a `card` content item carrying a fill (migrated from the old `image` item). `ring.ts` renders word tiles as a glyph `alphaMap` (UV channel 1) over a fill `map` (the `cylinder.ts:143-250` pattern) and card tiles as a fill texture (or the photo for image fills). `SpaceTypeSurface.vue`'s content editor gains a per-card fill picker + a global word-fill editor, reusing `ShaderFillEditor.vue`. The shared `fills.ts` engine and its `FillType` union are NOT modified — `image` lives only in the ring's content model.

**Tech Stack:** Nuxt/Vue/TS, three.js, Vitest. Spec: [2026-08-07-ring-fills-design.md](../specs/2026-08-07-ring-fills-design.md).

## Global Constraints

- Files touched: `tile.ts`, `ring.ts`, `SpaceTypeSurface.vue` (+ their tests). Do NOT modify `fills.ts`/`fillTile.ts`.
- `tile.ts` stays PURE (type-only import of `Fill`; treat `fill` as opaque data — no `fillShaderTexture` there).
- Backward compat: legacy `{kind:'image',src,aspect}` content items and legacy `typeColor` must migrate losslessly (asserted in unit tests). Existing ring docs (photos + white words) render unchanged.
- `buildScene` stays synchronous. Per-scene state on `root.userData`. Register every texture (glyph atlas AND fill texture) for disposal to avoid leaks.
- Fill edits are STRUCTURAL — not in `liveKeys`.
- Shared-tree: stage only each task's files; verify clean before commit; never `git add -A`/stash/reset.
- Test cmd: `cd frontend && npx vitest run tests/unit/<file>`.

---

## Task 1: Content model — card fills + migration (`tile.ts`, pure)

**Files:** Modify `frontend/app/lib/spacetype/tile.ts`; Test `frontend/tests/unit/spacetype-expand-content.unit.spec.ts` (extend).

**Interfaces produced:**
```ts
import type { Fill } from '~/lib/spacetype/fills'   // type-only, stays pure
type CardFillKind = 'image' | 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise'
type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'card'; fillKind: CardFillKind; src?: string; aspect?: number; fill?: Fill }
type ExpandedTile =
  | { kind: 'card'; sourceId: string; fillKind: CardFillKind; src?: string; aspect: number; fill?: Fill }
  | { kind: 'word'; sourceId: string; text: string }
  | { kind: 'letter'; sourceId: string; text: string; letterIndex: number }
```

**Behaviour:**
- `parseContent`: accept `kind:'word'` and `kind:'card'`; **migrate** a legacy `kind:'image'` object to `{kind:'card', fillKind:'image', src, aspect}`. Reject items without a valid kind. A `card` with no `fillKind` defaults to `'image'` if it has `src`, else `'solid'`.
- `expandContent`: a `card` item → one `card` tile (`aspect` = `item.aspect ?? 1`, carrying `fillKind`/`src`/`fill`); `word` items unchanged (word/letter tiles).

- [ ] **Step 1: Write failing tests** — extend `spacetype-expand-content.unit.spec.ts`:

```ts
it('migrates a legacy image item to a card/image fill', () => {
  const items = parseContent(JSON.stringify([{ id: 'i', kind: 'image', src: 'data:x', aspect: 1.5 }]))
  expect(items).toEqual([{ id: 'i', kind: 'card', fillKind: 'image', src: 'data:x', aspect: 1.5 }])
})
it('expands a gradient card to one card tile carrying its fill', () => {
  const fill = { type: 'gradient', a: '#fff', b: '#000', angle: 45 } as any
  const out = expandContent([{ id: 'c', kind: 'card', fillKind: 'gradient', fill }])
  expect(out).toEqual([{ kind: 'card', sourceId: 'c', fillKind: 'gradient', aspect: 1, src: undefined, fill }])
})
it('legacy image expands to a card tile (kind card, fillKind image)', () => {
  const out = expandContent(parseContent(JSON.stringify([{ id: 'i', kind: 'image', src: 'data:x', aspect: 2 }])))
  expect(out[0]).toMatchObject({ kind: 'card', fillKind: 'image', src: 'data:x', aspect: 2 })
})
```
(Keep the existing word/letter tests passing — words are unchanged.)

- [ ] **Step 2: Run — expect FAIL.** `cd frontend && npx vitest run tests/unit/spacetype-expand-content.unit.spec.ts`
- [ ] **Step 3: Implement** the new types + `parseContent` migration + `expandContent` card branch. Type-only `Fill` import.
- [ ] **Step 4: Run — expect PASS** (new + existing).
- [ ] **Step 5: Commit** `git add frontend/app/lib/spacetype/tile.ts frontend/tests/unit/spacetype-expand-content.unit.spec.ts` → `feat(expressive): ring content model — card fills + legacy image migration`

---

## Task 2: Word fill rendering (`ring.ts`)

**Files:** Modify `frontend/app/lib/spacetype/effects/ring.ts`; Test `spacetype-ring-effect.unit.spec.ts`.

**Consumes:** Task 1 tiles; `fillShaderTexture, fillIsTextured, fillTiling, fillPrimary, parseFills` and `type Fill` from `../fills`; `cylinder.ts:143-250` as the pattern.

**Do:**
1. Add a `wordFill` control storing a single `Fill` as a JSON string. Default `'{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#ffffff","angle":45,"density":8}'`. Group `'Color'`, structural. **Remove the `typeColor` control** (superseded).
   - Migration: in buildScene, resolve the word fill = `params.wordFill` present → `parseFills(...)[0]` (or a single-fill parse); else if legacy `params.typeColor` present → `{type:'solid', a: String(params.typeColor), ...DEFAULT}`; else the default solid white. So old docs with a set `typeColor` keep their colour.
2. Word/letter tiles (the `word`/`letter` branch): render the glyph atlas WHITE (mask) as today; set `layout.texture.channel = 1`. Build geometry so UV **channel 0** = full `0..1` and UV **channel 1** = the glyph sub-rect (move the existing letter sub-rect remap to channel 1 — set `geo.setAttribute('uv1', ...)` or write channel-1 UVs; word tiles use full 0..1 on channel 1). Material (mirror `cylinder.ts:244`):
   ```ts
   const wf = <resolved word Fill>
   const textured = fillIsTextured(wf)
   const map = textured ? fillShaderTexture(three, wf) : null   // tile by fillTiling(wf) like cylinder
   const material = new three.MeshBasicMaterial({ map, color: textured ? new three.Color('#ffffff') : fillPrimary(three, wf), alphaMap: layout.texture, transparent: true, alphaTest: 0.5, side: three.DoubleSide })
   ```
   Register BOTH textures for disposal (glyph atlas + fill texture) — mirror the existing `userData.tex` registration; the fill texture is shared across word tiles (compute once), register once.
3. Keep the letter UV sub-rect logic but on **channel 1** (the alphaMap channel). Bend (position) and corner-radius (cards only) are unaffected.

- [ ] **Step 1: Extend test** — a word doc still builds (headless canvas caveat: keep it image/card-only where canvas is needed; add a wordFill-default parse assertion if pure-testable). At minimum assert the ring still builds an image card doc (regression) and `wordFill` is in the controls with the right default. If word-tile build throws headlessly (no DOM), keep the render assertion manual and unit-test only the control declaration + default.
- [ ] **Step 2: Run — expect FAIL** (control/default absent).
- [ ] **Step 3: Implement** per above; drop `typeColor`; update any test referencing `typeColor`.
- [ ] **Step 4: Run tests + `npx vue-tsc --noEmit 2>&1 | grep -i ring.ts` (no new errors).**
- [ ] **Step 5: Manual (deferred to user):** words show a gradient/ombre masked to the glyph shape.
- [ ] **Step 6: Commit** ring.ts + test → `feat(expressive): ring — global word fill (glyph-masked gradient/ombre/…)`

---

## Task 3: Card fill rendering (`ring.ts`)

**Files:** Modify `frontend/app/lib/spacetype/effects/ring.ts`; Test `spacetype-ring-effect.unit.spec.ts`.

**Consumes:** Task 1 card tiles (`fillKind`/`src`/`fill`); `fillShaderTexture`/`fillIsTextured`/`fillPrimary`.

**Do:** in the card tile branch (was the `image` branch):
- `fillKind === 'image'`: unchanged — `map = env.imageTextures.get(src)`, corner-radius + card-ratio cover-crop as they already are; `aspect = tile.aspect` (or card ratio).
- else: build a `Fill` from `tile.fill`; textured (`fillIsTextured`) → `map = fillShaderTexture(three, fill)`; solid → `color = fillPrimary`, no map. Opaque (no alphaMap). `aspect = cardRatio !== 'native' ? RATIOS[cardRatio] : 1` (a fill card is square by default). Register the fill texture for disposal.
- Corner radius: extend the existing image-only `onBeforeCompile` gate to run on ALL card tiles (fills round too); still never on word tiles. The cover-crop `uUvScale` is `[1,1]` for non-image fills (no crop needed); keep the corner SDF as-is.

- [ ] **Step 1: Extend test** — a gradient card `{kind:'card',fillKind:'gradient',fill:{type:'gradient',...}}` builds without throwing and yields 1 quad; an image card still builds (regression); mixed (image + gradient) builds with the right quad count. (fillShaderTexture uses canvas — if it throws headlessly like layoutChars, assert build path via a solid card instead, which uses `fillPrimary` (no canvas); note which path the test env supports.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the card fill branch + corner-radius gate widening.
- [ ] **Step 4: Run tests + compile-check.**
- [ ] **Step 5: Manual (deferred):** a gradient/solid/ombre card renders; image cards unchanged; corner radius rounds a fill card.
- [ ] **Step 6: Commit** → `feat(expressive): ring — card fills (gradient/solid/ombre/… + image)`

---

## Task 4: Content editor UI — per-card fill picker + word fill (`SpaceTypeSurface.vue`)

**Files:** Modify `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`.

**Consumes:** `ShaderFillEditor.vue`, `parseFills`/`serializeFills`, `type Fill`; the content list editor built in v1; Tasks 1–3's model.

**Do:**
- **Card row:** replace the image-only row with a fill-kind dropdown (`Image · Solid · Gradient · Ombre · Grid · Noise`) bound to `item.fillKind`. `Image` → the existing upload/thumbnail (writes `item.src`/`aspect`); any other kind → a `<ShaderFillEditor>` bound to `item.fill` (default a sensible `Fill` when switching to a non-image kind). Persist through the same content-JSON write path (serialize `fill` inside the item).
- **"+ Add image" → "+ Add card"** — adds a card defaulting to `fillKind:'solid'` (or gradient); the user picks Image to upload.
- **Word fill:** one `<ShaderFillEditor>` labelled "Word fill" in the Type/Color area, bound to a local `Fill` synced to the `wordFill` JSON param (mirror how the existing `fills` array syncs to a `fillList` param, but for a single fill).
- Reuse the existing stable-id, reorder, and content-JSON serialization; don't invent a new write path.

- [ ] **Step 1: Implement** the card fill-kind dropdown + `ShaderFillEditor` per non-image card + the word-fill editor + "+ Add card". Follow the existing content-editor + `fills`-array patterns.
- [ ] **Step 2: Compile-check** `npx vue-tsc --noEmit 2>&1 | grep -i SpaceTypeSurface` — no new errors (the pre-existing `onVibeRevert` at ~line 149 is not yours).
- [ ] **Step 3: Manual (deferred to user):** add a gradient card, an image card, and set the word fill to an ombre; all persist through save/reload.
- [ ] **Step 4: Commit** → `feat(expressive): ring content editor — per-card fill picker + word fill`

---

## Self-review against the spec

- Word global fill (solid/gradient/ombre/grid/noise), glyph-masked → Task 2 (cylinder alphaMap pattern). ✅
- Per-card fill, image as one kind → Task 1 (model) + Task 3 (render) + Task 4 (UI). ✅
- Legacy `image` item + `typeColor` migrate losslessly → Task 1 (parseContent) + Task 2 (wordFill seeds from typeColor). ✅
- Corner radius rounds fill cards → Task 3 (gate widened to all card tiles). ✅
- Shared `fills.ts` untouched; `image` only in ring model → Global Constraints. ✅
- Structural (rebuild), disposal of both textures → Tasks 2/3. ✅

**Open risks:** the UV-channel-1 glyph mask (Task 2) and the two-texture disposal are the fiddly parts — mirror `cylinder.ts` exactly and let the final whole-branch review check for leaks + the glyph-mask alignment.
