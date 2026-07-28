# Scene3D — surface relief (bump)

**Date:** 2026-07-27
**Status:** Design approved, planning

## Problem / goal

Scene3D materials are perfectly flat. `SceneMaterial` (`app/lib/scene3d/config.ts:37-91`) carries
~30 fields — clearcoat, sheen, iridescence, dispersion, transmission — and **exactly one texture
slot: `map`**. A brick image on a cube reads as a sticker: it does not react to light, and there
is no way to express a rough, dented, woven, or hammered surface.

Goal: give any Scene3D material believable surface relief, from several sources, for **in-Sailor
rendering only**. Exportable PBR texture sets are explicitly out of scope (decided in design).

## The core decision: one height seam, bump not normal

Everything routes through a single abstraction: **a grayscale height canvas/texture**, bound to
THREE's `.bumpMap` + `bumpScale`.

THREE's `bumpMap` derives the perturbed normal **in the fragment shader** from a grayscale input.
That means there is **no derivation code to write** — no Sobel pass, no normalization, no tangent
handling — and the derivation happens at full screen resolution rather than baked into a
fixed-resolution texture.

Bump is the correct target here on merit, not as a compromise:

- Every natural producer in this system emits a **scalar** field.
- A normal map is a **unit-length vector field**. Diffusion models cannot honour that constraint
  (vectors drift off-unit; low-frequency hue bias reads as a warped surface). Image models are
  good at height/depth and bad at normals.
- Verified on **three@0.171.0**: `bumpMap` and `normalMap` are supported on `MeshStandardMaterial`,
  `MeshToonMaterial`, `MeshMatcapMaterial`; `MeshPhysicalMaterial` inherits from Standard.
  `MeshBasicMaterial` has neither.

A separate `normalImage` slot exists as an escape hatch for a **real** baked tangent-space normal
map (from Blender or a game asset). It must bind to `.normalMap`, not `.bumpMap` — routing a
normal map through the bump path misreads the blue channel as height.

## Producers

Three, not four. "Hand-authored relief knobs" is **not** a separate producer — it collapses into
a shader effect (noise / ridged / billowed with controls), costing one `.frag` + one manifest
entry and inheriting the whole control-schema → agent → motion chain.

| # | Source | How the height canvas is produced |
|---|---|---|
| 1 | Shader field | `resolveField()` from `app/lib/shaderfill/field.ts` in height mode |
| 2 | Uploaded / existing image | image → height (see below) |
| 3 | AI prompt | prompt → colour tile → height (see below) |

**Producers 2 and 3 share their second half.** The image→height step is one component serving both.

### What `relief.image` always stores

`relief.image` is **always a grayscale height map**. Conversion happens once at authoring time,
never at render time — the render path stays dumb and fast, and nothing paid runs per frame.

When a user uploads a colour photo, offer two conversions:

- **Brightness** (default) — local, free, instant. A crude heuristic: dark paint reads as a dent.
  Good enough surprisingly often, and it is the right default because it costs nothing.
- **Refine with depth** — the paid server call. Same depth stage as producer 3. Genuine height,
  immune to baked-in lighting.

If the user uploads an image that is *already* a height map, both conversions are wrong — so the
Brightness conversion is a no-op on an already-grayscale image, and the UI offers a plain
**Use as-is** option.

## Architecture

### Doc model (`app/lib/scene3d/config.ts`)

Two new optional fields on `SceneMaterial`:

```ts
relief?: {
  source: 'none' | 'shader' | 'image'
  spec?: ShaderSpec      // when source === 'shader'
  image?: string         // when source === 'image'; filename in the ComfyUI input dir
  scale: number          // → bumpScale; default 0.25
  invert?: boolean
}
normalImage?: string     // a REAL tangent-space normal map → .normalMap
```

Both are optional so existing serialized scenes load unchanged. `relief.scale` defaults to
**0.25** — `bumpScale: 1` is already extreme, and a too-strong default reads to users as "this
feature is bad" rather than "this slider is too high".

### Material factory (`app/lib/scene3d/materials.ts`)

`materialFor` gains a relief step applied **after** the existing per-type construction, so it
composes with every material type rather than being special-cased per type:

- `relief.source === 'shader'` → `resolveField()` canvas → `CanvasTexture` → `.bumpMap`
- `relief.source === 'image'` → loaded texture (same `getImageTexture` path as `map`) → `.bumpMap`
- `normalImage` set → loaded texture → `.normalMap`
- `.bumpScale = relief.scale`; `invert` flips via a one-line canvas/texture transform
- **Skip entirely when the constructed material is `MeshBasicMaterial`** (the `unlit` shaderFill
  case, `materials.ts:470-472`) — it has no bump slot.

Animated shader relief re-points through the existing `refreshSceneShaderFields()`
(`materials.ts:633-673`), same as `.map` does today.

### Server route

**`POST /api/scene3d/gen-map`** — prompt → grayscale height tile.

Mirrors the existing `server/api/scene3d/gen-image.post.ts` almost exactly. `/api/scene3d` is
already in `NITRO_API_PREFIXES` (`server/middleware/comfyui-proxy.ts:27`) — **no allowlist change
needed**.

Two stages, both via the existing `runFal` / `firstFalImageUrl` helpers (`server/utils/falRun.ts`):

