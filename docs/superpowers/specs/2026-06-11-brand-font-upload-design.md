# Licensed brand-font upload — design

Date: 2026-06-11
Status: approved

## Goal

Let a brand upload its own licensed font so Smart Layout templates render with it
— both for element font binding and brand-kit `fontDisplay`/`fontBody`. Smart
Layout already binds fonts via `{{ brand.* }}` tokens and the render endpoint
already fetches Google TTFs on demand (satori can't parse woff2). The missing
piece is making uploaded families known to the render loader and the font picker.

This work lives in the **brand-library module** (the app-wide brand assets:
`ProjectDoc.brandKitId`, `useBrandLibrary`, `app/components/brand/`). It was
deferred from the Smart Layout polish pass to avoid a parallel upload UI.

## Decisions

- **Upload/manage UI**: an app-wide "Brand fonts" section in the brand
  `LibraryPopover` (sibling to the kit list). Uploaded fonts are app-wide assets,
  like the kit library and the global render loader. The `FontPicker` only
  *lists + previews* uploaded families — no upload UI in the picker (avoids the
  duplicate the deferral warned about).
- **Weights**: per-weight (Regular 400 / Bold 700). A brand-new family's single
  upload is **mirrored to both 400 and 700** so it works immediately; uploading a
  real second weight replaces the mirror.

## Storage (app-wide, gitignored)

- Dir: `frontend/server/templates/fonts/user/`
- Files: `<family-slug>-<weight>.<ext>` (e.g. `acme-grotesk-400.ttf`)
- Manifest `index.json`: `UploadedFont[]` where
  `UploadedFont = { family: string; slug: string; weights: Record<'400'|'700', string> }`
  (`weights` values are filenames). Single source read by the list endpoint, the
  render loader, and the upload merge.
- `.gitignore`: `server/templates/fonts/user/`

## Pure helpers — `server/templates/fonts.ts` (unit-tested)

Thin HTTP/loader wrappers call these; the logic is pure and covered by vitest.

- `slugifyFamily(name): string` — `[a-z0-9-]`, trimmed, fallback `font`.
- `ACCEPTED_EXTS = ['.ttf', '.otf', '.woff']` (NOT `.woff2`).
- `sniffFontType(bytes): 'ttf' | 'otf' | 'woff' | 'woff2' | null` — magic bytes:
  `0x00010000`/`true`/`ttcf` → ttf, `OTTO` → otf, `wOFF` → woff, `wOF2` → woff2.
- `validateUpload({ ext, size, bytes }): { ok: true } | { ok: false, reason }` —
  ext ∈ accepted; size ≤ `MAX_FONT_BYTES` (2 MB); sniff ∈ {ttf,otf,woff} and not
  woff2 (guards a woff2 renamed `.ttf`, which would crash satori).
- `upsertManifest(manifest, { family, slug, weight, file }): UploadedFont[]` —
  add/replace the family's weight; on a brand-new family with one weight, mirror
  it to the other weight; when a real weight arrives, overwrite the mirror.
  De-dupes by slug; keeps a stable order.

## Endpoints — `server/api/template-fonts/` (mirror `brand-kits/`)

- `POST /api/template-fonts` — multipart: `font` (file), `family`, `weight`
  (`400`|`700`, default `400`). Read multipart via `readMultipartFormData`.
  `validateUpload` → 400 on reject. Write `<slug>-<weight>.<ext>`, `upsertManifest`,
  persist `index.json`. Returns `{ family, slug, weights }`.
- `GET /api/template-fonts` — `{ fonts: UploadedFont[] }` from the manifest
  (empty array if the dir is missing — fresh checkouts).
- `DELETE /api/template-fonts/[slug]` — remove the family's files + manifest entry.
- `GET /api/template-fonts/file/[name]` — stream a font file. `name` must appear in
  the manifest (no path traversal). Content-type by ext
  (`font/ttf`|`font/otf`|`font/woff`). Cached (`immutable`) for preview.

## Render loader — `render-template.post.ts`

- `loadUploadedFonts(): LoadedFont[]` — read the manifest, load each weight file
  from `user/`, cache bytes by `path+size` (cheap readdir each call; bytes cached).
- `loadFonts`: tiers become **curated → uploaded → Google**. Google is fetched
  only for families in neither curated nor uploaded; uploaded wins name
  collisions. Single-covers-both mirroring means both 400/700 register.

## Browser preview — `useUploadedFonts.ts`

- Module-scoped cache. `refresh()` fetches `GET /api/template-fonts`; `fonts` ref
  exposes the list; `upload(file, family, weight)` POSTs + refreshes; `remove(slug)`
  DELETEs + refreshes.
- `ensure(family)` injects an `@font-face` (a `<style>` rule per weight) pointing
  at `/api/template-fonts/file/<file>` so the browser renders real previews. Idempotent.

## FontPicker — `app/components/templates/FontPicker.vue`

- Fetch uploaded families (via `useUploadedFonts`), render an **"Uploaded"**
  section at the top (above Curated). Exclude uploaded names from the Google list.
  Eager-`ensure` preview faces like it already does for Google.

## Brand-kit wiring

`KitPanel` already binds `fontDisplay`/`fontBody` through `FontPicker`, so once the
picker lists uploads, brand fonts pick them up automatically. The render loader
resolves `{{ brand.fontDisplay }}` → uploaded family → disk face. End to end, no
KitPanel change required.

## Fonts manager UI — `app/components/brand/FontsPanel.vue`

A "Brand fonts" section embedded in `LibraryPopover` below the kit list: file
input + family name + weight select → `upload`; list families with their weights
and a delete button. Uses `useUploadedFonts`.

## Testing

- **Unit (vitest)**: `slugifyFamily`, `sniffFontType` (incl. woff2 rejection),
  `validateUpload` (accept/reject by ext, size, magic), `upsertManifest`
  (single-covers-both mirror, real-weight replaces mirror, slug de-dupe).
- **Live (dev server + curl)**: upload a real `.ttf` → `GET` lists it → render a
  template binding that family → output differs from the unknown-family fallback
  → file route serves it → `DELETE` removes it.
- **Build**: full `nuxt build` compiles the new SFCs + composable.

## Units / isolation

- `server/templates/fonts.ts` — pure helpers (tested).
- `server/api/template-fonts/*` — thin HTTP wrappers.
- `render-template.post.ts` — `loadUploadedFonts()` tier.
- `useUploadedFonts.ts` — client fetch/cache/@font-face.
- `FontPicker.vue` — "Uploaded" section.
- `FontsPanel.vue` + `LibraryPopover.vue` — manager UI.
