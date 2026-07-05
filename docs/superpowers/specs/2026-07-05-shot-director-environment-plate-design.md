# Shot Director — Environment Plate

**Date:** 2026-07-05
**Status:** Design approved (env-plate increment). Scene/coverage model deferred to its own spec.
**Related:** [[project_shot_director]], viewfinder-first pivot (`adb069f80`), [[feedback_pastel_means_ai]], [[project_glimm_page_transitions]] (127.0.0.1 gotcha)

## Problem

The Shot Director surface treats the Subject/cast with rich imagery (cast photos,
viewfinder composition) but leaves **Environment as a lonely text box**
(`"rainy street, neon signs"`). This contradicts the product's own thesis —
*references outweigh prose* — which the UI states three times ("the model follows
images far more than words"). A location **image** steers Seedance's location,
palette, and depth far harder than the words, and it is the missing **backdrop**
that would turn the new viewfinder from "figure in a void" into a real shot.

## Scope

Add the ability to **attach or generate a single environment image** on the
Environment field. The image is a real reference sent to the model (it steers the
video) **and** renders as the viewfinder backdrop.

This is the first piece of **scene-level context** (location) escaping the
single-shot box. It is built to be forward-compatible with a future Scene layer
(see Forward Compatibility) but ships as a self-contained increment.

### Out of scope (YAGNI)
- Multiple environment plates / angle variants / regenerate-history gallery.
- A reusable "Location library" primitive (belongs to the Scene-model spec).
- Any change to the scene/coverage (multi-shot) model — that is the next spec.

## Design

### 1. Data model — a `'location'`-role image reference

No new primitive. An environment plate is an image `Ref` (kind `'image'`) with a
new role `'location'`. **At most one at a time**; attach/generate replaces the
existing one. It counts toward the model's `≤9` image budget like any other ref.

Changes in `frontend/app/lib/shotdirector/types.ts`:
- Add `'location'` to the `RefRole` union (in the image-roles group).
- `ROLE_PURPOSE['location'] = 'the location and setting'`.
- **Do NOT** add `'location'` to `ROLES_BY_KIND.image`. That map drives the manual
  role dropdown in the Images rail; the plate sets its role directly and must not
  appear as a user-selectable role. (The plate is also filtered out of the rail —
  see §3 — so it is surfaced in exactly one place.)

Deliberately **not** `composition-lock`: that role locks framing to the reference.
We want the place, not its exact composition — `'location'` reads as "use this
environment" without over-constraining the shot's framing.

### 2. Compile — free, via existing machinery

`referenceSentence()` in `compile.ts` already maps every non-cast reference through
`ROLE_PURPOSE`. A location ref therefore emits, with zero compile-code change:

> `… Use [Image2] for the location and setting.`

It is a real reference in `reference_images`, so it steers the generated video.
Capacity validation in `rules.ts` already counts it — no change.

### 3. Surface UI — a slot under the Environment field

In `ShotDirectorSurface.vue`, directly beneath the Environment `<input>` (reference
mode only):

- A **thumbnail** of the current plate (if any) + a **Remove** control.
- **Attach** — opens a file picker; upload → `setLocationRef(src)`.
- **Generate** — a **pastel** (AI-affordance, per [[feedback_pastel_means_ai]])
  button showing `~$0.01`. Runs the environment text through flux-schnell and stores
  the result as the plate. Loading + error states inline.
- **Empty state**: one quiet line, e.g. "Add a location image — it steers the
  setting far more than words, and becomes the frame's backdrop."

New reactive/derived state:
- `environmentRef = computed(() => sheet.references.find(r => r.role === 'location') ?? null)`
- `imageRefs` (existing) **excludes** `role === 'location'` — the plate never
  double-shows in the Images rail.
- `subjectImage` (existing) **excludes** `role === 'location'` — **critical**, or the
  backdrop would be picked as the composed subject.
- `envGenerating: Ref<boolean>`, `envError: Ref<string | null>`.

Handlers:
- `setLocationRef(src)` — remove any existing location ref, then
  `addReference('image', src, 'location')` (one-at-a-time replace).
- `onEnvironmentFile(e)` — upload via `uploadRefFile` (data-URL fallback) →
  `setLocationRef`.
- `generateEnvironment()` — POST `/api/inpaint/text2img` with:
  - `prompt`: `[environment, lighting, style].filter(Boolean).join(', ')` +
    `', empty establishing location, no people, cinematic'`
  - `aspect_ratio`: `sheet.format.aspectRatio`, `count: 1`
  - On success (`{ images: [dataUrl] }`) → `setLocationRef(images[0])`.
  - Errors set `envError`; toggles `envGenerating` around the call.
- **Generate disabled** when the Environment text is blank or `envGenerating` is true.

### 4. Viewfinder backdrop

`ShotViewfinder.vue` gains `environmentImage?: string | null`. In reference mode it
renders as the frame's background: an absolutely-positioned `object-cover` `<img>`
behind the thirds guides and subject, with a subtle darken overlay (≈`bg-black/30`)
so the subject silhouette still reads. First/last-frame mode is unaffected (it owns
its own two-panel layout). The "Your shot appears here" empty state shows only when
there is **neither** a subject **nor** an environment image.

### 5. Edge cases
- **Mode XOR** — references are invalid in first/last-frame mode, so the plate slot
  renders only in reference mode; the Environment *text* field stays in both.
- **Empty text** — Generate disabled (nothing to generate); Attach still available.
- **Budget** — with 9 non-location images and no existing plate, adding one exceeds
  `maxRefImages`; the existing capacity validation surfaces this as an issue. Minor
  guard: disable Attach/Generate when at cap and no current plate.

## Forward compatibility (Scene model, next spec)

The plate is modeled as **scene-level context**: role `'location'` is a scene
concept, not a shot concept. When the Scene layer lands, `location` migrates from
`ShotSheet.references` to `Scene.context.location`, and shots inherit it — the
compile role and the `ROLE_PURPOSE` phrasing are unchanged, so there is no prompt
migration. Nothing here scaffolds the Scene model prematurely (YAGNI); it just
avoids naming/semantics that would fight it.

## Testing
- Unit (`shotdirector-types`): `ROLE_PURPOSE` has a `'location'` entry.
- Unit (`shotdirector-compile`): a sheet with a `'location'` image ref compiles a
  prompt containing `for the location and setting`.
- Existing shotdirector suites stay green (no logic change to compile/rules).
- Browser: `/dev/shot-director` harness — attach + generate paths, backdrop renders,
  plate absent from the Images rail, subject not overridden by the plate. Navigate
  via `127.0.0.1` (not `localhost`) to dodge the HTTP 426 IPv6 gotcha.

## Files touched
- `frontend/app/lib/shotdirector/types.ts` — `'location'` role + `ROLE_PURPOSE`.
- `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` — env slot, handlers,
  rail/subject exclusion, viewfinder prop.
- `frontend/app/components/vue-canvas/ShotViewfinder.vue` — backdrop prop + render.
- `frontend/app/pages/dev/shot-director.vue` — harness seed gains a location ref.
- `frontend/tests/unit/shotdirector-*.unit.spec.ts` — role + compile assertions.
