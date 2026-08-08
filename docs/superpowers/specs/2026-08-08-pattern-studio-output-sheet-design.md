# Pattern Studio — output sheet (resolution + density)

**Date:** 2026-08-08
**Surface:** Pattern Studio (`TextureStudioSurface.vue` / `TextureStudioNode.vue`, `lib/texturefx/*`)

## In plain language

Right now Pattern Studio always makes the same thing: one square 1024×1024 tile. You
cannot ask for a bigger file, you cannot ask for a 16:9 file, and you cannot make the
pattern read denser or looser on the page — the only density knob is `Cells`, which
changes the motif itself rather than the sheet.

This adds a second tab, **Output**, next to **Design** — the same tab strip Type Studio
and Gradient Studio already use for Design/Motion. In it you set two things: how big the
exported image is (the *sheet*), and how big one tile is inside it (the *density*). A
512px tile on a 3840×2160 sheet gives you a fine, repeating field; a 2048px tile on the
same sheet gives you four big ones. Existing patterns keep exporting exactly what they
export today.

## Decisions taken

1. **Sheet size + tile size**, repeats derived — not tile-resolution-only, not print
   units. Pixels are the source of truth; no DPI anywhere in v1.
2. **The tab decides the preview.** Design keeps today's tile inspector; Output shows the
   real framed sheet.
3. **Free crop, with a tileable badge.** Any sheet is allowed; a chip tells you when the
   exported PNG happens to re-tile edge-to-edge.
4. **The node card letterboxes the sheet**, so the canvas stops implying every pattern is
   3:2.

## Stored state

Four flat params in the `'Output'` group, which `lib/texturefx/sections.ts` has reserved
since it was written. Texture's `Params` is flat (unlike Gradient's nested `cfg`), so
these are plain `params.<key>` entries and the existing
`{ ...textureDefaults(), ...cloneParams(p) }` merge in `loadParams()` backfills them for
any pattern saved before this landed.

| key | kind | options / range | default |
|---|---|---|---|
| `sheetPreset` | select | `Tile · square`, `1920 × 1080 (16:9)`, `1080 × 1920 (9:16)`, `2048 × 2048`, `3840 × 2160 (4K)`, `Custom` | `Tile · square` |
| `sheetW` | slider | 128–8192, step 64, `when` preset is `Custom` | 1024 |
| `sheetH` | slider | 128–8192, step 64, `when` preset is `Custom` | 1024 |
| `tilePx` | select | `128`, `256`, `512`, `1024`, `2048` | `1024` |

`Tile · square` means *the sheet is exactly one tile*: `w = h = tilePx`. With the defaults
above that is 1024×1024 from a 1024 tile — byte-identical to the current `exportBlob`.
This is the back-compat guarantee and must be asserted, not assumed.

Every `tilePx` option is a multiple of 64. That is a hard requirement, not a convention:
the dither patterns in `DITHER_PERIOD` (`types.ts`) need the tile to be a whole number of
dither periods or the stylize pass seams. Custom `sheetW`/`sheetH` do not affect this —
stylize is applied per tile, before the repeat-fill.

## Module: `lib/texturefx/sheet.ts`

One resolver, imported by every surface that puts pixels on screen. This is deliberate:
Pattern Studio already has three independent render paths (studio preview, studio export,
node card + headless bake) and they will drift the moment any two of them derive
dimensions on their own.

```ts
export type Sheet = { w: number; h: number; tile: number }

export const SHEET_PRESETS: Record<string, [number, number] | null>  // null = follow tile

export function sheetFromParams(p: Params): Sheet
export function repeatsFor(s: Sheet): { x: number; y: number }
export function isTileable(s: Sheet): boolean
export function fitLetterbox(s: Sheet, boxW: number, boxH: number): { w: number; h: number; x: number; y: number }
export function drawSheet(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, s: Sheet, destW: number, destH: number): void
```

- `sheetFromParams` reads `sheetW`/`sheetH` when the preset is `Custom`, and the preset
  table otherwise. It must never consult the table for a custom sheet — Space Type's
  `dimsFromKey` has exactly that bug and returns stale dimensions for custom sizes.
