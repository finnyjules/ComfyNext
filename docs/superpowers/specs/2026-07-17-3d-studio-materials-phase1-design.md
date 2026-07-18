# 3D Studio — material types, phase 1

**Date:** 2026-07-17
**Status:** approved (brainstorm with Julien)
**Scope:** six new material types for 3D Studio primitives — the "easy tier" of the
Spline material list — plus the type-picker UI. Frontend-only; no backend change.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Phase 1 types | standard (existing), toon, matcap, glass, fresnel, gradient, image |
| Layer stacking (Spline-style blend layers) | Out of scope — single type per object |
| Matcap textures | Runtime-generated (canvas radial-gradient set) — no bundled assets, no licensing |
| GLB objects | Keep their own imported materials; the material UI stays primitive-only |
| Phase 2 candidates (not now) | normal, rainbow/iridescence, noise, pattern, depth, video, outline, displace, AI texture |

## Model — `frontend/app/lib/scene3d/config.ts`

`SceneMaterial` grows a `type` plus optional per-type params (all with defaults;
`parseDoc` fills missing fields, so every existing scene loads unchanged as
`type: 'standard'`):

```ts
export type MaterialType = 'standard' | 'toon' | 'matcap' | 'glass' | 'fresnel' | 'gradient' | 'image'

export interface SceneMaterial {
  type: MaterialType        // NEW — default 'standard'
  color: string             // existing: base colour (standard/toon), tint (glass)
  roughness: number         // existing (standard/glass)
  metalness: number         // existing (standard)
  // toon
  toonSteps?: number        // 2–5, default 3
  // matcap
  matcap?: string           // id from the generated set, default 'chrome'
  // glass
  ior?: number              // 1.0–2.33, default 1.5
  transmission?: number     // 0–1, default 1
  thickness?: number        // 0–2, default 0.5
  // fresnel
  fresnelColor?: string     // rim colour, default '#8ab4ff'
  fresnelPower?: number     // 1–8, default 3 (base colour = `color`)
  // gradient
  gradientB?: string        // second stop, default '#1c2740' (first stop = `color`)
  gradientAxis?: 'x' | 'y' | 'z'  // object-space, default 'y'
  // image
  image?: string            // uploaded filename in ComfyUI's input dir ('' = none)
}
```

Canonical type order (picker order) exported as `MATERIAL_TYPES`. Unknown
`type` on parse → `'standard'` (never errors).

## Materials factory — new `frontend/app/lib/scene3d/materials.ts`

One module owns Three material creation/update/disposal; the engine stays lean.

- `materialFor(mat: SceneMaterial): THREE.Material` — builds by type:
  - standard → `MeshStandardMaterial` (color/roughness/metalness) — as today
  - toon → `MeshToonMaterial` + a `DataTexture` step ramp built from `toonSteps`
  - matcap → `MeshMatcapMaterial` with a texture from the generated set
  - glass → `MeshPhysicalMaterial` (`transmission`, `ior`, `thickness`,
    `roughness`, colour tint)
  - fresnel → small `ShaderMaterial`: `mix(color, fresnelColor, pow(1-|N·V|, fresnelPower))`
  - gradient → small `ShaderMaterial`: object-space `mix(color, gradientB, t)`
    along `gradientAxis`, normalised over the geometry's bounding range
  - image → `MeshStandardMaterial` with `map` loaded from
    `/view?filename=…&type=input` (`SRGBColorSpace`, cached per filename;
    no image yet → plain standard material)
- `updateMaterial(m, mat): boolean` — mutates params in place when the type is
  unchanged; returns false when a rebuild is needed (type changed, matcap id
  changed, image changed, toonSteps changed).
- `MATCAPS` — 5 runtime-generated matcaps (chrome, clay, pearl, gold, carbon)
  drawn once on a 256² canvas each (radial gradients + highlight), exported as
  `{ id, label, texture }`; textures created lazily and shared.
- `disposeMaterial(m)` — disposes the material and any textures it exclusively
  owns (image maps, per-material toon ramps). Shared matcap textures are
  module-lifetime singletons and are never disposed — 5 × 256² textures is
  negligible and they are reused across objects and editor sessions.

Flat-kind double-siding (`plane`, `ring`) applies to every type.

## Engine — `frontend/app/lib/scene3d/engine.ts`

`syncObject`'s primitive branch delegates to the factory:
- On create: `materialFor(obj.material)`.
- On sync: `updateMaterial(mesh.material, obj.material)`; on `false`, dispose the
  old material (not shared textures) and assign a fresh `materialFor(...)`.
- The root-level `sourceKey` mechanism is unchanged (geometry identity only).

Depth/normal bake passes are unaffected (override materials replace everything;
no displacement in phase 1, so geometry parity holds). Beauty needs no work —
same renderer, same scene.

## UI — `Scene3DStudioSurface.vue` Selection section (primitive-only, as today)

- **Type** — `StudioSelect` dropdown over `MATERIAL_TYPES` (labels: Standard,
  Toon, Matcap, Glass, Fresnel, Gradient, Image).
- Conditional controls per type (reusing StudioSlider/StudioColor/StudioSegmented):
  - standard: Color, Roughness, Metalness (unchanged)
  - toon: Color, Steps (2–5, step 1)
  - matcap: swatch row — one round button per generated matcap (32px canvas
    thumbnail of its texture), selected ring on the active one
  - glass: Color, Roughness (0–0.5), IOR (1.0–2.33), Transmission (0–1),
    Thickness (0–2)
  - fresnel: Color (base), Rim colour, Power (1–8)
  - gradient: Color (stop A), Color B, Axis (X/Y/Z segmented)
  - image: "Upload image" button → hidden `<input type=file accept="image/*">` →
    `useInpaint().uploadDataUrl` → filename into `material.image`; 48px preview
    thumbnail + filename once set; Roughness/Metalness sliders stay
- Transform fields (Position/Rotation/Scale) remain below, unchanged.

## Error handling

- Image texture load failure → keep the object rendered with the plain standard
  material and show a small red "texture failed" note under the upload control.
- Unknown matcap id in a loaded doc → fall back to the first matcap.
- All parse-level unknowns degrade to defaults (existing parseDoc philosophy).

## Testing

- Unit (`scene3d-config.unit.spec.ts`): round-trip a doc with one object per
  material type (every param set); old-doc migration (`material` without `type`
  parses as standard); unknown type degrades to standard.
- Unit (new `scene3d-materials.unit.spec.ts`, node-safe parts only): factory
  returns the right THREE class per type; `updateMaterial` returns false on
  type/matcap/image/toonSteps change and true otherwise. (Texture generation
  needs canvas — guard or skip in node env; class-mapping tests must not.)
- Browser (dev-lab): each type applies visibly; switching types back and forth
  leaks nothing obvious; bake beauty matches the viewport (same renderer);
  depth/normal passes unchanged by material type; reload restores every type
  from scene_state.
- Gates: scene3d vitest green; `npx vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope (phase 2+)

Layer stacking/blend modes; outline; displace; AI texture; video/noise/pattern/
depth/rainbow/normal types; per-image UV controls (repeat/offset); material
preview thumbnails in the type dropdown.
