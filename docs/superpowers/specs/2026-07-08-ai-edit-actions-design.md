# AI Edit Actions suite — design

**Date:** 2026-07-08
**Status:** Approved (brainstorm dialogue, 5 decisions locked)

## Goal

Close the Tier-1/2 gaps in the AI edit-action catalog with five actions:
**Remove Object**, **Remove Background (surfacing)**, **Harmonize Layer**,
**Text Edit**, **Recolor Object**. All engines are cloud-only (user decision);
every action composes the five existing Nitro routes — segment, flux-fill,
kontext, nano-gen, remove-bg — so **no new server routes** are needed.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Scope | The 5 gap actions (no scene presets, no Tier 3) |
| Engines | Cloud-only; no local LaMa/rembg paths, no escalator chips |
| Surfaces | Artifact Edit menu + Frame layer context menu + ACTION_CATALOG nodes |
| Harmonize result | Replace layer content in place, one undo step reverts |
| Node shape | One Python node per action (minimal clones of SwapProduct pattern) |

## 1. Remove Object

**Interactive (Edit menu → InpaintModal "remove" mode).** New Edit-menu entry
opens the existing InpaintModal in a new mode: the existing click-to-select
(SAM via `/api/inpaint/segment`) produces the mask, and remove mode runs
`/api/inpaint/flux-fill` immediately with a fixed erase prompt
("empty scene, seamless background continuation") — no prompt field. One click
on an object erases it. Manual brushing remains the fallback (segment's
existing degradation path). Result is a **branched artifact** (`branch: true`).

**Graph node.** `RemoveObjectNode(image, object_description)` — mask-free
instruction edit (Kontext / nano-banana-2): "remove the {X}, fill with
background". Text-prompted because graphs/agents cannot click.
Catalog: *"Remove an object" · Flux Kontext / Nano Banana 2 · edit · source: image*.

## 2. Remove Background (surfacing only)

Node, route, and catalog entry already exist (`RemoveBackgroundNode`,
`/api/inpaint/remove-bg`). Two additions:

- **Edit menu** entry → `spliceEffect('RemoveBackgroundNode', { run: true, branch: true })`
  (prompt-less → run immediately, like Upscale).
- **Frame layer menu**: "Cut out subject" on image layers → calls
  `/api/inpaint/remove-bg`, replaces the layer's content **in place** via a
  shared replace-in-place helper (introduced in this slice, reused by
  Harmonize §3).

## 3. Harmonize Layer (new capability)

Surfaces: layer context menu + inspector button on **both** Frame surfaces
(CompositorModal and ArtifactFrameNode). Known gotcha: render-watch deps must
include `localGroups` (and any new reactive state) on both surfaces.

**Pipeline (existing routes only):**

1. Flatten the frame composite; crop a context window around the target
   layer's bbox with ~40% padding.
2. Send `[cropped scene, layer image]` to `/api/inpaint/nano-gen` multi-image
   input. Prompt: "Relight and color-grade the object in the second image so
   it sits naturally in the first image's scene. Keep its shape, position and
   identity exactly."
3. Run the result through `/api/inpaint/remove-bg` to recover the alpha cutout.
4. Replace the layer's image content in place — position/scale/mask/z
   untouched; one undo step reverts.

**Scope:** v1 is relight + color-match only. Contact shadows are out
(nano-banana cannot return alpha; remove-bg would strip a soft shadow).
**Stretch task:** procedural **"Cast shadow" layer** — skewed, blurred
silhouette generated locally from the layer's own alpha; free and editable.

## 4. Text Edit

**Interactive (Edit menu → "Edit text…" popover, not a modal).** OCR via the
existing ExtractTextNode engine (Dolphin) pre-fills detected strings as
clickable chips; the user picks one and types a replacement. If OCR finds
nothing, degrade to two free-text fields (find / replace). Engine:
nano-banana-2 instruction edit — "Replace the text '{old}' with '{new}'.
Match the original font, color, perspective and lighting exactly. Change
nothing else." → branched artifact.

**Graph node.** `TextEditNode(image, find, replace)` — same prompt builder,
shared as a tested TS util (loraPrompt.ts convention) and mirrored in the
Python node. Catalog: *"Edit text in an image" · Nano Banana 2 · edit · source: image*.

## 5. Recolor Object

**Interactive (Edit menu → "Recolor…").** Reuses the remove-object
interaction: click the object (SAM mask) → swatch strip appears — **active
brand-kit colors first**, then a free color picker. Runs masked
`/api/inpaint/flux-fill` with "same object recolored to {color name} ({hex}),
keep material, texture and lighting". Two-click on-brand recolor is the
differentiator.

**Graph node.** `RecolorObjectNode(image, object_description, color)` —
mask-free Kontext instruction variant. The color input is variable-bindable
(pink affordance), so it composes with collections (recolor per campaign row).

## Cross-cutting

- **No new Nitro routes.** All actions compose segment / flux-fill / kontext /
  nano-gen / remove-bg. No proxy allow-list or rate-limit changes (existing
  routes already covered by tier-0 limits).
- **3 new Python nodes** (RemoveObjectNode, TextEditNode, RecolorObjectNode),
  each a minimal clone of the SwapProduct pattern, each with a credit-cost
  estimate. ComfyUI restart required to register.
- **Testing:** prompt builders are pure TS utils with unit tests; interactive
  flows get browser verification with screenshots before sign-off; paid render
  sign-off is user-owned.
- **Ship order:** §2 → §1 → §5 → §4 → §3 (Harmonize last; §2's layer
  replace-in-place plumbing is its dependency — build that plumbing in the §2
  slice).

## Error handling

- Segment route failure → InpaintModal's existing manual-brush fallback.
- OCR returns nothing → free-text find/replace fields.
- remove-bg failure inside Harmonize → abort with a toast; layer untouched
  (the replace happens only after the full pipeline succeeds).
- All cloud calls surface route errors via the existing artifact error chip
  pattern; no partial layer writes.