1. **Colour tile** — a text-to-image call with a prompt shaped for a flat, evenly lit, top-down
   material sample (same shaping pattern as `shapeImagePrompt` in `server/utils/scene3dGen.ts`).
2. **Depth** — a monocular depth model on that image, returning a grayscale map.

Why two calls rather than prompting for a grayscale height map directly: image models bake
lighting into their output. A brick photo's mortar grooves are dark because they are *in shadow*.
Desaturating that makes every shadow a fake dent, which the renderer then lights and shadows
again — muddy, over-crunchy surfaces. Depth models are trained to ignore lighting and report
actual distance, so the result is genuine height.

Body: `{ prompt: string, seed?: number }`. Returns `{ imageUrl, heightUrl, seed }` — the colour
tile is returned too so the UI can offer it as the albedo `map` in the same action.

> **Model ids and input field names MUST be schema-checked against fal's live schema at build
> time, not assumed.** A wrong fal field returns 200 at submit and only fails at result, which
> then falls over to a Replicate cold boot — the failure is silent and expensive to diagnose.
> Do the free schema check first, then a single zero-cost probe.

### Client persistence

Same path as the existing manual texture upload (`Scene3DStudioSurface.vue:450-489`):
`inpaint.uploadDataUrl(dataUrl, nameHint)` → filename → `material.relief.image` → serialized by
`setWidget('scene_state', serializeDoc(doc))`.

### UI (`Scene3DStudioSurface.vue`)

A **Surface** section in the material panel. Four controls, everything else conditional:

```
Surface
  Relief    [ None | Effect | Image ]
  ├ Effect → shader effect picker (reuse ShaderFillEditor)
  └ Image  → thumbnail  [Upload] [Generate…]
              ( ) this image is already a normal map
  Depth     ──────●────────  0.25
  Invert    ( )
```

- **Invert** is not optional polish — roughly half of all height maps in the wild use the
  opposite convention, and without it users conclude the feature is broken.
- **"already a normal map"** appears only once an image is chosen; ticking it routes to
  `normalImage` and disables Invert. This is the only place the bump/normal distinction reaches
  the user.
- **Generate** is an explicit button, never automatic on parameter change (it costs money and
  takes seconds).
- The whole section is **disabled with an explanatory tooltip** when `unlit` is set — never a
  silent no-op.

Section structure must match the panel's existing section conventions (read them before building;
the layout above is derived from the material model, not from the panel).

## Known risks

1. **Animated relief roughly doubles field cost.** A shader field driving both `.map` and
   `.bumpMap` resolves twice per frame per material. `LIVE_FIELD_CEILING = 4`
   (`app/lib/shaderfill/descriptor.ts:14`) effectively becomes 2. Mitigation if it bites: emit
   colour and height from a single field pass.
2. **`gradient` and `fresnel` inject shader code via `onBeforeCompile`** (`materials.ts:364`,
   `:407`) near the normal fragment — exactly where bump support could break. **Spike this early,
   not last.**
3. **Naming collision.** `passes.ts:54` already emits a `normal` pass — a screen-space G-buffer
   for ControlNet, unrelated to a tangent-space material normal map. Use "relief" in all UI
   copy; never call this feature's output a "normal pass".
4. **Tiling.** Scene3D has no UV `repeat`/`offset`/`wrap` authoring at all, so a texture stretches
   once across an object and seams do not yet bite. Generated tiles will show seams the moment
   tiling is added. Out of scope here; do not forget.

## Testing

- **Unit (pure, no network):** relief resolution — given a `SceneMaterial`, which slot gets set
  (`bumpMap` vs `normalMap` vs neither), with the right `bumpScale`. Explicitly assert the
  `MeshBasicMaterial`/`unlit` case sets **nothing**.
- **Unit:** the `gen-map` route with `runFal` mocked — correct app ids, correct input fields,
  both stages called in order, errors surfaced as 4xx/5xx.
- **Unit:** invert produces an inverted height sampling.
- **Runtime (required, not optional):** verify in the real app with a **deliberately broken
  control** — set `scale` to an extreme value and confirm the render visibly changes. "I looked
  and it rendered" is not evidence that the bump path ran; a graceful fallback to a flat surface
  looks identical to success.
- **Runtime:** confirm bump actually applies on `gradient` and `fresnel` materials (risk 2).
- **Live (paid, gated):** a small number of real `gen-map` calls. Confirm with the user first.

## Build order

1. Doc model + material factory + unit tests — unlocks nothing user-visible yet
2. UI section with Upload + Depth + Invert — **manual and shader relief now fully usable**
3. Shader-field height mode
4. `gen-map` route + Generate button — the AI source, last

Steps 1–3 work offline, instantly, at zero per-use cost. Step 4 is the smallest slice of the
value and is deliberately deferred.

## Out of scope

- Exportable PBR texture sets (albedo/normal/roughness files for Blender/Unreal/Unity).
- UV repeat / offset / rotation controls and seamless tiling.
- `roughnessMap`, `metalnessMap`, `aoMap`, `displacementMap`, real vertex displacement.
- Wiring an IMAGE input port into the Scene3D node (it has only `glb_url` today).
- TextureStudio → Scene3D wiring (the edge is drawable but inert; unrelated fix).
