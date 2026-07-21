# Scene3D — text → image → 3D generation

**Date:** 2026-07-20
**Status:** Design approved, implementing

## Problem / goal

Let a user type a prompt in the 3D Studio and get a generated 3D shape inserted into the
scene. Chosen flow (from design discussion): **text → FLUX image → (review + re-roll) →
image-to-3D → GLB → insert**, calling **fal.ai directly** via the app's existing
`runFal`/`falStorage` server helpers (NOT the ComfyUI managed-API nodes). Default image-to-3D
model **Hunyuan3D v2**, swappable.

## Why this is cheap to build

- **Insertion already exists:** `addGlb(url)` → `createGlbObject` → `loadGlb` (fetch + parse
  any GLB URL). Dropping a generated GLB in is the same path as "Upload GLB".
- **fal already wired:** `server/utils/falRun.ts` (`runFal(app, input)` — submit + poll),
  `firstFalImageUrl(result)`, `server/utils/falStorage.ts` (`getFalToken`, `uploadToFalStorage`),
  `fetchAsDataUrl` (CORS helper). Route pattern established (`server/api/inpaint/flux-fill.post.ts`).
- **fal outputs are public CDN URLs** (`v3.fal.media`) — FLUX's image URL feeds straight into
  the 3D model as `input_image_url` (no upload), and the GLB URL is directly fetchable by
  `loadGlb`.

## Architecture

### Server routes (Nuxt/Nitro, reuse fal helpers)

**1. `POST /api/scene3d/gen-image`** — text → image.
- Body: `{ prompt: string, seed?: number }`.
- Shapes the prompt for clean single-object 3D input by appending a suffix (e.g.
  `", single centered object, plain neutral background, product shot, full object in frame"`)
  — this materially improves the downstream 3D result.
- `runFal('fal-ai/flux/dev', { prompt, image_size: 'square_hd', num_images: 1, seed })` →
  `firstFalImageUrl(result)`.
- Returns `{ imageUrl: string, seed: number }`. Re-roll = call again with a new seed.

**2. `POST /api/scene3d/gen-3d`** — image → 3D.
- Body: `{ imageUrl: string, model?: string, textured?: boolean }`.
- A **model adapter** (pure, testable) maps `model` → `{ app, buildInput(imageUrl, opts), glbUrlFrom(result) }`:
  - `hunyuan3d-v2` (default) → app `fal-ai/hunyuan3d/v2`, input `{ input_image_url, textured_mesh }`, output `model_mesh.url`.
  - `trellis-2` → app `fal-ai/trellis-2`, input `{ image_url }`, output `model_mesh.url`.
  - `tripo-v2.5` → app `fal-ai/tripo3d/tripo/v2.5/image-to-3d`, input `{ image_url }`, output `model_mesh.url` (or `pbr_model.url`).
  - `triposr` → app `fal-ai/triposr`, input `{ image_url }`, output `model_mesh.url`.
  (Exact per-model field names verified against fal's live schema at build; Hunyuan3D v2 is
  confirmed: `input_image_url`, `textured_mesh`, output `model_mesh.url`.)
- `runFal(app, input, { pollDeadlineMs: 300_000 })` (3D can take up to ~4 min) →
  `glbUrlFrom(result)`.
- Returns `{ glbUrl: string }` (the fal CDN URL — durable + fetchable).
- **CORS fallback:** if the studio's `loadGlb` fetch of a fal GLB URL is CORS-blocked, add a
  thin `GET /api/scene3d/glb-proxy?url=` passthrough. (fal CDN is normally CORS-open; the
  route stays the same, only the returned URL changes to the proxy. Decide at verification.)

### Studio UI (Scene3DStudioSurface.vue)

- A **"Generate"** entry in the bottom toolbar (beside Primitive / Upload GLB / Light) opens a
  small **generate panel**:
  - Prompt textarea + **Generate** button.
  - **Image review**: shows the returned FLUX image with **Re-roll** and **Make 3D**; a **model
    dropdown** (Hunyuan3D v2 default; Trellis 2 / Tripo v2.5 / TripoSR) and an optional
    **Textured** toggle.
  - **Progress states** for both steps (image ~5–15s; 3D ~20s–4min) with cancel.
- On 3D success: fetch/insert via `addGlb(glbUrl)`, then **auto-fit** and select the new object.
- Errors surface inline (like the existing `uploadError`/`bakeError` pattern).

### Auto-fit (new util in `app/lib/scene3d/`)

Generated GLBs arrive at arbitrary scale/pivot. Add `fitLoadedGlb(group): void` (or return a
`{ position, scale }` the `GlbObject` carries) that:
- computes the group's world bounding box,
- recenters it on the origin (x/z centered, base ~on the ground plane y=0),
- uniformly scales so the largest dimension ≈ **1.5 units** (comparable to the primitives).

Applied on insert of a *generated* GLB (keep manual "Upload GLB" behaviour unless we choose to
normalize those too). Cleanest: normalize in `loadGlb` behind an opt-in, or a `fitGlbGroup`
helper called from the generate flow before the object's transform is set.

## Persistence & cost

- The `GlbObject.url` stores the fal GLB CDN URL; it serializes into `scene_state` and reloads
  via `loadGlb`. (If durability of fal URLs is a concern, a follow-up can re-host to app
  storage via `uploadToFalStorage`; not needed for v1.)
- Cost per shape ≈ FLUX image (~$0.025) + Hunyuan3D v2 white ($0.16) / textured ($0.48). The
  **review step avoids paying for 3D on a bad image**.

## Testing

- **Unit (pure logic, no network):** the model adapter — `buildInput`/`glbUrlFrom` for each
  model (correct app id, image field, textured flag, output path); the prompt-shaping suffix;
  `firstFalImageUrl` usage. Mock `runFal` to assert routes call the right app with the right
  input and surface errors as 4xx/5xx.
- **Unit:** `fitGlbGroup` — a mesh at arbitrary scale/offset is recentered and scaled to ~1.5.
- **Live (paid, gated):** a *small number* of real fal generations to confirm end-to-end
  (image renders, 3D returns a GLB, it inserts and auto-fits). Confirm with the user before
  running many — each is ~$0.20.

## Out of scope (v1, easy follow-ups)

- Upload-your-own reference image (the "Both" flow).
- PBR/quad/multi-view advanced knobs beyond the Textured toggle.
- Re-hosting GLBs to app storage; a generation history/gallery.
- Replicate as an alternate provider (helpers exist; fal is the v1 path).
