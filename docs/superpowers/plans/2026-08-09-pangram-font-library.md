# Pangram / Off-Type Font Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Julien's entire on-disk licensed type collection — the full Pangram Pangram Foundry library plus the Off-Type foundry (~86 families, OTF) — selectable across every font surface in Sailor, without hand-wiring ~1,300 files or committing 200 MB to git.

**Architecture:** A Node generator parses every OTF in `Assets/Fonts/` with fontkit and writes one committed manifest (foundry → family → faces). The raw OTFs stay in `Assets/Fonts/` (gitignored) and are streamed by a Nitro route. A single shared catalog module feeds both font "worlds": `@font-face` injection for the CSS/DOM surfaces (templates, Compositor, motion) and a `local:Family@weight` token for the outline/3D surfaces (Space Type, Scene3D), resolved to the route URL via a registered resolver so `outlines.ts` stays dependency-light. The three font pickers gain source tabs (Google | Pangram, plus Brand in the template picker).

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript), Nitro server routes, fontkit 2.0.4 (already a dep, Node-side parsing), the three-vendored opentype build (client-side outline parsing), vitest (`*.unit.spec.ts`).

## Global Constraints

- **OTF only.** TTF/WOFF/WOFF2/EOT in the bundles are ignored everywhere.
- **Source of truth:** `Assets/Fonts/` at the repo root — `PPF Fonts - v7.72/` → foundry `pangram`; `Off Set v1.8/` → foundry `off-type`. The generator scans ONLY these two bundles (not `Assets/Mori`, `Assets/NeueMontreal`, or `public/fonts/`).
- **Git:** `Assets/Fonts/` is gitignored (add to the repo-root `.gitignore`). The manifest JSON is the ONLY generated artifact committed. Never commit the OTFs.
- **Font metadata is authoritative, not filenames.** Family = `name.records.preferredFamily.en` (fallback `familyName`); style = `name.records.preferredSubfamily.en` (fallback `subfamilyName`); weight = `OS/2.usWeightClass`; italic = `italicAngle !== 0 || /italic|oblique/i.test(style)`. (`familyName` alone is weight-split — "PP Editorial New Heavy" — and must NOT be used for grouping.)
- **Selection model:** picker lists families; weight chosen via the existing weight control (family + weight, like Google today).
- **Picker tabs:** main & widget pickers → `Google | Pangram` (Off-Type is a labeled section inside the Pangram tab). Template picker → `Google | Pangram | Brand`.
- **Naming (verbatim):** foundry ids `pangram` / `off-type`; foundry labels `Pangram` / `Off-Type`; outline token prefix `local:`; route `GET /api/library-font/<id>`; manifest at `frontend/app/data/library-fonts.manifest.json`; shared types at `frontend/shared/library-fonts.ts`.
- **Colour/UI:** action blue is the only accent; follow existing StudioButton/StudioSwitch and the picker's existing Tailwind classes. No new accent colours.
- **Commit hygiene:** main-direct commits, stage only the paths each task touches (`git add <explicit paths>`), never `git add -A`.

---

## File structure

- `frontend/shared/library-fonts.ts` — manifest TS types (imported by generator, route, catalog). **Create (Task 1).**
- `frontend/scripts/fontLibrary.mjs` — pure, testable helpers (foundry/slug/id/italic/grouping) + the fontkit adapter. **Create (Tasks 1–2).**
- `frontend/scripts/build-font-library.mjs` — CLI: walk tree → adapter → group → write manifest. **Create (Task 2).**
- `frontend/app/data/library-fonts.manifest.json` — committed generated manifest. **Create (Task 2).**
- `frontend/server/api/library-font/[id].get.ts` — streams an OTF by face id. **Create (Task 3).**
- `frontend/server/utils/libraryFontManifest.ts` — server-side manifest load + id→abs-path resolver. **Create (Task 3).**
- `frontend/app/data/library-fonts.ts` — shared client catalog (groups, url, resolveLibraryFace, token helpers, registration). **Create (Task 4).**
- `frontend/app/lib/font/resolveFamily.ts` — add a library-family registry alongside the Google catalog. **Modify (Task 4).**
- `frontend/app/lib/scene3d/outlines.ts` — add `local:` token parse + resolver hook in `fontSourceUrl`/`fontDisplayName`. **Modify (Task 5).**
- `frontend/app/lib/spacetype/effects/loft.ts` — `outlineFontValue` passthrough for `local:`. **Modify (Task 5).**
- `frontend/app/composables/useLibraryFonts.ts` — CSS `@font-face` injection. **Create (Task 6).**
- `frontend/app/components/vue-canvas/FontPicker.vue` — Google | Pangram tabs. **Modify (Task 7).**
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` + `Scene3DStudioSurface.vue` — handle the `library` select payload. **Modify (Task 8).**
- `frontend/app/components/vue-canvas/widgets/FontPicker.vue` + `CompositorModal.vue` — lib source + ensure. **Modify (Task 9).**
- `frontend/app/components/templates/FontPicker.vue` — Google | Pangram | Brand tabs. **Modify (Task 10).**
- Tests under `frontend/tests/unit/*.unit.spec.ts`.

---

### Task 1: Manifest types + pure generator helpers

**Files:**
- Create: `frontend/shared/library-fonts.ts`
- Create: `frontend/scripts/fontLibrary.mjs`
- Test: `frontend/tests/unit/font-library-helpers.unit.spec.ts`

**Interfaces:**
- Produces (types): `LibraryFace { id, weight, style, italic, postscriptName, src }`, `LibraryFamily { id, family, foundry, faces: LibraryFace[] }`, `LibraryFoundry { id, label }`, `LibraryManifest { generatedAt, fontsRoot, foundries, families }`.
- Produces (helpers from `fontLibrary.mjs`): `foundryFromRelPath(relPath) -> {id,label}|null`, `slug(s) -> string`, `familyId(foundryId, family) -> string`, `faceId(foundryId, postscriptName) -> string`, `isItalicFace(style, italicAngle) -> boolean`, `buildFamilies(records) -> LibraryFamily[]` where a record is `{ foundryId, foundryLabel, family, style, weight, italic, postscriptName, src }`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/font-library-helpers.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { foundryFromRelPath, slug, familyId, faceId, isItalicFace, buildFamilies } from '../../scripts/fontLibrary.mjs'

describe('foundryFromRelPath', () => {
  it('maps the two bundles, rejects anything else', () => {
    expect(foundryFromRelPath('PPF Fonts - v7.72/Editorial New/PPEditorialNew-Bold.otf')).toEqual({ id: 'pangram', label: 'Pangram' })
    expect(foundryFromRelPath('Off Set v1.8/Fonts/OT Rhapsody/OTF/OTRhapsody-Thin.otf')).toEqual({ id: 'off-type', label: 'Off-Type' })
    expect(foundryFromRelPath('Mori/PPMori-Book.otf')).toBeNull()
  })
})

describe('slug / ids', () => {
  it('lowercases and dashes, collapsing runs', () => {
    expect(slug('PP Editorial New')).toBe('pp-editorial-new')
    expect(slug('OT 2049')).toBe('ot-2049')
    expect(familyId('pangram', 'PP Editorial New')).toBe('pangram-pp-editorial-new')
    expect(faceId('pangram', 'PPEditorialNew-HeavyItalic')).toBe('pangram-ppeditorialnew-heavyitalic')
  })
})

describe('isItalicFace', () => {
  it('detects italic from angle or style text', () => {
    expect(isItalicFace('Heavy Italic', 0)).toBe(true)
    expect(isItalicFace('Book', -12)).toBe(true)
    expect(isItalicFace('Regular', 0)).toBe(false)
  })
})

describe('buildFamilies', () => {
  const rec = (over) => ({ foundryId: 'pangram', foundryLabel: 'Pangram', family: 'PP Editorial New', style: 'Regular', weight: 400, italic: false, postscriptName: 'PPEditorialNew-Regular', src: 'PPF Fonts - v7.72/Editorial New/PPEditorialNew-Regular.otf', ...over })
  it('groups faces under one family, sorted by weight then italic, deduped by id', () => {
    const fams = buildFamilies([
      rec({ style: 'Heavy Italic', weight: 900, italic: true, postscriptName: 'PPEditorialNew-HeavyItalic', src: 'a/HeavyItalic.otf' }),
      rec({}),
      rec({}), // exact dup → deduped
    ])
    expect(fams).toHaveLength(1)
    expect(fams[0].id).toBe('pangram-pp-editorial-new')
    expect(fams[0].family).toBe('PP Editorial New')
    expect(fams[0].foundry).toBe('pangram')
    expect(fams[0].faces.map(f => f.id)).toEqual(['pangram-ppeditorialnew-regular', 'pangram-ppeditorialnew-heavyitalic'])
    expect(fams[0].faces[0]).toMatchObject({ weight: 400, style: 'Regular', italic: false })
  })
  it('separates families by (foundry, family) and sorts families by name', () => {
    const fams = buildFamilies([
      rec({ family: 'PP Mori', postscriptName: 'PPMori-Book', src: 'm/Book.otf' }),
      rec({}),
    ])
    expect(fams.map(f => f.family)).toEqual(['PP Editorial New', 'PP Mori'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/font-library-helpers.unit.spec.ts`
Expected: FAIL — cannot resolve `../../scripts/fontLibrary.mjs`.

- [ ] **Step 3: Create the shared types**

```ts
// frontend/shared/library-fonts.ts
/** One selectable font file (a single weight/italic of a family). */
export interface LibraryFace {
  /** Stable id: `${foundry}-${slug(postscriptName)}`. Manifest key + route key. */
  id: string
  /** OS/2 usWeightClass (100–900; Pangram uses non-standard values like Book=375). */
  weight: number
  /** Human style label from preferredSubfamily, e.g. "Book", "Heavy Italic". */
  style: string
  italic: boolean
  postscriptName: string
  /** Path relative to `fontsRoot`. Resolved server-side; never sent to the client raw. */
  src: string
}

