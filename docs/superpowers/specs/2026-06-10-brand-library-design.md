# Project Brand Library

**Date:** 2026-06-10
**Status:** Approved direction, pending spec review
**Context:** Two features now want brand theming: Smart Layout v2 shipped a
per-template `BrandKit` (colors/fonts/logo bound via `{{ brand.* }}` tokens),
and Kinetic Slates Phase 2 (docs/superpowers/specs/2026-06-10-kinetic-slates-design.md)
needs the same roles to parameterize motion slate templates. Without
unification we'd grow two brand kits; this spec makes brand a project-level
concept both consume.

## Goal

One named-kit **brand library**, app-wide and server-persisted, with an
**active kit per workflow** chosen from the workflow menu (top-left canvas
picker dropdown — the workflow-scoped surface alongside canvases/versions).
Smart Layout templates and Kinetic Slates templates resolve the same brand
roles through the same token resolver. Entering a brand once themes
everything.

## What exists today (reused, not rebuilt)

- `BrandKit` interface + `BRAND_COLOR_KEYS` in `frontend/shared/template-grid/types.ts`
  (primary, secondary, accent, foreground, background, fontDisplay, fontBody, logo).
- Pure token resolution `resolveTokens(value, props, brand)` in
  `frontend/shared/template-grid/tokens.ts` — `{{ brand.<key> }}`, whole-string
  or interpolated. Zero grid coupling.
- Brand editing UI inline in `GridEditorShell.vue` (popover, color/hex fields,
  `TemplatesFontPicker`, logo URL) — Smart Layout-only today.
- Per-template storage: `TemplateV2.brand` as defaults, render-time override
  merged on top (`translate.ts`).

## Design

### Data model (`frontend/shared/brand/types.ts`)

- `BrandKit` moves here; `template-grid/types.ts` re-exports it (no Smart
  Layout call-site churn). One field added:
  `accent2?: string` — second gradient stop. Slate templates build the
  LIV-style accent→accent2 gradients from color roles; gradients themselves
  stay template-side so the kit remains flat, JSON-trivial, feature-agnostic.
- `interface BrandKitEntry { id: string; name: string; kit: BrandKit; updatedAt: string }`
  (id = slug; name user-facing, e.g. "LIV Golf 2025").

### Persistence

- **Library (app-wide):** `frontend/server/api/brand-kits/` — `GET /api/brand-kits`
  (list), `PUT /api/brand-kits/:id` (upsert), `DELETE /api/brand-kits/:id` —
  writing `server/brand-kits/{id}.json`, the exact file-based pattern the
  template endpoints use.
- **Active kit (per project):** `ProjectDoc.brandKitId?: string | null`
  (`frontend/app/lib/projectDoc.ts`). The top-left menu is the PROJECT menu
  and the ProjectDoc is already "the unit of persistence everywhere —
  sessionStorage, durable autosave, and named versions", so the active kit
  rides along and version snapshots capture it for free. All canvases of a
  project share one brand (the user's mental model: "this project is LIV
  Golf"). Unset ⇒ no active kit ⇒ all consumers behave exactly as today.
  (Supersedes the earlier `workflow.extra` idea — per-canvas brand wasn't the
  goal, and ProjectDoc needs no server-side changes.)

### Resolution (`frontend/shared/brand/resolve.ts`)

```ts
effectiveBrand(templateDefaults?: BrandKit, activeKit?: BrandKit, wired?: BrandKit): BrandKit
```

Merge order: **template defaults ← active workflow kit ← wired socket brand**
(graph stays the ultimate override). Merging strips `undefined`/empty-string
values at each level so a partial kit (say, colors only) inherits fonts from
the template defaults instead of erasing them. `resolveTokens` is unchanged —
only what's passed as its `brand` scope changes. Smart Layout's editor
(`useGridEditor`) and server render path (`translate.ts`) both adopt
`effectiveBrand`; with no active kit the output is byte-identical to today.

### UI

- **Workflow menu row (canonical home):** in the top-left workflow dropdown, a
  "Brand" row showing the active kit's name plus a 3-swatch mini preview
  (primary/accent/accent2), or "No brand kit" when unset. Clicking opens the
  library popover.
- **`BrandLibraryPopover.vue`:** kit picker (with swatch previews), set
  active / clear active for this workflow, New / Duplicate / Rename / Delete,
  and the field editor below for the selected kit.
- **`BrandKitPanel.vue`:** the field editor extracted from GridEditorShell's
  inline popover — 5 color fields + accent2, fontDisplay/fontBody via
  `TemplatesFontPicker`, logo as URL input **or** upload (reuses the existing
  `/upload/image` flow; stored as a string either way).
- **Secondary entry points:** GridEditorShell's existing brand button swaps to
  mount the shared popover (same spot, same icon); the Compositor modal and
  the future slate gallery mount it too. Point-of-use shortcuts, one editor.

### Consumers

- **Smart Layout:** unchanged authoring (`{{ brand.* }}` in templates /
  archetypes); resolution now sees the active kit between template defaults
  and wired overrides.
- **Kinetic Slates (Phase 2):** slate template definitions author against the
  same tokens — `color: '{{ brand.accent }}'`, gradient stops
  `['{{ brand.accent }}', '{{ brand.accent2 }}']`, `{{ brand.fontDisplay }}`,
  logo slots `{{ brand.logo }}`. The gallery resolves tokens via
  `resolveTokens` + `effectiveBrand` **at instantiation** and writes concrete
  values into the Frame's layers — a placed slate is a plain editable Frame
  with real colors. No live token indirection inside the motion engine;
  re-theming a placed slate = re-instantiate (a "re-apply brand" action is a
  later phase).

## Testing

- Unit: `effectiveBrand` merge order + undefined/empty stripping; accent2
  token resolution through `resolveTokens`; library CRUD round-trip against
  the file-backed endpoints (mirror the template endpoint tests if present,
  else cover the handler logic).
- Regression: Smart Layout resolution with NO active kit produces identical
  output to the pre-change path (pin with an existing template fixture).
- Manual: create kit → set active in the workflow menu → grid-editor archetype
  AND a slate fixture instantiation both pick up the colors; switch kits →
  both re-theme on next resolve; second workflow keeps its own active kit.

## Out of scope

- AI brand extraction (from a logo/URL/site) — later, design-level AI.
- Multiple logos / logo variants per kit; per-format overrides.
- Re-theming already-instantiated slates or already-placed Smart Layout text.
- Migrating existing per-template `brand` values into the library (they keep
  working as defaults under the merge).

## Risks

- **Partial-kit clobbering** is the subtle bug class — hence undefined/empty
  stripping in `effectiveBrand` and a dedicated test.
- **ProjectDoc round-trip:** `toProjectDoc` wraps legacy bare workflows —
  ensure `brandKitId` survives that wrapper and the autosave/version paths
  (it's a plain optional field on the doc, but pin it with a test).
- **GridEditorShell swap** must not regress Smart Layout's brand editing —
  the panel extraction is a refactor with identical fields plus accent2.
