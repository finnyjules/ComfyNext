# 3D Studio — physical surface properties

**Date:** 2026-07-17
**Status:** approved (brainstorm with Julien)
**Scope:** upgrade the Standard material to a full physical surface (clearcoat,
sheen, glow, transparency/refraction, iridescence, reflection intensity) with a
grouped Selection panel; Glass becomes the same engine with transparency-focused
defaults. Frontend-only; no backend change.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Where do the new properties live? | `standard` upgrades to a MeshPhysicalMaterial-backed "physical surface"; `glass` shares the same code path (a preset with transparency-leaning defaults). Stylized types (toon/matcap/fresnel/gradient/image) unchanged. |
| Back-compat | All new fields optional with defaults that render IDENTICALLY to today's standard look (clearcoat 0, sheen 0, iridescence 0, transmission 0, opacity 1, envMapIntensity 1). Old scenes byte-identical behaviour. |
| Deferred | Anisotropy (needs tangents), specular tint, per-material flat-shading toggle. |

## Model — `frontend/app/lib/scene3d/config.ts`

New optional `SceneMaterial` fields (validated in `parseMaterial` with the
existing present-and-valid pattern; absent stays absent):

```ts
  // coat & sheen
  clearcoat?: number            // 0–1, default 0
  clearcoatRoughness?: number   // 0–1, default 0.1
  sheen?: number                // 0–1, default 0
  sheenColor?: string           // default '#ffffff'
  // glow
  emissive?: string             // default '#000000' (off)
  emissiveIntensity?: number    // 0–5, default 1
  // transparency & refraction (transmission group already exists for glass —
  // now available on standard too)
  opacity?: number              // 0–1, default 1 (alpha translucency, no refraction)
  dispersion?: number           // 0–5, default 0 (chromatic aberration in transmission)
  attenuationColor?: string     // default '#ffffff'
  attenuationDistance?: number  // 0 = off (maps to Infinity), else 0.05–10, default 0
  // iridescence
  iridescence?: number          // 0–1, default 0
  iridescenceIOR?: number       // 1–2.33, default 1.3
  // reflection
  envMapIntensity?: number      // 0–3, default 1
```

(`transmission`/`ior`/`thickness` already exist.) All defaults live in
`MATERIAL_DEFAULTS` — single source for factory and UI proxies, as before.

## Factory — `frontend/app/lib/scene3d/materials.ts`

- `standard` and `glass` both build **MeshPhysicalMaterial** through one shared
  builder (`physicalFor(mat)`); `glass` differs only in its fallback defaults
  (`transmission` 1 etc. — unchanged). With all-default params the physical
  material must render indistinguishably from today's MeshStandardMaterial.
- `updateMaterial` for both types updates every param in place. **Define-gated
  params need a recompile when they cross zero** (three only compiles the
  relevant shader branches when `transmission`, `clearcoat`, `sheen`,
  `iridescence`, `dispersion` > 0, and `transparent` toggles with opacity < 1):
  compare old→new and set `material.needsUpdate = true` only on those
  boundary crossings (never on plain slider movement — per-tick recompiles
  jank).
- `attenuationDistance` 0 maps to `Infinity` (three's "off").
- identityKey unchanged for both (everything is in-place updatable).

## UI — `Scene3DStudioSurface.vue` Selection section

For `standard` and `glass`, replace the flat slider list with grouped
sub-sections (native `<details>` styled like the existing section labels;
"Surface" open by default, the rest closed — closed groups keep the panel
compact):

- **Surface** (open): Color, Roughness, Metalness
- **Coat & sheen**: Clearcoat, Coat roughness, Sheen, Sheen colour
- **Glow**: Emissive colour, Intensity (0–5)
- **Transparency**: Opacity (0–1), Transmission (0–1), IOR (1–2.33),
  Thickness (0–2), Dispersion (0–5), Attenuation colour, Attenuation distance
  (0–10, 0 = off)
- **Iridescence**: Amount (0–1), IOR (1–2.33)
- **Reflection**: Intensity (0–3)

Glass shows the same groups (its transmission defaults differ). Param proxies
via the existing `matParam` helper + MATERIAL_DEFAULTS fallbacks.

## Error handling

Nothing new — all synchronous numeric/colour params with tolerant parsing.

## Testing

- Unit (config): round-trip a doc with every new field set; absent-stays-absent
  unchanged.
- Unit (materials): `standard` now maps to `MeshPhysicalMaterial` (update the
  class test); in-place updates for representative params of each group;
  `needsUpdate`/version bumps exactly on define-boundary crossings
  (e.g. transmission 0→0.5 bumps, 0.5→0.7 does not); attenuationDistance 0 →
  Infinity mapping.
- Browser (dev-lab, real interactions): each group visibly changes the render
  (clearcoat highlight, sheen edge glow, emissive glow, opacity ghosting,
  dispersion rainbow edge on a glass sphere, iridescent film, reflection
  intensity); slider dragging stays smooth (no per-tick recompile jank);
  save/reopen restores; Export bake matches viewport; depth/normal passes
  unaffected.
- Gates: scene3d vitest green; `vue-tsc | grep -i scene3d` clean.

## Out of scope

Anisotropy, specular tint/intensity, flat-shading toggle, texture-mapped
variants of these properties (all phase 3+ candidates), Spline layer stacking.
