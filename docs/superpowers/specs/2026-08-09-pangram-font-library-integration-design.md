# Pangram / Off-Type Font Library Integration

**Date:** 2026-08-09
**Status:** Design — approved, pre-plan

## Plain-language summary

Julien has a large collection of licensed desktop fonts on disk — the full **Pangram Pangram Foundry** library (65 families) plus a second foundry, **Off-Type** (~21 families) — sitting in `Assets/Fonts/`. Today Sailor only knows about a couple of hand-wired local fonts (PP Neue Montreal) and Google Fonts. This feature makes the entire on-disk library selectable across every font surface in Sailor (Space Type, Scene3D text, templates, Compositor, motion), without hand-wiring 1,300 files and without bloating the git repo.

The mechanism: a **generator script** reads every OTF, extracts its real name/weight/italic from the font's own metadata, and writes a **committed manifest** (foundry → family → faces). The raw OTF files stay in `Assets/Fonts/` (gitignored) and are streamed on demand by a small server route. A single shared catalog module feeds both of Sailor's font "worlds" from that one manifest.

## Decisions locked

- **Scope:** all families in `Assets/Fonts/` — both `PPF Fonts - v7.72/` (Pangram, 65 families) and `Off Set v1.8/` (Off-Type, ~21 families).
- **Format:** OTF only. TTF/WOFF/WOFF2/EOT in the bundles are ignored.
- **Storage (git):** files stay in `Assets/Fonts/` (newly gitignored); **only the manifest is committed**. Served via a Nitro route. No 200 MB copy, no git-history bloat. (Approach A.)
- **Selection UX:** picker lists **families**; weight is chosen via the existing weight control — the same family+weight model Google Fonts already uses across the app. Every face remains reachable.
- **Picker layout:** top-level **tabs by source**. Main/widget pickers: **Google | Pangram** (Off-Type as a labeled section inside the Pangram tab). Template picker adds a third **Brand** tab for uploaded fonts.

## Background: the two font worlds (already in the codebase)

Sailor has two parallel font-rendering paths, and this feature must serve both:

1. **CSS/DOM world** — templates, Compositor, motion text. Renders via browser `@font-face`. Font value is a bare **family name** string (`fontFamily`). Fonts registered on demand by composables (`useUploadedFonts.ensure()`, `useGoogleFontPreview.ensure()`).
2. **Outline/3D world** — Space Type, Scene3D text. Parses the font binary with the opentype build vendored inside three.js. Font value is either a local path (`/fonts/X.otf`) or a `google:Family@Weight` token, resolved to a URL by `fontSourceUrl()` in `app/lib/scene3d/outlines.ts`, then fetched + parsed by `loadFont()`.

The existing **uploaded brand-font** system (`useUploadedFonts` + `server/templates/fonts*` + `server/api/template-fonts/file/[name].get.ts`) already demonstrates the "manifest + file-serving route" pattern — but it is wired only into the CSS/DOM world. This feature generalizes that pattern to a build-generated library and wires it into **both** worlds.

## Architecture

```
Assets/Fonts/                         (gitignored source of truth, ~200MB OTF)
  ├─ PPF Fonts - v7.72/<Family>/[otf/]*.otf     → foundry "Pangram"
  └─ Off Set v1.8/Fonts/OT <Name>/[OTF/]*.otf   → foundry "Off-Type"
        │
        │  (build step, run on demand / when fonts change)
        ▼
scripts/build-font-library.mjs        (fontkit parse → group → slug)
        │
        ▼
app/data/library-fonts.manifest.json  (COMMITTED — the only artifact in git)
        │
        ├──────────────► app/data/library-fonts.ts   (shared catalog module)
        │                     │
        │        ┌────────────┴─────────────┐
        │        ▼                            ▼
        │   CSS/DOM world               Outline/3D world
        │   useLibraryFonts             fontSourceUrl(`local:Fam@W`)
        │   (@font-face inject)         (resolve → route URL → opentype)
        │        │                            │
        │        └──────────┬─────────────────┘
        ▼                   ▼
server/api/library-font/[id].get.ts   (streams the OTF from Assets/Fonts/)
```

### Component 1 — Generator script (`frontend/scripts/build-font-library.mjs`)

**Purpose:** turn the messy on-disk bundles into one clean, deterministic manifest.

