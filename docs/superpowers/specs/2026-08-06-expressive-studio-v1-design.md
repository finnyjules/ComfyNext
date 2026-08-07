# Expressive Studio v1 — the tile seam — design

*2026-08-06. Evolves Space Type. Companion to [per-surface-roadmap](2026-08-04-per-surface-roadmap-design.md).*

## In plain language

Space Type arranges **letters** in looping 3D treatments — ribbons, tunnels, spirals, rings.
[animos.app](https://animos.app) arranges **image cards** in looping 3D treatments — rings, sphere
walls, tunnels, spirals. They are the same tool pointed at different content. Space Type's
`cylinder` effect *is* animos's signature ring — upright quads on a circle facing outward — it just
happens to put a glyph on each quad instead of a photo.

So we merge the two by widening what rides the arrangement: from "a glyph" to "a **tile**", where a
tile is a photo, a gradient, or a letter. The arrangement (the ring, the tunnel, the camera, the
loop, the export) stops caring what's inside a tile. Type becomes one *content kind* the studio
arranges, not its subject — which is why the studio's destiny is a rename to **Expressive Studio**.
This spec does **not** rename anything yet. It proves the shape with the smallest possible slice.

## The shape being proved (the whole concept, for context)

Locked during brainstorming, recorded here so the v1 slice is legible against the destination:

- **The unit is a tile.** A photo is one tile (always whole). A word is one tile — *or* one tile
  per letter, chosen by a per-word **resolution** dial (`whole` / `letters`).
- **Content drives the count.** Layouts have no fixed slots; a ring fits however many tiles you
  give it and re-spaces itself. Add a tile, the ring opens a spot.
- **Content comes from uploads and from canvas wires.** Wiring makes a layout *live* — re-roll an
  upstream node and the ring re-fills. (Wire is **expansion**, not v1; see the ladder.)
- **Fast delight first, deep tracks underneath.** Pick a layout and it already loops beautifully.
  The law when a preset and a hand-edit fight over one value is **touch-to-detach**: the preset
  owns a value until you touch it, then that one property is yours and the preset stops writing it.
  (The preset layer + touch-to-detach is **expansion**; v1's ring simply loops.)
- **Layout tools work on any tile; letter-only tools (melt, tear, glyph-warp) grey out for photos.**
- **A layout is a tiny declared function:** `(tile i of N, time t, params) → transform`. Declared
  once as a `ControlSpec` list, it inherits controls, agent-legibility, and animation for free —
  the existing factory pattern. Adding layout #11 stays cheap forever.

## Why a new `ring`, not a generalized `cylinder`

`app/lib/spacetype/effects/cylinder.ts` already places upright quads on a ring facing outward — the
exact geometry we want. But it is ~300 lines dense with per-glyph wave math (`layoutChars` →
snake/longitude/tweak displacement), and it is the render path for existing saved documents.
Refactoring it to consume tiles risks silently changing how those documents render.

v1 instead adds a **new, tile-native `ring` layout** that borrows cylinder's ring placement but is
written against the `Tile` interface from the first line. This:

- keeps every existing effect (all 25) **untouched**, so the "old docs render unchanged" guarantee
  holds by construction rather than by careful diffing;
- creates the **first clean instance** of the layout-over-tiles pattern that every future layout
  (and the eventual generalization of the glyph arrangements) copies.

Generalizing `cylinder`/`tunnel`/`spiral` to accept tiles moves to the expansion ladder.

## What is being built (v1)

Four additive pieces. Nothing existing is modified except the surface gaining a content editor and
the effect registry gaining one entry.

### 1. The `Tile` interface + the `content → tiles` stage

`app/lib/spacetype/tile.ts` (new). A tile is a UV sub-rect on a texture with an aspect — a
generalization of `CharGlyph` in `charLayout.ts`:

```ts
interface Tile {
  texture: THREE.Texture      // atlas (glyphs) or image
  u0: number; u1: number; v0: number; v1: number   // sub-rect; a full image is 0,1,0,1
  aspect: number              // width / height, sizes the quad
  kind: 'glyph' | 'image'     // greys letter-only tools later; may drive per-kind sizing
  sourceId: string            // stable id of the content item this tile came from
}
```

The stage `contentToTiles(content: ContentItem[], fontOpts) → Promise<Tile[]>`:

- **word, resolution `letters`** → reuse the *existing* `layoutChars()` to get `CharGlyph[]`, map
  each to a glyph `Tile` (this is where Space Type's per-letter magic is preserved verbatim).
- **word, resolution `whole`** → render the word to one canvas (same path `layoutChars` already
  uses) → one glyph `Tile` spanning `u 0..1`.
- **image** → load the src into a `THREE.Texture` → one image `Tile`, `aspect` from the bitmap.

Image loading is async; the stage returns a Promise. The surface and the headless frame source both
resolve tiles **before** building the scene (mirroring how the studios that already carry uploaded
images preload them), so the effect's `build` stays synchronous.

### 2. Document state: the content list

New additive field on `SpaceTypeState`: `content: ContentItem[]` (ordered).

```ts
type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'image'; src: string; aspect?: number }
```

Order is authoring order (the order items appear in the editor). It is the *only* consumer-visible
placement rule in v1 — no auto-interleave, no grouping. Existing documents have no `content` field;
only the `ring` effect reads it, so their render is unaffected.

Images are stored the way Sailor's other studios store uploaded images (own-folder upload + serve
guard, the moodboard/dataset pattern), so the same `src` resolves in the preview engine and in the
headless frame source.

### 3. The `ring` layout effect

`app/lib/spacetype/effects/ring.ts` (new), registered in `effects/index.ts`. A `SpaceTypeEffect`
whose `build`/`update` consume `Tile[]` (from the resolved content list) instead of `params.text`.

- **Placement:** `N = tiles.length` upright quads evenly around a circle of radius `R`, each facing
  radially outward (borrow cylinder's placement). Quad size from `cardSize`; per-tile width from
  `tile.aspect × cardSize`.
- **Loop:** whole-ring spin over `t` using the established **integer-turns-per-loop** seam trick
  already proven in `turntable.ts`/`cylinder.ts`, so the loop is seamless by construction.
- **Controls (the one declaration):** `ContentList` (the editor), `radius`, `ringTilt`,
  `ringOpening`, `cardSize`, `perspective`, `speed`, `direction` — a small animos-shaped set, each a
  `ControlSpec`. Camera reuses the surface-injected `Camera` section. No letter-only controls exist
  on the ring, so the grey-out concern (piece for expansion) does not arise in v1.
- **Fills:** an image tile samples its own texture; a glyph tile keeps the existing fill rails
  (solid/gradient/…) so words in the ring can still be coloured.

### 4. Surface: the content editor

The content list is a **new `ControlSpec` kind** — `contentList` — joining the existing bespoke
kinds (`textList`, `fillList`, `path`, `curve`) that already pair a scalar param with a
custom surface renderer. `SpaceTypeSurface.vue` renders it as an ordered editor: add a word row
(text field + a `whole`/`letters` segmented toggle) or an image row (upload / drop), reorder by
drag. It appears wherever the `ring` effect declares it (the `Type` section). Every other effect's
panel is unchanged; the ring's *scalar* controls (radius, tilt, speed, …) still derive from the
declaration with no hand-written UI — only the content list carries a bespoke renderer, by design.

## Data flow

```
content list (words + images)
        │
        ▼
contentToTiles ──► Tile[] ──► ring.build/update ──► camera + loop ──► bake / frame source
   (async, pre-resolved)         (content drives N)     (unchanged)     (unchanged)
```

Everything from `ring.build` rightward is existing machinery. The whole v1 lives to the left of it.

## Success criteria (proven when)

1. A `ring` document with **6 uploaded photos + 2 words** exports a clean, seamless loop with photos
   and words orbiting together.
2. A word's **resolution dial** visibly switches it whole ↔ per-letter, and the ring re-spaces to
   the new tile count.
3. **Every existing Space Type document** opens and renders bit-for-bit unchanged (guaranteed by not
   touching existing effects; assert with a before/after render of a saved doc).
4. The `ring` layout's **scalar** controls and its animation come entirely from its `ControlSpec`
   declaration (the only bespoke UI is the `contentList` renderer, matching `fillList`/`path`
   today), confirming the factory pattern carries the new layout.

## Testing

- **Unit** — `contentToTiles`: a whole word → 1 glyph tile; a `letters` word of length K → K glyph
  tiles with monotonic non-overlapping UVs; an image → 1 image tile with correct aspect; mixed list
  preserves order and count. `ring` placement: N tiles → N transforms evenly spaced; loop endpoint
  transform equals start transform (seam).
- **Parity/regression** — a saved non-ring document's rendered frame is unchanged (the guarantee in
  success criterion 3), following the render-parity discipline already used across surfaces.
- **Manual/E2E** — the money-shot ring, exported, watched to confirm the seam and the dial.

## The expansion ladder (explicitly out of v1)

In rough order, each a low-risk additive step once the seam holds:

1. **Wire from canvas** → images arrive from an upstream node; content count becomes dynamic/live.
   The seam already fits N tiles, so this is mostly input plumbing.
2. **More layouts** → generalize the existing glyph arrangements (`cylinder`, `tunnel`, `spiral`,
   `ball`) to accept tiles; then the first brand-new family (wall/grid — the most animos-signature
   thing v1 lacks).
3. **Letter-only grey-out** → once image tiles can enter the *glyph* arrangements, the melt/tear/
   warp controls grey out per tile kind (the `showIf`/kind gate).
4. **Fast-delight preset layer + touch-to-detach** → the motion-ownership law, which only earns its
   keep once presets and hand-tracks can conflict.
5. **The rename** to Expressive Studio → last, once the surface behaves like the name.

## Risks

- **The seam leaks type-only assumptions.** Mitigated by writing `ring` tile-native from scratch and
  leaving the glyph effects untouched — the seam is proven in isolation before any generalization.
- **Async image loading vs. synchronous effect build.** Mitigated by pre-resolving tiles in both the
  surface and the frame source, so `build` never awaits.
- **Headless frame source can't see uploaded images.** Mitigated by using the existing own-folder
  upload/serve pattern whose `src` already resolves in both engines; asserted by success criterion 1
  (the *exported* loop, which runs through the frame source, must contain the photos).
- **Content-list state on a text-first document.** Additive and single-consumer (`ring` only), so
  existing documents are inert to it.

## What this does not change

- No rename; the node/surface stays `spacetype` internally.
- No existing effect is modified; all 25 render as before.
- No wire input, no preset layer, no new camera — all deferred to the ladder.
