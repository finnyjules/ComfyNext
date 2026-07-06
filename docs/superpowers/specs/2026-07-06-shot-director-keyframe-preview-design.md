# Shot Director — keyframe preview ("see it before you spend the minutes")

**Date:** 2026-07-06
**Status:** Design approved. Pass A = on-demand keyframe preview. Pass B = lock-as-first-frame (follow-on).
**Related:** [[project_shot_director]] (viewfinder `adb069f80`, env plate `c87994d5c`, cover fix `aa21507ac`), wardrobe/nano-gen `c498a4a06`, [[feedback_cost_conscious_ai]], [[feedback_pastel_means_ai]]

## Why

Seedance runs are slow (minutes) and ~$2.25. The viewfinder today is a *schematic*
(silhouette on thirds + move arrow) — it can't convey lighting, wardrobe, or how the
cast sits in the location. Closing that gap means *generating* the preview, not
drawing it. A single photoreal still from the **same prompt + same references**
Seedance will use is the closest possible proxy — and at ~$0.05 / a few seconds it's
~40× cheaper and ~100× faster than the real run. "Spend a nickel to see it first."

## Pass A — on-demand keyframe (this build)

### Model & fidelity
Reuse `nano-banana-pro` via `/api/inpaint/nano-gen` (already multi-image). It is
*reference-conditioned image edit* — the still-frame analog of Seedance's
*reference-to-video* — so it carries identity + location the way Seedance will. A
text-only model (flux-schnell) is ~10× cheaper but ignores the references and would
invent a different face/place → a poor predictor. Reference-aware is the point.

- `image_input` = `[castCover?, locationPlate?]` (filtered, person-first), as data URLs.
- Prompt = a **still**-shaped instruction (motion stripped) — see keyframe.ts.
- Generate at the shot's **aspect ratio** so framing is honest.

### `lib/shotdirector/keyframe.ts` (pure, tested)
`buildKeyframePrompt(sheet, { hasPerson, hasLocation }): string` — a photoreal
film-still instruction. Keeps shot-type framing, lighting, style, subject/action;
**drops camera move + pacing** (a still can't show motion, and motion words confuse
the image model). Composition sentence matches the image order:
- person + location → "Place the person from the first image into the location in the second image."
- person only → "Feature the person from the first image."
- location only → "Set in the location from the first image."
- neither → pure text.

### Endpoint
`nano-gen` gains an optional `aspect_ratio` passthrough (defaults to current 1K
behavior when omitted). No other change.

### Surface state (`ShotDirectorSurface.vue`)
- `previewFrame: string | null`, `previewBusy`, `previewError`, `previewKey`.
- `previewSignature` = compiled prompt + subjectImage + environmentImage + aspectRatio.
  When it differs from `previewKey`, the shown keyframe is **stale**.
- `generatePreview()`: build prompt (via `buildKeyframePrompt`), fetch the
  person/location images to data URLs, POST `nano-gen` with `images` + `aspect_ratio`,
  store `previewFrame` + stamp `previewKey = previewSignature`.
- **Cache/cost control:** only the explicit button spends. Editing never auto-spends;
  it just marks the existing keyframe stale.

### Viewfinder (`ShotViewfinder.vue`)
- New `keyframe?: string | null` + `keyframeStale?: boolean` props. When `keyframe`
  is set (reference mode), render it **full-bleed** as the frame image, with the
  camera-move motif + corner labels still overlaid (motion intent a still can't show).
  A subtle "preview out of date — update" chip when stale.
- A **Preview frame** control under the frame: pastel, `~$0.05`; label flips to
  "Update preview" when stale, spinner while busy; inline error.

## Pass B — lock as first frame (follow-on spec)

A toggle on an approved keyframe: set it as Seedance's **first frame** (i2v) so frame
1 of the output IS the preview. Switches the shot to first/last-frame mode (drops
reference images — the keyframe already encodes identity + location), and re-enters
the photoreal-face-guard consideration (E005). Its own spec; not built here.

## Scope cuts (Pass A)
- One keyframe (not a per-beat filmstrip — natural follow-on).
- Explicit button only (no debounced auto-generate — cost).
- No first-frame lock (Pass B).

## Testing
- Unit: `buildKeyframePrompt` (all four ref combinations; asserts no move/pacing words).
- Unit: `nano-gen` still works without `aspect_ratio`; passes it through when given.
- Browser (harness): Preview button renders (idle / busy / stale states), keyframe
  slot renders when a data URL is present. Live generation is a paid call — not run.

## Files
- `frontend/app/lib/shotdirector/keyframe.ts` (new) + unit test.
- `frontend/server/api/inpaint/nano-gen.post.ts` — `aspect_ratio` passthrough.
- `frontend/app/components/vue-canvas/ShotViewfinder.vue` — keyframe render + stale chip.
- `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` — preview state + button.
- `frontend/app/pages/dev/shot-director.vue` — harness can inject a fake keyframe.
