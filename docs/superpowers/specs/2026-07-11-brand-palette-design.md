# Brand Palette (named colors) — Design

**Date:** 2026-07-11
**Status:** Approved by user (pre-implementation)
**Builds on:** 2026-07-11-brand-management-design.md

## Summary

Replace the brand kit's six fixed color roles as the *editing model* with a
free-form **named palette** ("Viridian" → `#2A8C6E`), so users name their own
colors and agents can resolve natural-language references ("make the
background viridian") to brand-defined shades. Roles (background / foreground /
primary / secondary / accent / accent2) survive as **references into the
palette**, because templates and archetypes bind role tokens that must resolve
for any kit.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Role strategy | Palette is source of truth; roles are an optional mapping into it |
| Agent scope | Smart Layout + Compositor agents understand palette names |
| Roles UI | Palette grid on top; compact "Roles" row of six selects below |
| Approach | A — palette + role references by entry id |

## 1. Data model

`frontend/shared/brand/types.ts`:

```ts
export interface BrandPaletteEntry {
  id: string     // stable, e.g. crypto.randomUUID(); survives renames
  name: string   // user-chosen display name, e.g. "Deep Viridian"
  hex: string    // #RRGGBB
}

export interface BrandKit {
  // legacy flat role colors remain readable forever; new kits stop writing them
  primary?: string; secondary?: string; accent?: string; accent2?: string
  foreground?: string; background?: string
  palette?: BrandPaletteEntry[]
  roles?: Partial<Record<BrandColorKey, string>>   // value = palette entry id
  // fontDisplay / fontBody / logo / logos / assets unchanged
}
```

Roles reference entries **by id**, so renaming "viridian" never breaks a role
assignment.

## 2. Resolution (`shared/brand/resolve.ts`)

- `virtualPalette(kit)`: when `kit.palette` is absent/empty, derive one from
  the six legacy flat fields — entries named "Primary", "Secondary", "Accent",
  "Accent 2", "Foreground", "Background" with ids `legacy-<roleKey>` and
  implied role assignments. Legacy kits therefore need **no migration**; the
  first palette edit in the editor persists the derived palette.
- `effectiveBrand(...)` materializes the six role keys from `roles`→palette
  lookup (fallback: the legacy flat value), so every existing consumer — role
  tokens, archetypes, KV wire, `setBrand` — keeps working untouched. It also
  exposes `palette` (merged: later layers replace whole palette, no per-entry
  merge) and a token-ready `palette` scope.
- `paletteSlug(name)`: lowercase, non-alphanumerics → `_`, collapse repeats,
  trim — "Deep Viridian" → `deep_viridian`. Collisions after slugging: last
  entry wins (documented).
- Tokens: `{{ brand.palette.deep_viridian }}` rides the existing deep-path
  lookup — for kits with an **explicit** palette. Legacy (virtual) palettes do
  not expose palette tokens: that would break the pinned back-compat contract
  (`effectiveBrand` of a legacy kit equals its input exactly), and no surface
  offers palette tokens for un-migrated kits anyway. Role tokens
  (`{{ brand.primary }}`) unchanged and remain the rename-stable currency for
  templates.
- KV wire: `brandKitToKv` adds `palette.<slug>=<hex>` lines (after roles/fonts/
  logos). The Python SmartLayout node's flat first-`=` parse and the resolver's
  flat-first lookup already handle them. Role keys keep being emitted with
  their materialized values.

**Known edge (documented, accepted):** renaming a palette entry orphans
existing `{{ brand.palette.<old_slug> }}` bindings in authored content — they
resolve to nothing until rebound. Role tokens are immune.

## 3. Editor UI

- New `app/components/brand/PalettePanel.vue` (`BrandPalettePanel`) replaces
  KitPanel's fixed six-role color list:
  - **Palette grid**: one row per entry — color input (`@change`), name text
    input (`@change`), delete button; "Add color" appends a new entry with a
    default name ("Color N").
  - **Roles row**: six compact labeled selects (Background, Foreground,
    Primary, Secondary, Accent, Accent 2), options = palette entry names +
    "unset". One entry may hold several roles.
- Shared by the in-project popover (via KitPanel) and the Brand page, same as
  the logo-slots panel.
- Opening a legacy kit shows its derived virtual palette; the first edit
  persists `palette` + `roles` and clears the legacy flat fields it migrated.
- Deleting an entry that holds roles unsets those roles (visible immediately
  in the roles row). Whole-kit PUT on `@change`, never `@input`.

## 4. Agent integration (Smart Layout + Compositor)

- **Smart Layout** (`app/lib/agent/surfaces/smartLayout.ts`): the agent
  context already carries the effective brand — which now includes the named
  palette. Op hints for `setTextColor`, `setElementStyle`, `setBackground`
  gain: user color words may name brand palette entries; bind
  `{{ brand.palette.<slug> }}` (or use the hex). `setBrand` stays role-scoped;
  agent-driven palette editing is out of scope.
- **Compositor** (`app/lib/agent/surfaces/compositor.ts`): add the active
  kit's palette (name → hex) to the agent context so "fill it with viridian"
  resolves to the hex directly — compositor paints are literal values, no
  token system.

## 5. Swatch surfaces

- `FillControl.vue` Brand row: palette entries (tooltip = name), fallback to
  legacy role colors for un-migrated kits — via one shared helper
  `brandSwatches(kit): { name, hex }[]` in `shared/brand/resolve.ts`.
- `GridPropertyPanel.vue` / `GridEditorShell.vue` color-bind buttons: existing
  role-slot buttons keep working (roles still resolve); add palette entries
  that bind `{{ brand.palette.<slug> }}`.
- ProjectMenu / LibraryPopover / StudioPage mini-swatches: first three
  palette-or-derived entries via the same helper.
- `InpaintModal.vue` (consumes `BRAND_COLOR_KEYS`): switch to the shared
  helper; role semantics unchanged.

## 6. Edge cases

- Kit with `palette` but no `roles`: role tokens fall back to legacy flat
  fields, else template defaults. Nothing crashes; swatches still show.
- Empty palette + no legacy colors: all brand color affordances hidden
  (existing no-brand behavior).
- Duplicate names: allowed in UI; token slug collision → last wins.
- KV: palette entries with empty name or hex are skipped.

## 7. Testing

- Unit (`shared/brand`, `tests/unit`): virtual palette derivation; role
  materialization by id incl. rename stability; legacy fallback order;
  `paletteSlug` rules; KV `palette.<slug>=` emission + skip rules;
  deep-token resolution of `{{ brand.palette.x }}` flat and nested;
  `brandSwatches` helper (palette-first, legacy fallback).
- Live: create palette entries, name one "Viridian", assign background role,
  rename it, confirm the role survives; agent context contains the palette.

## Out of scope

- Agent-driven palette editing (add/rename entries by prompt).
- Retroactive rebinding of orphaned palette tokens on rename.
- Bridging into shape-studio/gradient palette generators.
- Canvas/texture agent surfaces.
