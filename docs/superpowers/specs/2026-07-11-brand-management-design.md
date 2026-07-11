# Brand Management — Design

**Date:** 2026-07-11
**Status:** Approved by user (pre-implementation)

## Summary

Promote Sailor's existing project-scoped brand-kit system into a first-class,
top-level Brand page, extend kits with structured logo slots and a free-form
asset collection, and wire brand values into Frame (the Compositor artboard),
which today has zero brand awareness. Smart Layout is already brand-integrated
and only gains asset quick-access and new logo tokens.

**Approach:** extend the existing system (types in `frontend/shared/brand/`,
`useBrandLibrary` composable, `/api/brand-kits` file store, `sailor:brand`
provide/inject). No new storage systems, no migration.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Assignment granularity | Per-project (keep `ProjectDoc.brandKitId`; canvases inherit) |
| Asset model | Structured logo slots + free-form asset collection per kit |
| Fonts | Stay app-wide (global upload pool); kits reference family names |
| Frame scope | Brand swatches in fill controls + brand section in image picker + brand font defaults for new text layers |
| Auto-fill semantics | Presets surface everywhere; new elements default to brand values; existing content never rewritten |
| Implementation approach | A — promote & extend existing kit system |

## 1. Data model

Extend `BrandKit` in `frontend/shared/brand/types.ts` with optional fields:

```ts
interface BrandLogoSlots {
  primary?: string   // /view?filename=…&type=input URL
  mark?: string
  wordmark?: string
  onDark?: string
}

interface BrandAsset {
  id: string
  name: string
  path: string       // /view?… URL
}

interface BrandKit {
  // existing: primary, secondary, accent, accent2, foreground, background,
  //           fontDisplay, fontBody, logo
  logos?: BrandLogoSlots
  assets?: BrandAsset[]
}
```

**Back-compat:** the legacy `logo: string` field remains. Resolution rule in
`frontend/shared/brand/resolve.ts`: effective primary logo is
`logos.primary ?? logo`. Existing kit JSON files load unchanged; new fields
are additive and optional.

**Tokens:** `frontend/shared/template-grid/tokens.ts` gains
`{{ brand.logo.primary }}`, `{{ brand.logo.mark }}`, `{{ brand.logo.wordmark }}`,
`{{ brand.logo.onDark }}`. Bare `{{ brand.logo }}` keeps resolving via the
fallback chain. `brandKitToKv` in `resolve.ts` serializes the new keys.

## 2. Persistence

- Kits: existing file store `frontend/server/brand-kits/*.json` via
  `/api/brand-kits` (GET / PUT / DELETE). The `assets` array is metadata only,
  so kit JSON stays small; whole-kit PUT on change remains acceptable.
- Files (logos, assets): existing `POST /upload/image` → ComfyUI input folder
  → referenced as `/view?filename=…&type=input` URLs — same pattern as the
  current single logo. Proxied by `server/middleware/comfyui-proxy.ts`,
  cached by `server/routes/view.get.ts`.
- Fonts: unchanged — global pool via `/api/template-fonts`,
  `useUploadedFonts.ts`. Kits store only `fontDisplay` / `fontBody` family
  names.

## 3. Top-level Brand page

- New tab type `brand` in `frontend/app/composables/useTabs.ts`.
- Sidebar entry "Brand" in `frontend/app/components/AppSidebar.vue`
  (`openTab({ type: 'brand' })`).
- Render branch in `frontend/app/layouts/default.vue`.
- Page layout:
  - **Left:** kit list — create, duplicate, rename, delete.
  - **Right:** editor for the selected kit, four sections:
    1. **Colors** — the six color roles (reuse `KitPanel` controls).
    2. **Fonts** — display/body pickers (`FontPicker`) + upload into the
       global pool (`FontsPanel`).
    3. **Logos** — four labeled slots (primary / mark / wordmark / on-dark),
       each with upload + clear.
    4. **Assets** — grid of brand images with upload, rename, delete.
- The existing `brand/LibraryPopover.vue` + `KitPanel.vue` internals are
  refactored into shared components used by both the in-project popover and
  the new page, so the two surfaces cannot drift.

## 4. Assignment & resolution

Unchanged: `ProjectDoc.brandKitId` (`frontend/app/lib/projectDoc.ts`),
resolved in `default.vue` and provided app-wide as `sailor:brand`
(`{ activeKit, activeKitId, setBrandKit }`). The ProjectMenu brand picker
gains a "Manage brands…" affordance that opens the brand tab.

The Brand page itself never assigns brands to projects; it only manages kits.

## 5. Frame integration (net-new wiring)

All three consume the existing `sailor:brand` inject inside
`ArtifactFrameNode.vue` / the compositor layer tools:

1. **Fill swatches** — `compositor/FillControl.vue` renders a "Brand" swatch
   row (the kit's six colors) above its generated palettes, wherever fills
   are picked (shape fill, text color, background).
2. **Image picker** — the image-layer picker gets a "Brand" section listing
   logo slots and assets; clicking one adds it to the artboard as an image
   layer.
3. **Text defaults** — newly created text layers default `fontFamily` to the
   kit's `fontDisplay` (Frame text layers have no heading/body distinction;
   `fontBody` remains reachable one click away in the picker). The font picker
   already surfaces uploaded families under a "brand" category.

When no brand is assigned, all three affordances are hidden — no empty
states, no placeholders.

## 6. Auto-fill semantics

- Brand values appear as one-click presets in pickers across surfaces.
- **New** elements (text layers, smart layouts) default to brand values.
- **Existing** content is never rewritten when a brand is assigned or
  switched. Smart Layout content bound via `{{ brand.* }}` tokens re-resolves
  naturally on render — that is existing behavior, not a retroactive rewrite.

## 7. Smart Layout

Already fully brand-integrated (token interpolation, `effectiveBrand` merge,
Run-time `brand` widget injection in `default.vue`). Additions only:

- Image element picker in `SmartLayoutEditorModal.vue` surfaces the brand
  assets/logos section.
- New logo-slot tokens resolve (see §1).

## 8. Edge cases

- **No brand assigned:** brand rows/sections hidden everywhere.
- **Assigned kit deleted:** resolves to null (existing behavior); surfaces
  degrade to the no-brand state.
- **Asset deleted from a kit:** no cascade — placed layers keep their
  `/view` URLs; underlying files remain in the ComfyUI input folder.
- **Duplicate kit:** copies color/font/logo/asset metadata; files are shared
  by URL (no file duplication).

## 9. Testing

- Unit (extend `frontend/tests/unit`):
  - `resolve.ts` back-compat: `logos.primary ?? logo` chain, `brandKitToKv`
    with and without new fields.
  - Token resolution for `{{ brand.logo.* }}` including bare-`logo` fallback.
- Manual verification via dev preview: Brand page CRUD, Frame swatch row /
  image picker / text defaults, Smart Layout asset picker, no-brand hidden
  states.

## Out of scope

- Per-canvas brand assignment (design keeps a clean path: a future
  `ProjectCanvas.brandKitId` overriding the project value inside the
  `sailor:brand` resolution — no schema conflict).
- Per-brand font file ownership.
- Bridging brand colors into shape-studio/gradient palette generators.
- Retroactive re-theming of existing content.
