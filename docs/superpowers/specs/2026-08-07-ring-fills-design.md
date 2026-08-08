# Ring fills — words and cards get real fills (gradient/ombre/image/…) — design

*2026-08-07. Extends the Expressive Studio `ring` effect. Follows the tune-up / type controls / card ratio.*

## In plain language

Right now a word is a flat colour and a card is a photo. This gives both **fills** from Space Type's
existing fill engine: **solid · gradient · ombre · grid · noise** (words), plus **image** as one more
fill kind (cards). The unifying idea: *every tile has a fill*. A word is a fill masked by the glyph
shape; a card is a fill shown on a quad; a photo is just the `image` fill.

Decisions (confirmed): **words share one global fill**; **each card has its own fill** (so you can mix
a photo card and a gradient card). Image is one fill option in the card picker.

## Reuse — almost all of this exists

- `app/lib/spacetype/fills.ts` / `fillTile.ts`: the `Fill` type (`{ type, a, b, textColor, angle,
  density, shader? }`), `FillType` (`solid|gradient|ombre|grid|noise|checkerboard|stripes|qr|shader`),
  `parseFills`/`serializeFills`, `fillShaderTexture(three, fill)` → texture, `fillIsTextured`,
  `fillTiling`, `fillPrimary`.
- `cylinder.ts:143-250` is the **exact word-fill pattern** to mirror: `fillMap = fillShaderTexture(...)`,
  glyph atlas on **UV channel 1** (`layout.texture.channel = 1`), material
  `new MeshBasicMaterial({ map: fillMap, alphaMap: layout.texture, transparent, alphaTest: 0.5 })`.
- `ShaderFillEditor.vue` — the per-fill editor widget (type dropdown + colour pickers) — reused inline.

We do NOT touch the shared `fills.ts` engine or its `FillType` union; `image` is handled in the ring's
own content model, not added to the global union (avoids breaking other fill consumers).

## Content model

`ContentItem` (in `tile.ts`) gains card fills; the old `image` item becomes a `card` with an image fill.

```ts
type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'card'; fillKind: 'image' | 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise'
      ; src?: string; aspect?: number   // image fill
      ; fill?: Fill }                    // non-image fill (a/b/angle/density)
```

**Backward compat (`parseContent`):** a legacy `{ kind: 'image', src, aspect }` item is read as
`{ kind: 'card', fillKind: 'image', src, aspect }`. Existing ring docs keep their photos.

**Word fill** is a separate global control, NOT per-item: a `wordFill` param (single `Fill` as JSON),
default solid white — reproduces today's white words. (Replaces the `typeColor` control from the type-
controls feature; `typeColor` is dropped, its role subsumed by `wordFill`'s solid colour.)

`expandContent`: a `word` item still expands to word/letter tiles (carrying no fill — the global
`wordFill` applies); a `card` item expands to one tile carrying its `fillKind`/`src`/`fill`.

## Rendering (ring.ts buildScene)

**Word / letter tiles** — mirror `cylinder`:
- Rasterise the glyph atlas WHITE (alpha shape) via `layoutChars` (as today, but colour is now just the
  mask — use white); set `atlas.channel = 1`.
- Geometry: UV **channel 0** = full `0..1` (the fill maps across the tile); UV **channel 1** = the glyph
  sub-rect (the existing letter remap moves to channel 1; word tiles use full 0..1 on both).
- Parse the global `wordFill`. If `fillIsTextured(fill)`: `map = fillShaderTexture(three, fill)` (tiled
  by `fillTiling`), `color = white`. Else (solid): `map = null`, `color = fillPrimary(fill)`.
  Material: `MeshBasicMaterial({ map, color, alphaMap: atlas, transparent: true, alphaTest: 0.5 })`.
- Glyph-texture disposal registration (userData.tex) still applies to the atlas; the fill texture is a
  second texture to register for disposal (or reuse the shared fill cache — mirror cylinder's handling).

**Card tiles**:
- `fillKind === 'image'`: `map = env.imageTextures.get(src)` (as today); corner-radius + card-ratio
  cover-crop as they already do.
- else (`solid`/`gradient`/…): `map = fillShaderTexture(three, item.fill)` for textured kinds, or
  `color = fillPrimary(item.fill)` for solid; opaque (no alphaMap). `aspect` = card ratio if set, else
  1 (a fill card is square by default). Corner radius still rounds it; card-ratio cover-crop is a no-op
  for fills (they fill any ratio natively) — the corner SDF uAspect uses the card ratio as usual.

**Interactions:** bend, padding, back-fade, ring-opening, repeater are content-agnostic and unchanged.
Corner radius currently gates on image tiles only — extend it to all **card** tiles (fills round too);
still never on word tiles.

## Content editor UI (SpaceTypeSurface.vue)

The content list (built in v1) gains fill controls, reusing `ShaderFillEditor.vue`:
- **Card row:** a **fill-kind dropdown** (`Image · Solid · Gradient · Ombre · Grid · Noise`). `Image` →
  the existing upload/thumbnail; any other kind → a `ShaderFillEditor` bound to the item's `fill`.
- **Word fill:** one `ShaderFillEditor` for the global `wordFill`, shown once in the Type/Color area
  (labelled "Word fill"), writing the `wordFill` JSON param.
- "+ Add image" becomes **"+ Add card"** (defaults to a gradient or solid card; then pick Image to
  upload). Reorder/remove unchanged; stable ids unchanged.

All fill edits are **structural** (re-rasterise the fill/glyph textures) → rebuild, not `liveKeys`.

## Testing

- **Unit (pure, `tile.ts`):** `parseContent` migrates legacy `image` → `card`/`image` fill; a `card`
  item with `fillKind:'gradient'` round-trips its `fill`; `expandContent` yields one tile per card and
  the word/letter tiles for words (unchanged count). `wordFill` parse: bad JSON → default solid.
- **Unit (`ring.ts`):** an image card still builds (regression); a gradient card builds without error
  (fillShaderTexture path) — image-only-content tests stay valid; add a gradient-card build/no-throw +
  count assertion. (Glyph/fill textures need canvas → the word-fill render path is manual, like the
  type-controls task.)
- **Manual/live:** words show a gradient/ombre fill (masked to the letter shape); a card set to Gradient
  shows the gradient; Image cards unchanged; corner radius rounds fill cards; mixing a photo card and a
  gradient card works. Deferred to the user pass.

## Risks

- **UV channel 1 for the glyph mask** — the letter sub-rect remap moves from channel 0 to channel 1, and
  channel 0 becomes the fill's full-quad UV. Mirror `cylinder` exactly (it's proven). Bend touches
  position not UV, so it's unaffected; corner radius/card-ratio are card-only, so no glyph-UV conflict.
- **Content-model migration** — the `image → card` reinterpretation must be lossless for saved docs
  (asserted in the parseContent unit test). `wordFill` default solid-white keeps existing words identical.
- **Two textures per word tile** (glyph atlas + fill) — both must be registered for disposal (the ring
  already tracks glyph atlas on `userData.tex`; add the fill texture, or reuse the shared fill cache as
  `cylinder` does). Watch for leaks — the final review checks this.
- **Shared fills.ts untouched** — `image` lives in the ring's content model only, so no other fill
  consumer is affected ([[shared-catalog-two-consumers]]).

## Done when

Words take a global fill (solid/gradient/ombre/grid/noise) masked to the glyph shape; each card takes
its own fill with **Image** as one kind; existing ring docs (photos + white words) render unchanged; the
content editor picks fills per card + one word fill; corner radius rounds fill cards; and all of it is a
declared/serialized model so it round-trips through save + the headless bake.