- Recursively scan a configured root (default the repo's `Assets/Fonts/`) for `*.otf`, ignoring all other extensions.
- Assign **foundry** by top bundle: paths under `PPF Fonts - v7.72/` → `pangram`; under `Off Set v1.8/` → `off-type`.
- Parse each OTF with **fontkit** (already a dependency). Read from the font's own name table — never trust folder/file names (they contain `- NEWLY ADDED`, combining-diacritic garble like `Ra╠êder`, and inconsistent casing):
  - **family** — typographic/preferred family (name ID 16) with fallback to family (ID 1).
  - **weight** — `OS/2.usWeightClass` (100–900), plus a human label (Thin…Black).
  - **italic** — macStyle italic bit OR non-zero italic angle OR subfamily contains "Italic".
  - **style** — subfamily string (e.g. "Book Italic").
  - **postscriptName** — used to build a stable face id.
- **Face id:** stable, filesystem-safe slug derived from foundry + PostScript name (e.g. `pangram-ppeditorialnew-heavyitalic`). Ids are the manifest key and the route key. Stable across regenerations so saved documents keep resolving. (See [[list-addressing-stable-ids]].)
- **Dedup:** prefer an `otf/` (or `OTF/`) subdir when a family has one; otherwise flat `.otf` in the family dir. Dedup faces by PostScript name.
- **Store the source path** relative to the fonts root (so the manifest is machine-independent; the route resolves it against the configured root at runtime).
- **No silent drops:** log every OTF that fails to parse or is skipped, with a summary count at the end. (See [[partial-control-passes-falsely]] — surfacing what was dropped, not silently truncating.)
- Idempotent: safe to re-run whenever fonts are added/updated.

### Component 2 — Manifest (`frontend/app/data/library-fonts.manifest.json`, committed)

```jsonc
{
  "generatedAt": "<ISO>",          // stamped by the caller, not Date.now() inside logic
  "fontsRoot": "Assets/Fonts",     // relative to repo root
  "foundries": [
    { "id": "pangram",  "label": "Pangram" },
    { "id": "off-type", "label": "Off-Type" }
  ],
  "families": [
    {
      "id": "pangram-editorial-new",
      "family": "PP Editorial New",
      "foundry": "pangram",
      "faces": [
        {
          "id": "pangram-ppeditorialnew-regular",
          "weight": 400, "weightLabel": "Regular", "italic": false,
          "style": "Regular",
          "postscriptName": "PPEditorialNew-Regular",
          "src": "PPF Fonts - v7.72/Editorial New/PPEditorialNew-Regular.otf"
        }
        // …
      ]
    }
    // …
  ]
}
```

Invariants (asserted by tests): unique family ids, unique face ids, every `src` resolves to an existing file at generation time, every face has a weight in 100–900.

### Component 3 — Font-serving route (`frontend/server/api/library-font/[id].get.ts`)

- Look up `id` in the manifest → face `src`.
- Resolve `src` against the configured fonts root (default `<repo>/Assets/Fonts`, overridable by env for other machines). **Reject** any resolved path that escapes the root (path-traversal guard) — mirrors `template-fonts/file/[name].get.ts`.
- Stream the file with `Content-Type: font/otf` and long-lived cache headers (ids are content-stable).
- 404 for unknown id.

Catalog data itself needs **no** route — the manifest is a committed JSON the client imports directly (network-free, so it can also travel into the network-free resolver path). Only the font *binaries* go through the route.

### Component 4 — Shared catalog module (`frontend/app/data/library-fonts.ts`)

The single consumer-facing surface over the manifest (one declaration, many consumers — cf. [[studio-param-declaration-cost]]):

- `LIBRARY_FAMILIES` / `librariesByFoundry()` — grouped lists for pickers.
- `libraryFontUrl(faceId): string` → `/api/library-font/<id>`.
- `resolveLibraryFace(family, weight, italic?)` → nearest face (nearest-weight fallback, like Google's `nearestWeight`).
- Token helpers for the outline world: `parseLibraryFontValue('local:Family@700')` and its inverse.
- Registers library families into the existing `setFontCatalog` / `resolveFontFamily` machinery so bare family-name resolution works app-wide.

### Component 5 — CSS/DOM world wiring (`frontend/app/composables/useLibraryFonts.ts`)

- `ensure(family, weight?, italic?)` injects an `@font-face` (`<style data-library-font>`) with `src: url(/api/library-font/<id>) format('opentype')`, resolving the face via the catalog. Mirrors `useUploadedFonts.ensure()`.
- Called by pickers on select, and on document load to register faces already referenced by saved layers/clips.

### Component 6 — Outline/3D world wiring (`frontend/app/lib/scene3d/outlines.ts`)

- Extend `fontSourceUrl(value)` to recognize a **`local:Family@Weight`** token → resolve via the catalog to `libraryFontUrl(faceId)`. Sits beside the existing `google:` and raw-path branches. Unknown/unresolvable tokens degrade gracefully (fall back to default font, logged), never throw.
- Extend `fontDisplayName()` and add `parseLibraryFontValue()` so Space Type / Scene3D show the right label and round-trip the token.
- Add library families to the outline-world picker source.

### Component 7 — Picker integration (the three `FontPicker.vue`s)

The pickers move to **top-level tabs by source** instead of one long grouped list. A shared helper (`libraryFontGroups()`) provides the foundry-grouped entries each tab renders; each picker adapts to its own selection-key format.

**Tab structure:**

- **Google tab** — the existing Google Fonts catalog + AI "describe-a-font" suggest, unchanged.
- **Pangram tab** — the whole local library. Pangram families first, then a labeled **Off-Type** section beneath them. (Off-Type is folded into this tab, not given its own tab.)
- **Brand tab** — *template picker only* — the uploaded/brand fonts (`useUploadedFonts`), given their own tab rather than merged into the library list.

Search is **per active tab** (each tab filters its own source). The remembered/active tab defaults to whichever source the current value belongs to, so opening the picker on a Pangram font lands on the Pangram tab.

Per-picker:

- `app/components/vue-canvas/FontPicker.vue` — the primary picker. Two tabs (Google | Pangram). Emits a new `library` select kind; callers map it to a `local:` token (outline consumers) or a family name (CSS consumers). Existing `pinned`/"Sailor" strip is preserved above the tab body if present.
- `app/components/vue-canvas/widgets/FontPicker.vue` — Google | Pangram tabs; adds a `lib:<family>` source alongside `var:`/`goog:`.
- `app/components/templates/FontPicker.vue` — three tabs (Google | Pangram | Brand). Replaces the current single merged `ALL_FONTS` list; the curated `TEMPLATE_FONTS` fold into the Google tab's pinned area (or a small "Curated" group there).

Optional nicety (kept light): render each family's name in its own face in the CSS-world pickers once `ensure()`d.

## Known overlaps / edge cases

- **Neue Montreal / Mori already exist** as hand-wired local fonts (`public/fonts/NeueMontreal/`, `AVAILABLE_FONTS`) and as separate `Assets/Mori` + `Assets/NeueMontreal` copies. The generator scans **only `Assets/Fonts/`**, so these families also appear via the library (from the PPF bundle). The pre-existing entries stay for backward-compatibility with saved documents; some duplicate listing is accepted for v1 and can be de-duped later. The generator does **not** scan `Assets/Mori`, `Assets/NeueMontreal`, or `public/fonts/`.
- **Duplicate family names across foundries** (e.g. PPF "Neue Montreal" vs Off-Type "Neue Montreal Squeezed") — disambiguated by foundry id in the face id and the foundry header in the picker.
- **Single-face families** (e.g. Casa = 1 face) — supported; weight control simply has one option.
- **Spaces / diacritics in source paths** — never exposed to the client; the route resolves by manifest id → stored relative path, then path-guards.

## Testing

Unit (vitest):

- **Generator** against a small fixture of real OTFs copied from the bundles: correct family/weight/italic extraction; `otf/`-subdir vs flat handling; foundry assignment; stable ids across two runs; skip-logging for a deliberately corrupt file.
- **Manifest invariants:** unique ids, weights in range, every `src` exists.
- **Catalog module:** foundry grouping; `libraryFontUrl`; `resolveLibraryFace` nearest-weight; `local:` token round-trip.
- **`fontSourceUrl`:** `local:Fam@700` → correct route URL; unknown token → graceful default (assert via a **deliberately-broken control**, per [[synthetic-pointer-events-prove-nothing]] / [[graceful-fallback-hides-integration-failure]] — a fallback that hides failure proves nothing).
- **Route resolver:** id → path; path-traversal rejection.

Live hand-check (local, no paid render): in the Browser pane, pick a Pangram family in **Space Type** (outline path) and in the **Compositor** (CSS path) and confirm the real face renders — verifying the actual path ran, not just that something rendered. Note: the Browser pane pauses rAF when hidden ([[browser-pane-hidden-raf-paused]]) and synthetic events prove nothing ([[synthetic-pointer-events-prove-nothing]]); drive real clicks and assert the loaded face.

## Out of scope (YAGNI)

- WOFF2 alongside OTF (revisit only if CSS-surface load size hurts).
- Variable-font axis wiring (these bundles ship static instances).
- Per-family preview images / specimen thumbnails.
- Any admin/CRUD UI to manage the library — it is generated from disk.
- Licensing/DRM on the served files (local-only tool).
- Deduping the legacy Neue Montreal / Mori entries.
