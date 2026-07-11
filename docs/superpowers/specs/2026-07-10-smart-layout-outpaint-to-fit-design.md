# Smart Layout — Outpaint an image to fit a format

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

A Smart Layout image element reflows across every format (Square, Portrait, Story,
Wide). A source shot that looks right in Square gets awkwardly cropped when the same
image is reflowed into a Wide (16:9) canvas — the product ends up letterboxed or its
sides sliced off. Creatives want to **generatively extend** (outpaint) the image so it
fills a wider/taller format naturally, the way Photoshop "Generative Expand" or Figma's
fill tools work.

## Decisions (locked with the user)

1. **Scope = this format only.** The outpainted result is a *per-output content
   override* (`el.overrides[outputId].content`). Wide shows the wide-extended image;
   Square / Story / Portrait keep the original source and reflow as before.
2. **Target = the whole canvas/format aspect** (e.g. 1920×1080 → 16:9), not the
   element's grid sub-region. Good for full-bleed backgrounds.
3. **Fill = automatic.** No prompt — FLUX Fill continues the existing background/scene
   outward. One click.

## Architecture

### Data model (`shared/template-grid/types.ts`)
Extend the per-output override record with an optional `content`:
```ts
overrides?: Record<string, { region?: Region; hidden?: boolean; content?: string }>
```
No new element type, no new render path. The override is a plain string URL
(`/view?filename=…&type=input`) like any other image `content`.

### Resolver (`shared/template-grid/resolve.ts`)
`resolveFormat` already computes `oid` (the output key). Thread `oid` into the `ctx`
passed to `fitElementAtRect`, and at the top of that function bake the override in:
```ts
const co = el.overrides?.[oid]?.content
if (co != null) el = { ...el, content: co }
```
Because every surface (editor `imageSrc`, satori image node) reads the **resolved**
element's `.el.content`, this single point makes both the on-canvas preview and the
real PNG render honour the override. Section children resolve through the same `ctx`,
so they get it for free. Absent override → byte-identical to today.

### Outpaint compositing (pure, unit-tested)
`app/lib/outpaint/plan.ts` — `planOutpaint(srcW, srcH, targetAspect, opts)` returns
`{ canvasW, canvasH, drawRect, keepRect }`, pure and deterministic:
- Scale the source to fully fit the **matching** axis and extend the **deficient**
  axis (never crop the original).
  - target wider than source → source at full height, centered, side margins to fill.
  - target taller than source → source at full width, centered, top/bottom margins.
- Cap the canvas longest side to 1536 (house cost rule).
- `keepRect` = the source rect inset by a small `overlap` so the mask regenerates a
  thin seam strip for a seamless blend.

`app/lib/outpaint/compose.ts` (browser) — from the plan + an `HTMLImageElement`,
paints two PN​G data URLs: the **image** (source drawn onto the target-aspect canvas,
extension margins transparent/black) and the **mask** (white = margins to generate,
black = `keepRect`).

### Orchestration (`app/composables/useOutpaintFit.ts`)
`{ busy, error, run(srcUrl, targetAspect) }`:
load source (crossOrigin) → `planOutpaint` → `compose` → `useInpaint().fluxFill(image,
mask, '')` → `uploadDataUrl` → return `/view?filename=<name>&type=input`. Any failure
leaves the element untouched; caps to 1536 before the paid endpoint.

### Editor state (`app/composables/useGridEditor.ts`)
- `setImageContentOverride(id, url)` — mirrors `setHiddenInOutput`: writes
  `overrides[currentOutputId].content`, participates in the existing deep-watch undo
  (one step).
- `clearImageContentOverride(id)` / `hasContentOverride(id)` — revert + state.
Exposed on `GridEditorContext`.

### UI (`app/components/templates/GridPropertyPanel.vue`, Image section)
- **"Outpaint to fit {formatLabel}"** button. Disabled while busy (spinner) or when the
  source isn't a loadable URL. On success → `setImageContentOverride`.
- **"Revert to original"** link shown only when `hasContentOverride`.

## Testing
- **Unit (headless):** `planOutpaint` — wider/taller/equal aspect, 1536 cap, keepRect
  inset, source never cropped. Resolver — a `content` override is baked into the
  resolved element for its output only; other outputs unchanged; no override →
  identical.
- **Owed to the user (needs backend + Replicate):** the FLUX Fill generation *quality*
  itself, verified live on `/dev/sl-modal`. Not claimed working until seen.

## Non-goals
- Prompt-guided fill, per-region (vs whole-canvas) targets, outpainting sections/shapes,
  and batch "outpaint every format" — all deferred.