- `repeatsFor` returns fractional repeats (`{ x: 3.75, y: 2.11 }`) for the readout.
- `isTileable` is true only when both repeats are whole numbers.
- `drawSheet` scales the tile by `destW / s.w` and repeat-fills, so a preview never
  allocates a full-size canvas. At 1:1 (`destW === s.w`) it is the export path.

## Render paths

All three call `sheetFromParams` then `drawSheet`; none compute their own dimensions.

**Studio export** — `exportBlob()` renders the tile at `sheet.tile`, runs `stylizeTile`,
then `drawSheet` at 1:1 into a `sheet.w × sheet.h` canvas and encodes. `sendToCanvas`,
`downloadPng` and the Collection param-baker (`renderBlobWithOverrides`) all route through
`exportBlob` already, so they inherit the sheet with no change.

**Node headless bake** — `bakeOutput()` in `TextureStudioNode.vue` does the same, replacing
its hard-coded `BAKE_TILE = 1024`. The render cascade therefore honours the sheet.

**Previews** — render the tile once at ~256px, then `drawSheet` at the display size.
The studio's Output preview letterboxes into the existing `max-h-[60vh]` box; the node card
letterboxes into its 220×`PREVIEW_H` box via `fitLetterbox`, with the surround left dark.

The Design-tab preview is unchanged: it is a tile inspector, not a sheet, and its 1×/2×/3×
buttons and seam guides exist to judge the repeat.

## Panel

A `Design | Output` pill strip at the top of the controls column, using the same
`inspectorTab` ref and markup as `SpaceTypeSurface.vue` and `GradientStudioSurface.vue`.
Pattern Studio has no motion, so Output occupies Motion's slot in that family.

Filtering is one added clause in the existing per-control gate `controlVisible()`
(`TextureStudioSurface.vue:230`): on Design, hide controls whose `group` is `'Output'`;
on Output, hide every control whose group is not. The hand-rolled Fills panel — which is
not driven by `TEXTURE_CONTROLS` — gets a `v-if="onDesign"`.

Below the Output controls sits a readout (not a control):

> **1920 × 1080** · 3.75 × 2.11 repeats · `not self-tiling`

The last chip lights up only when `isTileable()`. It is informational — no sheet is
blocked, and nothing snaps.

## Agent and Collections

The new controls are declared in `TEXTURE_CONTROLS` like every other, so
`describeTexture`/`applyTextureCommand` and `controlsForStudio` pick them up with no extra
declaration — one declaration, all capabilities. Sheet keys are output configuration
rather than aesthetics, so sweeping them is odd but harmless; v1 does not exclude them.

## Tests

Pure functions, so these run under happy-dom with no GPU:

- **Back-compat lock:** `sheetFromParams(textureDefaults())` → `{ w: 1024, h: 1024, tile: 1024 }`.
- **Legacy params:** an object with no sheet keys, merged the way `loadParams()` merges,
  resolves to the same thing.
- **Custom reads W/H:** preset `Custom` with `sheetW: 1500, sheetH: 700` → 1500×700,
  regardless of what any preset table holds.
- **`repeatsFor`:** 1920×1080 with a 512 tile → `{ x: 3.75, y: 2.109375 }`.
- **`isTileable`:** true for 2048×2048/512, false for 1920×1080/512.
- **Dither invariant:** every `tilePx` option is a multiple of 64.
- **`fitLetterbox`:** a 9:16 sheet in a 220×140 box fits by height and centres horizontally.

Verification beyond unit tests: export at a non-default sheet and confirm the PNG's actual
pixel dimensions match the readout, and that the tile count on the sheet matches
`repeatsFor` — a preview that merely "looks right" is not evidence that the export path ran.

## Out of scope

- DPI or physical units (mm/inch). Pixels only in v1.
- Snapping tile size to divide the sheet evenly.
- Non-square tiles.
- Any change to how `Cells` works — motif density and sheet density stay separate knobs.