export interface LibraryFamily {
  /** `${foundry}-${slug(family)}`. */
  id: string
  /** Typographic family name, e.g. "PP Editorial New". */
  family: string
  /** Foundry id: "pangram" | "off-type". */
  foundry: string
  faces: LibraryFace[]
}

export interface LibraryFoundry { id: string; label: string }

export interface LibraryManifest {
  generatedAt: string
  /** Bundle root relative to the repo root, e.g. "Assets/Fonts". */
  fontsRoot: string
  foundries: LibraryFoundry[]
  families: LibraryFamily[]
}
```

- [ ] **Step 4: Create the pure helpers**

```js
// frontend/scripts/fontLibrary.mjs
// Pure, dependency-free helpers for the font-library generator. No fontkit,
// no fs here — kept import-free so vitest can exercise the grouping/slug logic
// without touching the (gitignored) font files. The fontkit adapter lives in
// build-font-library.mjs (Task 2).

/** Map a path relative to the fonts root to its foundry, or null to skip. */
export function foundryFromRelPath(relPath) {
  const top = String(relPath).replace(/\\/g, '/').split('/')[0] || ''
  if (top.startsWith('PPF Fonts')) return { id: 'pangram', label: 'Pangram' }
  if (top.startsWith('Off Set')) return { id: 'off-type', label: 'Off-Type' }
  return null
}

/** Lowercase, non-alphanumerics → single dash, trimmed. */
export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function familyId(foundryId, family) { return `${foundryId}-${slug(family)}` }
export function faceId(foundryId, postscriptName) { return `${foundryId}-${slug(postscriptName)}` }

/** Italic if the font declares a slant OR the style name says so. */
export function isItalicFace(style, italicAngle) {
  return (Number(italicAngle) || 0) !== 0 || /italic|oblique/i.test(String(style))
}

/**
 * Group flat face records into families. A record:
 *   { foundryId, foundryLabel, family, style, weight, italic, postscriptName, src }
 * Faces dedup by face id; sort by (weight asc, italic last); families sort by name.
 */
export function buildFamilies(records) {
  const byKey = new Map()
  for (const r of records) {
    const fid = familyId(r.foundryId, r.family)
    if (!byKey.has(fid)) {
      byKey.set(fid, { id: fid, family: r.family, foundry: r.foundryId, _faces: new Map() })
    }
    const fam = byKey.get(fid)
    const id = faceId(r.foundryId, r.postscriptName)
    if (fam._faces.has(id)) continue // dedup (e.g. flat + otf/ copies)
    fam._faces.set(id, {
      id, weight: r.weight, style: r.style, italic: r.italic,
      postscriptName: r.postscriptName, src: r.src,
    })
  }
  const families = [...byKey.values()].map(fam => ({
    id: fam.id,
    family: fam.family,
    foundry: fam.foundry,
    faces: [...fam._faces.values()].sort(
      (a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic),
    ),
  }))
  families.sort((a, b) => a.family.localeCompare(b.family))
  return families
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/font-library-helpers.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/library-fonts.ts frontend/scripts/fontLibrary.mjs frontend/tests/unit/font-library-helpers.unit.spec.ts
git commit -m "feat(fonts): manifest types + pure font-library helpers"
```

---

### Task 2: Generator CLI + committed manifest + gitignore

**Files:**
- Create: `frontend/scripts/build-font-library.mjs`
- Create: `frontend/app/data/library-fonts.manifest.json` (generated output — committed)
- Modify: `/.gitignore` (repo root) — add `Assets/Fonts/`
- Test: `frontend/tests/unit/font-library-manifest.unit.spec.ts`

**Interfaces:**
- Consumes: `foundryFromRelPath`, `buildFamilies`, `isItalicFace` from Task 1; `LibraryManifest` type.
- Produces: `faceRecordFromFont(font, foundryId, relPath) -> record` (exported from the CLI module for the adapter test), and a runnable script `node scripts/build-font-library.mjs` writing the manifest.

- [ ] **Step 1: Add the gitignore entry**

Append to the repo-root `.gitignore`:

```
# Licensed font library source (served at runtime, never committed — see
# frontend/app/data/library-fonts.manifest.json for the committed catalog)
Assets/Fonts/
```

- [ ] **Step 2: Write the generator CLI**

```js
// frontend/scripts/build-font-library.mjs
// Scan Assets/Fonts/ (both foundry bundles), parse each OTF with fontkit, and
// write app/data/library-fonts.manifest.json. Run: `node scripts/build-font-library.mjs`
// (from frontend/). Re-run whenever fonts are added/updated. Idempotent.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { foundryFromRelPath, isItalicFace, buildFamilies } from './fontLibrary.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const FONTS_ROOT = join(REPO_ROOT, 'Assets', 'Fonts')
const OUT = join(HERE, '..', 'app', 'data', 'library-fonts.manifest.json')

/** Recursively list every .otf under dir. */
function walkOtf(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkOtf(full, acc)
    else if (name.toLowerCase().endsWith('.otf')) acc.push(full)
  }
  return acc
}

/** Extract a flat face record from a parsed font. Metadata > filename. */
export function faceRecordFromFont(font, foundry, relPath) {
  const rec = font.name?.records ?? {}
  const family = rec.preferredFamily?.en || font.familyName || basename(relPath, '.otf')
  const style = rec.preferredSubfamily?.en || font.subfamilyName || 'Regular'
  const weight = font['OS/2']?.usWeightClass ?? 400
  const italic = isItalicFace(style, font.italicAngle || 0)
  const postscriptName = font.postscriptName || basename(relPath, '.otf')
  return { foundryId: foundry.id, foundryLabel: foundry.label, family, style, weight, italic, postscriptName, src: relPath }
}

function main() {
  const files = walkOtf(FONTS_ROOT)
  const records = []
  const skipped = []
  for (const full of files) {
    const relPath = relative(FONTS_ROOT, full).replace(/\\/g, '/')
    const foundry = foundryFromRelPath(relPath)
    if (!foundry) { skipped.push([relPath, 'unknown foundry']); continue }
    try {
      const font = fontkit.openSync(full)
      records.push(faceRecordFromFont(font, foundry, relPath))
    } catch (e) {
      skipped.push([relPath, `parse failed: ${e.message}`])
    }
  }
  const families = buildFamilies(records)
  const foundries = [
    { id: 'pangram', label: 'Pangram' },
    { id: 'off-type', label: 'Off-Type' },
  ].filter(fo => families.some(f => f.foundry === fo.id))
  const manifest = {
    generatedAt: new Date().toISOString(),
    fontsRoot: 'Assets/Fonts',
    foundries,
    families,
  }
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n')
  const faceCount = families.reduce((n, f) => n + f.faces.length, 0)
  console.log(`Wrote ${OUT}`)
  console.log(`  ${families.length} families, ${faceCount} faces, ${foundries.length} foundries`)
  if (skipped.length) {
    console.log(`  Skipped ${skipped.length} file(s):`)
    for (const [p, why] of skipped.slice(0, 40)) console.log(`    - ${p} (${why})`)
    if (skipped.length > 40) console.log(`    …and ${skipped.length - 40} more`)
  }
}

// Run only as a CLI (not when imported by the adapter test).
if (process.argv[1] && process.argv[1].endsWith('build-font-library.mjs')) main()
```

- [ ] **Step 3: Run the generator for real**

Run: `cd frontend && node scripts/build-font-library.mjs`
Expected: prints `~86 families, ~1300 faces, 2 foundries`, a small skip list at most, and writes the manifest JSON. Eyeball the JSON head:

Run: `head -40 frontend/app/data/library-fonts.manifest.json`
Expected: valid JSON; `families[].family` shows clean names ("PP Editorial New", "OT Rhapsody"); faces carry numeric `weight`, `style`, `italic`, `src` under `PPF Fonts - v7.72/…` / `Off Set v1.8/…`.

- [ ] **Step 4: Write the manifest-invariants test**

```ts
// frontend/tests/unit/font-library-manifest.unit.spec.ts
import { describe, it, expect } from 'vitest'
import manifest from '../../app/data/library-fonts.manifest.json'
import type { LibraryManifest } from '../../shared/library-fonts'

const m = manifest as unknown as LibraryManifest

describe('generated library manifest', () => {
  it('has both foundries and a substantial family count', () => {
    expect(m.foundries.map(f => f.id).sort()).toEqual(['off-type', 'pangram'])
    expect(m.families.length).toBeGreaterThan(60)
  })
  it('every family + face id is unique', () => {
    const famIds = m.families.map(f => f.id)
    expect(new Set(famIds).size).toBe(famIds.length)
    const faceIds = m.families.flatMap(f => f.faces.map(x => x.id))
    expect(new Set(faceIds).size).toBe(faceIds.length)
  })
  it('every face has a weight in range, a style, an OTF src, a known foundry', () => {
    const foundries = new Set(m.foundries.map(f => f.id))
    for (const fam of m.families) {
      expect(foundries.has(fam.foundry)).toBe(true)
      expect(fam.faces.length).toBeGreaterThan(0)
      for (const face of fam.faces) {
        expect(face.weight).toBeGreaterThanOrEqual(1)
        expect(face.weight).toBeLessThanOrEqual(1000)
        expect(face.style.length).toBeGreaterThan(0)
        expect(face.src.toLowerCase().endsWith('.otf')).toBe(true)
      }
    }
  })
  it('includes known flagship families', () => {
    const names = new Set(m.families.map(f => f.family))
    expect([...names].some(n => /Editorial New/i.test(n))).toBe(true)
    expect([...names].some(n => /Mori/i.test(n))).toBe(true)
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/font-library-manifest.unit.spec.ts`
Expected: PASS. (If family count assertion is off, inspect the skip list from Step 3 — do not lower the threshold to hide dropped families.)

- [ ] **Step 6: Commit**

```bash
git add .gitignore frontend/scripts/build-font-library.mjs frontend/app/data/library-fonts.manifest.json frontend/tests/unit/font-library-manifest.unit.spec.ts
git commit -m "feat(fonts): font-library generator + committed manifest, gitignore Assets/Fonts"
```

---

### Task 3: Font-serving Nitro route

**Files:**
- Create: `frontend/server/utils/libraryFontManifest.ts`
- Create: `frontend/server/api/library-font/[id].get.ts`
- Test: `frontend/tests/unit/library-font-resolve.unit.spec.ts`

**Interfaces:**
- Produces: `resolveLibraryFontPath(id: string, fontsRoot: string) -> string | null` (absolute path under fontsRoot, or null for unknown id / traversal attempt), `libraryManifest(): LibraryManifest`.
- Route: `GET /api/library-font/<id>` → `font/otf` bytes, 404 for unknown id.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/library-font-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { resolveLibraryFontPath } from '../../server/utils/libraryFontManifest'
import manifest from '../../app/data/library-fonts.manifest.json'
import type { LibraryManifest } from '../../shared/library-fonts'

const m = manifest as unknown as LibraryManifest
const ROOT = '/fonts-root'
const firstFace = m.families[0]!.faces[0]!

describe('resolveLibraryFontPath', () => {
  it('resolves a known face id to an absolute path under root', () => {
    const p = resolveLibraryFontPath(firstFace.id, ROOT)
    expect(p).toBe(`${ROOT}/${firstFace.src}`)
  })
  it('returns null for an unknown id', () => {
    expect(resolveLibraryFontPath('does-not-exist', ROOT)).toBeNull()
  })
  it('never escapes the root even if a src were malicious', () => {
    // ids come only from the manifest, but the resolver must still be safe.
    expect(resolveLibraryFontPath('../../etc/passwd', ROOT)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/library-font-resolve.unit.spec.ts`
Expected: FAIL — cannot resolve `server/utils/libraryFontManifest`.

- [ ] **Step 3: Write the manifest util + resolver**

```ts
// frontend/server/utils/libraryFontManifest.ts
import { join, resolve, sep } from 'node:path'
import manifest from '~~/app/data/library-fonts.manifest.json'
import type { LibraryManifest } from '~~/shared/library-fonts'

const m = manifest as unknown as LibraryManifest

/** Face id → relative src, built once. */
const srcById = new Map<string, string>(
  m.families.flatMap(f => f.faces.map(face => [face.id, face.src] as const)),
)

export function libraryManifest(): LibraryManifest { return m }

/**
 * Absolute path for a face id under `fontsRoot`, or null if the id is unknown
 * or the resolved path escapes the root (defence in depth — ids come from the
 * manifest, but never trust the join).
 */
export function resolveLibraryFontPath(id: string, fontsRoot: string): string | null {
  const src = srcById.get(id)
  if (!src) return null
  const rootAbs = resolve(fontsRoot)
  const full = resolve(join(rootAbs, src))
  if (full !== rootAbs && !full.startsWith(rootAbs + sep)) return null
  return full
}

/** Repo-root Assets/Fonts, overridable for other machines. */
export function libraryFontsRoot(): string {
  return process.env.SAILOR_FONTS_ROOT || resolve(process.cwd(), '..', m.fontsRoot)
}
```

Note: Nitro's default `cwd` is `frontend/`, so `../Assets/Fonts` resolves to the repo root. `SAILOR_FONTS_ROOT` overrides it if the layout differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/library-font-resolve.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the route**

```ts
// frontend/server/api/library-font/[id].get.ts
/**
 * Serve one licensed OTF from the (gitignored) Assets/Fonts library by face id.
 * Only ids present in the committed manifest resolve; the resolver path-guards.
 * Mirrors server/api/template-fonts/file/[name].get.ts.
 */
import { readFile } from 'node:fs/promises'
import { resolveLibraryFontPath, libraryFontsRoot } from '~~/server/utils/libraryFontManifest'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const path = resolveLibraryFontPath(id, libraryFontsRoot())
  if (!path) throw createError({ statusCode: 404, statusMessage: 'Unknown font id' })

  const buf = await readFile(path).catch(() => null)
  if (!buf) throw createError({ statusCode: 404, statusMessage: 'Font file missing' })

  setHeader(event, 'content-type', 'font/otf')
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return buf
})
```

- [ ] **Step 6: Verify the route serves live**

Start the dev server if not running (`cd frontend && npm run dev`, or use the existing one). Then, with a real id from the manifest:

Run: `ID=$(node -e "const m=require('./frontend/app/data/library-fonts.manifest.json');process.stdout.write(m.families[0].faces[0].id)"); curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" "http://127.0.0.1:3000/api/library-font/$ID"`
Expected: `200 font/otf <bytes>` with bytes > 1000. Also confirm `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/library-font/nope` prints `404`.

- [ ] **Step 7: Commit**

```bash
git add frontend/server/utils/libraryFontManifest.ts frontend/server/api/library-font/ frontend/tests/unit/library-font-resolve.unit.spec.ts
git commit -m "feat(fonts): /api/library-font route serving OTFs from the gitignored library"
```

---

### Task 4: Shared client catalog module

**Files:**
- Create: `frontend/app/data/library-fonts.ts`
- Modify: `frontend/app/lib/font/resolveFamily.ts` (add a library-family registry)
- Test: `frontend/tests/unit/library-fonts-catalog.unit.spec.ts`

**Interfaces:**
- Consumes: manifest JSON; `LibraryFamily`/`LibraryFace` types.
- Produces:
  - `LIBRARY_FONTS: LibraryManifest`
  - `librariesByFoundry(): { foundry: LibraryFoundry; families: LibraryFamily[] }[]`
  - `libraryFamily(family: string): LibraryFamily | null`
  - `libraryFontUrl(faceId: string): string` → `/api/library-font/<faceId>`
  - `resolveLibraryFace(family: string, weight?: number, italic?: boolean): LibraryFace | null` (nearest weight; matches italic when asked, else prefers upright)
  - `registerLibraryFonts(): void` — pushes families into `setLibraryFamilies` (resolveFamily) and installs the outline resolver (Task 5 consumes it)
- Produces (resolveFamily.ts additions): `setLibraryFamilies(fams: GoogleFontLike[]): void`; `resolveFontFamily`/`fontHasWeightAxis` also consult library families.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/library-fonts-catalog.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { librariesByFoundry, libraryFontUrl, resolveLibraryFace, libraryFamily } from '../../app/data/library-fonts'

describe('library catalog', () => {
  it('groups families under both foundries', () => {
    const groups = librariesByFoundry()
    const ids = groups.map(g => g.foundry.id)
    expect(ids).toContain('pangram')
    expect(ids).toContain('off-type')
    for (const g of groups) expect(g.families.length).toBeGreaterThan(0)
  })
  it('builds a route url from a face id', () => {
    expect(libraryFontUrl('pangram-ppmori-book')).toBe('/api/library-font/pangram-ppmori-book')
  })
  it('resolveLibraryFace picks nearest weight and honours italic', () => {
    const fam = librariesByFoundry().flatMap(g => g.families).find(f => f.faces.length > 2)!
    const target = fam.faces[Math.floor(fam.faces.length / 2)]!
    const got = resolveLibraryFace(fam.family, target.weight, target.italic)
    expect(got?.weight).toBe(target.weight)
    expect(got?.italic).toBe(target.italic)
  })
  it('resolveLibraryFace falls back to a real face for an off-scale weight', () => {
    const fam = librariesByFoundry().flatMap(g => g.families)[0]!
    const got = resolveLibraryFace(fam.family, 9999, false)
    expect(got).not.toBeNull()
  })
  it('returns null for an unknown family', () => {
    expect(libraryFamily('No Such Family 123')).toBeNull()
    expect(resolveLibraryFace('No Such Family 123', 400)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/library-fonts-catalog.unit.spec.ts`
Expected: FAIL — cannot resolve `app/data/library-fonts`.

- [ ] **Step 3: Extend resolveFamily.ts with a library registry**

Add below the existing `catalog` machinery (do not remove anything):

```ts
// --- Library fonts (local licensed families) ---------------------------------
// Registered separately from the Google catalog so the two never clobber each
// other via setFontCatalog. resolveFontFamily / fontHasWeightAxis consult both.
let libraryFamilies: GoogleFontLike[] = []

/** Populate (or clear) the library-family registry. app/data/library-fonts.ts
 *  calls this once at startup with the manifest families. */
export function setLibraryFamilies(fams: GoogleFontLike[]): void {
  libraryFamilies = fams
}
```

Then update the two consult sites:

```ts
export function resolveFontFamily(value: string): string {
  if (!value) return 'Inter'
  if (catalog?.some(f => f.family === value)) return value
  if (libraryFamilies.some(f => f.family === value)) return value
  const legacy = LEGACY_FONT_IDS[value]
  if (legacy) return legacy
  return value
}

export function fontHasWeightAxis(family: string): boolean {
  const f = catalog?.find(g => g.family === family)
    ?? libraryFamilies.find(g => g.family === family)
  if (!f) return true
  return f.axes.some(a => a.tag === 'wght') || f.weights.length > 1
}
```

- [ ] **Step 4: Create the catalog module**

```ts
// frontend/app/data/library-fonts.ts
/**
 * Shared client catalog over the committed font-library manifest. The single
 * consumer-facing surface for both font worlds: pickers read the grouped
 * families; the CSS world builds @font-face from faces; the outline world
 * resolves a `local:Family@weight` token to a route URL via the resolver this
 * module installs into outlines.ts. Network-free (imports static JSON only).
 */
import manifest from './library-fonts.manifest.json'
import type { LibraryManifest, LibraryFamily, LibraryFace, LibraryFoundry } from '~~/shared/library-fonts'
import { setLibraryFamilies } from '~/lib/font/resolveFamily'
import { setLibraryFaceResolver } from '~/lib/scene3d/outlines'

export const LIBRARY_FONTS = manifest as unknown as LibraryManifest

const byFamily = new Map<string, LibraryFamily>(LIBRARY_FONTS.families.map(f => [f.family, f]))

export function librariesByFoundry(): { foundry: LibraryFoundry; families: LibraryFamily[] }[] {
  return LIBRARY_FONTS.foundries.map(foundry => ({
    foundry,
    families: LIBRARY_FONTS.families.filter(f => f.foundry === foundry.id),
  }))
}

export function libraryFamily(family: string): LibraryFamily | null {
  return byFamily.get(family) ?? null
}

export function libraryFontUrl(faceId: string): string {
  return `/api/library-font/${encodeURIComponent(faceId)}`
}

/**
 * Nearest face for family + weight. When `italic` is specified, only faces of
 * that slant are considered; if none exist, falls back to the other slant so a
 * family that ships italics-only still resolves. Nearest weight by abs distance.
 */
export function resolveLibraryFace(family: string, weight = 400, italic?: boolean): LibraryFace | null {
  const fam = byFamily.get(family)
  if (!fam || !fam.faces.length) return null
  let pool = fam.faces
  if (italic !== undefined) {
    const slant = fam.faces.filter(f => f.italic === italic)
    pool = slant.length ? slant : fam.faces
  }
  return pool.reduce((best, f) =>
    Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best, pool[0]!)
}

/** Install this module into the two resolver hooks. Called once at startup. */
export function registerLibraryFonts(): void {
  setLibraryFamilies(LIBRARY_FONTS.families.map(f => ({
    family: f.family,
    weights: [...new Set(f.faces.map(x => x.weight))].sort((a, b) => a - b),
    axes: [], // static instances — no continuous wght axis
  })))
  setLibraryFaceResolver((family, weight, italic) => {
    const face = resolveLibraryFace(family, weight, italic)
    return face ? face.id : null
  })
}
```

Note: `setLibraryFaceResolver` is created in Task 5. If implementing strictly in order, add a temporary stub `export function setLibraryFaceResolver(_fn: unknown) {}` in outlines.ts now and flesh it out in Task 5 — or implement Task 5 first. The test in this task does not exercise the resolver, so it passes regardless.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/library-fonts-catalog.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/data/library-fonts.ts frontend/app/lib/font/resolveFamily.ts frontend/tests/unit/library-fonts-catalog.unit.spec.ts
git commit -m "feat(fonts): shared library catalog + resolveFamily library registry"
```

---

### Task 5: Outline-world `local:` token support

**Files:**
- Modify: `frontend/app/lib/scene3d/outlines.ts`
- Modify: `frontend/app/lib/spacetype/effects/loft.ts`
- Test: `frontend/tests/unit/outlines-local-token.unit.spec.ts`

**Interfaces:**
- Produces: `parseLibraryFontValue(value: string): { family: string; weight?: number; italic?: boolean } | null` (prefix `local:`, `@700` weight, trailing `i` = italic); `setLibraryFaceResolver(fn: (family: string, weight: number | undefined, italic: boolean | undefined) => string | null): void`.
- Modifies: `fontSourceUrl` (resolves `local:` via the resolver → `/api/library-font/<id>`), `fontDisplayName` (library token → family).
- Modifies (loft.ts): `outlineFontValue` passes `local:` through untouched.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/outlines-local-token.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { parseLibraryFontValue, setLibraryFaceResolver, fontSourceUrl, fontDisplayName } from '../../app/lib/scene3d/outlines'
import { outlineFontValue } from '../../app/lib/spacetype/effects/loft'

describe('parseLibraryFontValue', () => {
  it('parses family, weight, italic', () => {
    expect(parseLibraryFontValue('local:PP Mori')).toEqual({ family: 'PP Mori' })
    expect(parseLibraryFontValue('local:PP Mori@700')).toEqual({ family: 'PP Mori', weight: 700 })
    expect(parseLibraryFontValue('local:PP Mori@700i')).toEqual({ family: 'PP Mori', weight: 700, italic: true })
    expect(parseLibraryFontValue('google:Inter@400')).toBeNull()
  })
})

describe('fontSourceUrl for local tokens', () => {
  beforeEach(() => setLibraryFaceResolver((family, weight) => `pangram-fake-${weight ?? 'x'}`))
  it('resolves via the registered resolver to the route', () => {
    expect(fontSourceUrl('local:PP Mori@700')).toBe('/api/library-font/pangram-fake-700')
  })
  it('unresolved token falls through to the raw value (fails the fetch cleanly)', () => {
    setLibraryFaceResolver(() => null)
    expect(fontSourceUrl('local:PP Mori@700')).toBe('local:PP Mori@700')
  })
})

describe('fontDisplayName + outlineFontValue', () => {
  it('names a local token by family', () => {
    expect(fontDisplayName('local:PP Editorial New@900')).toBe('PP Editorial New')
  })
  it('outlineFontValue leaves a local token untouched (no google: prefix)', () => {
    expect(outlineFontValue('local:PP Mori@700')).toBe('local:PP Mori@700')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/outlines-local-token.unit.spec.ts`
Expected: FAIL — `parseLibraryFontValue`/`setLibraryFaceResolver` not exported.

- [ ] **Step 3: Add the local-token machinery to outlines.ts**

After the Google-scheme block (near line 147), add:

```ts
// ---------------------------------------------------------------------------
// Library fonts scheme
//
// `local:Family` / `local:Family@weight` / `local:Family@weightI` — the local
// licensed library. Like `google:`, the token never hits the network directly:
// a resolver installed by app/data/library-fonts.ts maps (family, weight,
// italic) to a stable face id, which fontSourceUrl turns into a call against
// /api/library-font/<id>. Kept as an injected resolver so this module stays
// free of the manifest import (and out of the embed bundle's network checks).
// ---------------------------------------------------------------------------

const LOCAL_PREFIX = 'local:'

type LibraryFaceResolver = (family: string, weight: number | undefined, italic: boolean | undefined) => string | null
let libraryFaceResolver: LibraryFaceResolver | null = null

/** Install the (family,weight,italic) → faceId resolver. */
export function setLibraryFaceResolver(fn: LibraryFaceResolver | null): void {
  libraryFaceResolver = fn
}

/** Split a `local:Family` / `local:Family@700` / `local:Family@700i` value. */
export function parseLibraryFontValue(value: string): { family: string; weight?: number; italic?: boolean } | null {
  if (!value.startsWith(LOCAL_PREFIX)) return null
  const rest = value.slice(LOCAL_PREFIX.length)
  const at = rest.indexOf('@')
  const family = (at === -1 ? rest : rest.slice(0, at)).trim()
  if (!family) return null
  if (at === -1) return { family }
  let spec = rest.slice(at + 1).trim()
  let italic: boolean | undefined
  if (/i$/i.test(spec)) { italic = true; spec = spec.slice(0, -1) }
  const weight = spec === '' ? NaN : Number(spec)
  const out: { family: string; weight?: number; italic?: boolean } = { family }
  if (Number.isFinite(weight)) out.weight = Math.round(weight)
  if (italic) out.italic = true
  return out
}
```

Then update `fontSourceUrl` and `fontDisplayName` (extend, keep the Google branch):

```ts
export function fontSourceUrl(value: string): string {
  const parsed = parseGoogleFontValue(value)
  if (parsed) {
    const familyParam = encodeURIComponent(parsed.family).replace(/%20/g, '+')
    const weightParam = parsed.weight !== undefined ? `&weight=${parsed.weight}` : ''
    return `/api/scene3d/google-font-file?family=${familyParam}${weightParam}`
  }
  const local = parseLibraryFontValue(value)
  if (local) {
    const id = libraryFaceResolver?.(local.family, local.weight, local.italic)
    if (id) return `/api/library-font/${encodeURIComponent(id)}`
    return value // catalog not ready / unknown — let the fetch fail and fall back
  }
  return value
}

export function fontDisplayName(value: string): string {
  const parsed = parseGoogleFontValue(value)
  if (parsed) return parsed.family
  const local = parseLibraryFontValue(value)
  if (local) return local.family
  const known = AVAILABLE_FONTS.find((f) => f.url === value)
  if (known) return known.label
  return value.split('/').pop() || value
}
```

- [ ] **Step 4: Update outlineFontValue in loft.ts**

```ts
export function outlineFontValue(font: string | undefined): string {
  const v = String(font ?? '').trim()
  if (!v) return 'google:Archivo Black@700'
  if (v.startsWith('google:') || v.startsWith('local:') || v.includes('/')) return v
  return 'google:' + v
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/outlines-local-token.unit.spec.ts`
Expected: PASS.

- [ ] **Step 6: Wire the resolver at startup**

The catalog must register before any outline render. Confirm `registerLibraryFonts()` (Task 4) is invoked once app-side. Add it where `loadGoogleCatalog()` is already kicked off — a Nuxt client plugin is cleanest:

```ts
// frontend/app/plugins/library-fonts.client.ts
import { registerLibraryFonts } from '~/data/library-fonts'
export default defineNuxtPlugin(() => { registerLibraryFonts() })
```

- [ ] **Step 7: Run the full unit suite for regressions**

Run: `cd frontend && npx vitest run tests/unit/outlines-local-token.unit.spec.ts tests/unit/library-fonts-catalog.unit.spec.ts`
Expected: PASS. (Confirms the Task 4 stub is now the real function and nothing regressed.)

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/outlines.ts frontend/app/lib/spacetype/effects/loft.ts frontend/app/plugins/library-fonts.client.ts frontend/tests/unit/outlines-local-token.unit.spec.ts
git commit -m "feat(fonts): local: outline token + resolver + startup registration"
```

---

### Task 6: CSS/DOM world — `useLibraryFonts` composable

**Files:**
- Create: `frontend/app/composables/useLibraryFonts.ts`
- Test: `frontend/tests/unit/library-font-face-css.unit.spec.ts`

**Interfaces:**
- Produces: `familyFaceCss(fam: LibraryFamily): string` (pure — one `@font-face` per face); `useLibraryFonts()` returning `{ ensure(family: string): void }` (idempotent per family, injects `<style data-library-font="familyId">`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/library-font-face-css.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { familyFaceCss } from '../../app/composables/useLibraryFonts'
import type { LibraryFamily } from '../../shared/library-fonts'

const fam: LibraryFamily = {
  id: 'pangram-pp-mori', family: 'PP Mori', foundry: 'pangram',
  faces: [
    { id: 'pangram-ppmori-book', weight: 375, style: 'Book', italic: false, postscriptName: 'PPMori-Book', src: 'x/Book.otf' },
    { id: 'pangram-ppmori-bookitalic', weight: 375, style: 'Book Italic', italic: true, postscriptName: 'PPMori-BookItalic', src: 'x/BookItalic.otf' },
  ],
}

describe('familyFaceCss', () => {
  const css = familyFaceCss(fam)
  it('emits one @font-face per face, quoting the family', () => {
    expect(css.match(/@font-face/g)?.length).toBe(2)
    expect(css).toContain("font-family:'PP Mori'")
  })
  it('sets weight, style and the route url per face', () => {
    expect(css).toContain('font-weight:375')
    expect(css).toContain('font-style:italic')
    expect(css).toContain("url('/api/library-font/pangram-ppmori-book')")
    expect(css).toContain("url('/api/library-font/pangram-ppmori-bookitalic')")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/library-font-face-css.unit.spec.ts`
Expected: FAIL — cannot resolve `useLibraryFonts`.

- [ ] **Step 3: Write the composable**

```ts
// frontend/app/composables/useLibraryFonts.ts
/**
 * CSS/DOM half of the font library: inject an @font-face per face of a family
 * so templates / Compositor / motion text render the real licensed faces.
 * Mirrors useUploadedFonts.ensure() — one <style> block per family, idempotent.
 */
import type { LibraryFamily } from '~~/shared/library-fonts'
import { libraryFamily, libraryFontUrl } from '~/data/library-fonts'

function cssEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** All @font-face rules for a family (one per face). Pure — unit-tested. */
export function familyFaceCss(fam: LibraryFamily): string {
  return fam.faces.map(face =>
    `@font-face{font-family:'${cssEscape(fam.family)}';`
    + `font-weight:${face.weight};`
    + `font-style:${face.italic ? 'italic' : 'normal'};`
    + `font-display:swap;`
    + `src:url('${libraryFontUrl(face.id)}') format('opentype')}`,
  ).join('')
}

const ensured = new Set<string>() // family ids with an injected block

function ensure(family: string | null | undefined): void {
  if (!family || typeof document === 'undefined') return
  const fam = libraryFamily(family)
  if (!fam || ensured.has(fam.id)) return
  const style = document.createElement('style')
  style.dataset.libraryFont = fam.id
  style.textContent = familyFaceCss(fam)
  document.head.appendChild(style)
  ensured.add(fam.id)
}

export function useLibraryFonts() {
  return { ensure }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/library-font-face-css.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useLibraryFonts.ts frontend/tests/unit/library-font-face-css.unit.spec.ts
git commit -m "feat(fonts): useLibraryFonts @font-face injection for CSS surfaces"
```

---

### Task 7: Main FontPicker — Google | Pangram tabs

**Files:**
- Modify: `frontend/app/components/vue-canvas/FontPicker.vue`
- Test: `frontend/tests/unit/font-picker-tabs.unit.spec.ts` (mount + light interaction via @vue/test-utils, following existing component-test patterns in `tests/unit/`)

**Interfaces:**
- Consumes: `librariesByFoundry`, `useLibraryFonts` (for in-face previews).
- Produces: a new emit payload variant — `{ kind: 'library'; family: string; foundry: string }` — added to the existing `select` union. Existing `google` / `pinned` payloads unchanged.

- [ ] **Step 1: Extend the emit type + add tab state**

In `<script setup>`, widen the `select` emit and add tab/library state:

```ts
const emit = defineEmits<{
  (e: 'promote'): void
  (e: 'menu', ev: MouseEvent): void
  (e: 'goToCollection'): void
  (e: 'select', payload:
    | { kind: 'google'; family: string }
    | { kind: 'pinned'; value: string }
    | { kind: 'library'; family: string; foundry: string }): void
}>()

import { librariesByFoundry } from '~/data/library-fonts'
const { ensure: ensureLibFace } = useLibraryFonts()

type Tab = 'google' | 'pangram'
const activeTab = ref<Tab>('google')
const libraryGroups = librariesByFoundry() // [{foundry, families}]

const filteredLibrary = computed(() => {
  const q = fontSearch.value.trim().toLowerCase()
  return libraryGroups.map(g => ({
    foundry: g.foundry,
    families: q ? g.families.filter(f => f.family.toLowerCase().includes(q)) : g.families,
  })).filter(g => g.families.length)
})

function selectLibrary(family: string, foundry: string) {
  emit('select', { kind: 'library', family, foundry })
  closePicker()
}
// Preview each visible library family in its own face.
watch([activeTab, filteredLibrary], () => {
  if (activeTab.value === 'pangram') for (const g of filteredLibrary.value) for (const f of g.families) ensureLibFace(f.family)
})
```

- [ ] **Step 2: Add the tab bar + Pangram tab body to the template**

Insert a tab bar just inside the open panel (after the search row, before the Suggested/Pinned/catalog blocks), wrap the existing Google list in a `v-if="activeTab==='google'"`, and add the Pangram body:

```vue
<!-- Source tabs -->
<div class="mb-1 flex items-center gap-1 px-1">
  <button type="button" @click="activeTab='google'"
          class="rounded px-2 py-0.5 text-[11px]"
          :class="activeTab==='google' ? 'bg-white/15 text-white/90' : 'text-white/50 hover:text-white/80'">Google</button>
  <button type="button" @click="activeTab='pangram'"
          class="rounded px-2 py-0.5 text-[11px]"
          :class="activeTab==='pangram' ? 'bg-white/15 text-white/90' : 'text-white/50 hover:text-white/80'">Pangram</button>
</div>

<!-- Pangram / Off-Type -->
<div v-if="activeTab==='pangram'" class="max-h-48 overflow-y-auto">
  <template v-for="g in filteredLibrary" :key="g.foundry.id">
    <p class="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">{{ g.foundry.label }}</p>
    <button v-for="f in g.families" :key="f.id" type="button"
            @click="selectLibrary(f.family, f.foundry)"
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
            :class="{ 'bg-white/15': modelValue === f.family }">
      <span class="truncate" :style="{ fontFamily: f.family }">{{ f.family }}</span>
      <span class="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-white/40">{{ f.faces.length }}</span>
    </button>
  </template>
  <p v-if="!filteredLibrary.length" class="px-2 py-1 text-white/40">No matches</p>
</div>
```

Wrap the existing Suggested + Pinned + Google catalog blocks (the `mb-1` Suggested div, the pinned div, and the `max-h-48` catalog div) in a single `<div v-if="activeTab==='google'">`. The `showVariableToggle` label stays under the search, Google-only.

- [ ] **Step 3: Write the mount test**

```ts
// frontend/tests/unit/font-picker-tabs.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FontPicker from '../../app/components/vue-canvas/FontPicker.vue'

describe('FontPicker tabs', () => {
  it('opens, switches to Pangram, and emits a library payload', async () => {
    const w = mount(FontPicker, { props: { modelValue: '' } })
    await w.find('button').trigger('click') // open the trigger
    const pangramTab = w.findAll('button').find(b => b.text() === 'Pangram')!
    await pangramTab.trigger('click')
    const famBtn = w.findAll('button').find(b => /PP |OT /.test(b.text()))
    expect(famBtn).toBeTruthy()
    await famBtn!.trigger('click')
    const ev = w.emitted('select')?.pop()?.[0] as any
    expect(ev.kind).toBe('library')
    expect(typeof ev.family).toBe('string')
    expect(['pangram', 'off-type']).toContain(ev.foundry)
  })
})
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run tests/unit/font-picker-tabs.unit.spec.ts`
Expected: PASS. If mounting needs global stubs (StudioSwitch/VariableGlyph), follow the stub pattern already used by sibling component tests in `tests/unit/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/FontPicker.vue frontend/tests/unit/font-picker-tabs.unit.spec.ts
git commit -m "feat(fonts): Google | Pangram tabs in the main FontPicker"
```

---

### Task 8: Wire the outline consumers (Space Type + Scene3D)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (`onFontSelect`)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (`onFontPick`)
- Test: extend `frontend/tests/unit/outlines-local-token.unit.spec.ts` with a token-build helper, or add `frontend/tests/unit/outline-font-select.unit.spec.ts`

**Interfaces:**
- Consumes: the `library` select payload (Task 7); `resolveLibraryFace` (Task 4); `local:` token (Task 5).
- Produces: a shared token builder `libraryToken(family, weight?, italic?)` in `app/data/library-fonts.ts` → `local:Family` / `local:Family@700` / `local:Family@700i`, so both surfaces build it identically (DRY).

- [ ] **Step 1: Add + test the token builder**

Add to `app/data/library-fonts.ts`:

```ts
/** Build a `local:` outline token. Weight/italic omitted → nearest resolves later. */
export function libraryToken(family: string, weight?: number, italic?: boolean): string {
  let t = `local:${family}`
  if (weight !== undefined) t += `@${weight}${italic ? 'i' : ''}`
  return t
}
```

Add to `tests/unit/library-fonts-catalog.unit.spec.ts`:

```ts
import { libraryToken } from '../../app/data/library-fonts'
// …
it('builds local: tokens', () => {
  expect(libraryToken('PP Mori')).toBe('local:PP Mori')
  expect(libraryToken('PP Mori', 700)).toBe('local:PP Mori@700')
  expect(libraryToken('PP Mori', 700, true)).toBe('local:PP Mori@700i')
})
```

Run: `cd frontend && npx vitest run tests/unit/library-fonts-catalog.unit.spec.ts`
Expected: PASS.

- [ ] **Step 2: Handle the library payload in SpaceTypeSurface.onFontSelect**

`onFontSelect(key, payload)` currently handles `google`/`pinned`. Add a `library` branch that stores a `local:` token seeded to the family's nearest-regular face weight (so a real weight is present for downstream weight edits):

```ts
import { libraryToken, resolveLibraryFace } from '~/data/library-fonts'
// inside onFontSelect:
if (payload.kind === 'library') {
  const face = resolveLibraryFace(payload.family, 400, false)
  params.font = libraryToken(payload.family, face?.weight)
  // existing post-select side effects (ensureFont / axis sync) run as for google
  return
}
```

Ensure the existing `ensureFont(String(params.font))` path runs for the new value (it calls `fontSourceUrl(outlineFontValue(...))`, which now understands `local:`). If `onFontSelect` early-returns, call the same follow-up it uses for google before returning.

- [ ] **Step 3: Handle the library payload in Scene3DStudioSurface.onFontPick**

`onFontPick(payload)` currently builds `google:` tokens and writes `o.content.font`. Add:

```ts
import { libraryToken, resolveLibraryFace } from '~/data/library-fonts'
// inside onFontPick, before/around the google branch:
if (payload.kind === 'library') {
  const existing = parseLibraryFontValue(o.content?.font ?? '')
  const face = resolveLibraryFace(payload.family, existing?.weight ?? 400, existing?.italic ?? false)
  if (o.content) o.content.font = libraryToken(payload.family, face?.weight, face?.italic)
  return
}
```

Import `parseLibraryFontValue` alongside the existing `parseGoogleFontValue` import from `~/lib/scene3d/outlines`.

For the Scene3D **weight select** (currently derived from `parseGoogleFontValue`), extend it to also recognise a `local:` token: when the selected font is a library token, populate the weight options from `libraryFamily(family).faces` (unique weights) and, on change, rewrite the token via `libraryToken(family, w, italic)`. Keep the google path exactly as-is. (This is the one surface with a discrete weight UI; Space Type relies on nearest-weight defaulting for v1.)

- [ ] **Step 4: Typecheck + unit regression**

Run: `cd frontend && npx vitest run tests/unit/outlines-local-token.unit.spec.ts tests/unit/library-fonts-catalog.unit.spec.ts`
Expected: PASS.
Run: `cd frontend && npx nuxi typecheck 2>&1 | tail -5` (baseline ~328 errors per project memory — confirm you introduced no NEW errors naming these files).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/library-fonts.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/library-fonts-catalog.unit.spec.ts
git commit -m "feat(fonts): Space Type + Scene3D consume library fonts via local: tokens"
```

---

### Task 9: Widget picker + Compositor (CSS world)

**Files:**
- Modify: `frontend/app/components/vue-canvas/widgets/FontPicker.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`
- Test: `frontend/tests/unit/widget-font-picker-lib.unit.spec.ts`

**Interfaces:**
- Consumes: `librariesByFoundry`, `useLibraryFonts`.
- Produces (widget picker): `pick` payload gains `{ source: 'library'; family: string }` alongside the existing `variable`/`google` variants; selection key format gains `lib:<family>`.

- [ ] **Step 1: Add the Pangram tab to the widget picker**

Mirror Task 7 in `widgets/FontPicker.vue`: a `Google | Pangram` tab bar, the foundry-grouped library list from `librariesByFoundry()`, and a `pick` emit of `{ source: 'library', family }`. Selection-key parsing (`selectedKey`) gains a `lib:` case so an already-chosen library family shows as active and opens on the Pangram tab.

- [ ] **Step 2: Handle the library pick in CompositorModal**

`onPickFont` currently stores `fontFamily` on the layer + calls `ensureGoogleFont`. Add:

```ts
import { useLibraryFonts } from '~/composables/useLibraryFonts'
const { ensure: ensureLibraryFont } = useLibraryFonts()
// in onPickFont, for a library pick:
if (payload.source === 'library') {
  layer.fontFamily = payload.family
  ensureLibraryFont(payload.family)
  return
}
```

Also call `ensureLibraryFont(layer.fontFamily)` wherever the modal ensures Google fonts on load (so saved docs referencing a library family register their faces). Search the modal for existing `ensureGoogleFont(` load-time calls and add the library ensure beside them (a family is library-owned iff `libraryFamily(family)` is non-null — call both ensures; each no-ops for families it doesn't own).

- [ ] **Step 3: Write the widget-picker test**

```ts
// frontend/tests/unit/widget-font-picker-lib.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FontPicker from '../../app/components/vue-canvas/widgets/FontPicker.vue'

describe('widget FontPicker library tab', () => {
  it('emits a library pick', async () => {
    const w = mount(FontPicker, { props: { selectedKey: '', label: 'Font' } })
    // open if the widget picker uses a trigger; then:
    const tab = w.findAll('button').find(b => b.text() === 'Pangram')
    if (tab) await tab.trigger('click')
    const famBtn = w.findAll('button').find(b => /PP |OT /.test(b.text()))!
    await famBtn.trigger('click')
    const ev = w.emitted('pick')?.pop()?.[0] as any
    expect(ev.source).toBe('library')
    expect(typeof ev.family).toBe('string')
  })
})
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run tests/unit/widget-font-picker-lib.unit.spec.ts`
Expected: PASS (adapt the open step to the widget picker's actual trigger, matching its existing structure).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/FontPicker.vue frontend/app/components/vue-canvas/CompositorModal.vue frontend/tests/unit/widget-font-picker-lib.unit.spec.ts
git commit -m "feat(fonts): widget picker + Compositor library-font support"
```

---

### Task 10: Template picker — Google | Pangram | Brand tabs

**Files:**
- Modify: `frontend/app/components/templates/FontPicker.vue`
- Test: `frontend/tests/unit/template-font-picker-tabs.unit.spec.ts`

**Interfaces:**
- Consumes: `librariesByFoundry`, `useLibraryFonts`, existing `useUploadedFonts`.
- Produces: three tabs. Emits `update:modelValue` with the bare family name (unchanged contract) for all sources; the picker calls the matching `ensure()` (Google / library / uploaded) on select.

- [ ] **Step 1: Restructure into tabs**

Replace the single merged `ALL_FONTS` list with three tab bodies:
- **Google** — the existing `GOOGLE_FONT_LIST` + curated `TEMPLATE_FONTS` (fold curated in here as a small "Curated" group at the top).
- **Pangram** — `librariesByFoundry()`, foundry-grouped; on select call `useLibraryFonts().ensure(family)` then `emit('update:modelValue', family)`.
- **Brand** — `useUploadedFonts().fonts`; on select call its `ensure(family)` then emit.

Default the active tab to the source that owns `modelValue` (library if `libraryFamily(modelValue)`, brand if it's an uploaded family, else Google).

- [ ] **Step 2: Write the test**

```ts
// frontend/tests/unit/template-font-picker-tabs.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FontPicker from '../../app/components/templates/FontPicker.vue'

describe('template FontPicker tabs', () => {
  it('shows all three tabs and emits a family name from the Pangram tab', async () => {
    const w = mount(FontPicker, { props: { modelValue: '' } })
    // open if needed, then assert the three tabs exist
    const labels = w.findAll('button').map(b => b.text())
    expect(labels).toEqual(expect.arrayContaining(['Google', 'Pangram', 'Brand']))
    const tab = w.findAll('button').find(b => b.text() === 'Pangram')!
    await tab.trigger('click')
    const famBtn = w.findAll('button').find(b => /PP |OT /.test(b.text()))!
    await famBtn.trigger('click')
    const ev = w.emitted('update:modelValue')?.pop()?.[0]
    expect(typeof ev).toBe('string')
    expect((ev as string).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `cd frontend && npx vitest run tests/unit/template-font-picker-tabs.unit.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/templates/FontPicker.vue frontend/tests/unit/template-font-picker-tabs.unit.spec.ts
git commit -m "feat(fonts): Google | Pangram | Brand tabs in the template FontPicker"
```

---

### Task 11: Live verification + dashboard/docs

**Files:**
- Modify: the ⛵ State-of-the-Build artifact + `docs/VISION|ROADMAP|STATE.md` per the standing dashboard rule.
- No new code; this task proves the two rendering paths actually run and records the landing.

- [ ] **Step 1: Full unit suite**

Run: `cd frontend && npx vitest run tests/unit/font-library-helpers.unit.spec.ts tests/unit/font-library-manifest.unit.spec.ts tests/unit/library-font-resolve.unit.spec.ts tests/unit/library-fonts-catalog.unit.spec.ts tests/unit/outlines-local-token.unit.spec.ts tests/unit/library-font-face-css.unit.spec.ts tests/unit/font-picker-tabs.unit.spec.ts tests/unit/widget-font-picker-lib.unit.spec.ts tests/unit/template-font-picker-tabs.unit.spec.ts`
Expected: all PASS. Record the exact pass/total counts (per project memory, vitest counts drift under load — quote the collected-file total, not a remembered number).

- [ ] **Step 2: Live hand-check — outline path (Space Type)**

Open the app in the Browser pane (dev server on `127.0.0.1:3000` — use `127.0.0.1`, not `localhost`). Add a Space Type node, open its font picker, switch to the **Pangram** tab, pick **PP Editorial New**. Confirm the 3D text re-renders in that face (not the default). Verify the real path ran, not just "something rendered": in the console, confirm a network request to `/api/library-font/<id>` returned 200 (read_network_requests), and that `content.font` / `params.font` is a `local:…` token. A font that merely "looks changed" is not proof — the 200 on the route id is.

- [ ] **Step 3: Live hand-check — CSS path (Compositor)**

Open the Compositor, add/select a text layer, open its font picker, **Pangram** tab, pick **PP Mori**. Confirm the layer text renders in PP Mori and that a `<style data-library-font="pangram-pp-mori">` block exists in the DOM (`javascript_tool`: `!!document.querySelector('[data-library-font]')`) and `/api/library-font/…` returned 200. Screenshot both surfaces for the user.

- [ ] **Step 4: Update the dashboard + docs**

Read the LIVE ⛵ State-of-the-Build artifact first (other sessions publish to it), then add the font-library landing. Update `docs/STATE.md` (and ROADMAP if it tracked this). Keep to the standing "update the dashboard on every commit/landing" rule.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/STATE.md docs/ROADMAP.md
git commit -m "docs(state): Pangram/Off-Type font library landed"
```

---

## Self-review notes

- **Spec coverage:** generator (T1–2), manifest (T2), route (T3), catalog (T4), outline world (T5, T8), CSS world (T6, T9), pickers/tabs (T7, T9, T10), testing (each task + T11), gitignore/storage (T2), known overlaps (documented; legacy entries intentionally retained). All spec sections map to a task.
- **Type consistency:** `LibraryFace`/`LibraryFamily`/`LibraryManifest` defined once (T1) and imported everywhere; `faceId`/`familyId` naming stable; token prefix `local:` and route `/api/library-font/<id>` consistent T3/T4/T5; `resolveLibraryFace`/`libraryToken`/`libraryFontUrl`/`libraryFamily` names stable across T4/T5/T6/T8/T9.
- **Ordering caveat (flagged in T4 Step 4):** `library-fonts.ts` imports `setLibraryFaceResolver` from `outlines.ts` (T5). Implement T5 before T4's final wiring, or add the one-line stub noted in T4; T4's test does not exercise the resolver.
- **Verification discipline:** Vue picker tasks pair unit mounts with the T11 live hand-check because synthetic events/hidden-pane renders prove nothing on their own (project memory). The T11 checks assert the route id returned 200, not merely that a face changed.
