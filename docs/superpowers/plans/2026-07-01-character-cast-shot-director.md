# Character Cast for Shot Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durable characters (named reference-image sets, optionally LoRA-linked) castable into Shot Director shots — via canvas wiring or in-editor picker — so every generation of a person uses the same canonical references.

**Architecture:** A JSON registry (`models/characters/<slug>.json`) whose reference images live in the ComfyUI **input dir** (so casting rides the existing `/view` → data-URL chain — zero Python changes). `ShotSheet.cast` (≤3 members) resolves **live** from the registry at compile time via a pure `materializeCast`; the compiler prepends a cast declaration (`Characters: Reva [Image1]; …`). Two editors of one cast list: canvas `CHARACTER` edges (`via:'wire'`) and an in-editor picker (`via:'picker'`). Slice A (Tasks 1–9) ships casting end-to-end with no new canvas nodes; Slice B (Tasks 10–12) adds the Character + Sheet Builder nodes and ShotDirector inputs.

**Tech Stack:** Vue 3 / Nuxt 4 / TypeScript, Vitest; Nitro server routes; existing ideogram-character Replicate rail. **No ComfyUI Python changes.**

## Global Constraints

- Work directly on `main`; do NOT create branches. Stage files with explicit paths only; NEVER `git add -A` (user has parallel WIP).
- Frontend tests: `cd frontend && npx vitest run <files>`; full suite has 3 known unrelated failures (spacetype-palette ×2, gradientfx-mesh ×1). Typecheck: `cd frontend && npx nuxi typecheck 2>&1 | grep -c "error TS"` must stay ≤ 396.
- No violet/purple accents; emerald only for run actions; match the `text-[11px] text-white/50` idiom of ShotDirectorSurface.
- Ref images are ComfyUI-input-dir files; a ref URL is exactly `viewRefUrl(name)` = `/view?filename=<enc>&type=input` (from `~/lib/shotdirector/refUpload`). Never store data URLs in the registry.
- Cast cap: 3 members/shot; per-member ref cap 3; Seedance total image-ref budget = `profile.maxRefImages` (9).
- Money moves ONLY behind explicit buttons with a visible $ label (expansion 4 × $0.08 = `~$0.32`). Live testing stops at inspecting patched widgets — NO real generation and NO paid expansion without explicit user go-ahead.
- Event naming: `comfynext:<name>` CustomEvents on `window`.
- Registry dir: `path.resolve(process.cwd(), '..', 'models', 'characters')`; ComfyUI input dir: `path.resolve(process.cwd(), '..', 'input')` (Nuxt server cwd is `frontend/`, mirroring loras-local).

---

### Task 1: Pure registry helpers — `server/utils/characterRegistry.ts`

**Files:**
- Create: `frontend/server/utils/characterRegistry.ts`
- Test: `frontend/tests/unit/character-registry.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module, `loraPrompt.ts` is the style precedent).
- Produces (Tasks 2/5 rely on these exact names):
  - `interface CharacterRecord { name: string; slug: string; refImages: string[]; coverIndex: number; loraName: string | null; trigger: string | null; notes: string; createdAt: string; updatedAt: string }`
  - `slugifyCharacterName(name: string): string`
  - `parseCharacterRecord(raw: string, slug: string): CharacterRecord | null`
  - `validRefFilename(name: string): boolean`
  - `healRefImages(record: CharacterRecord, exists: (filename: string) => boolean): { record: CharacterRecord; dropped: number }`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/character-registry.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  healRefImages, parseCharacterRecord, slugifyCharacterName, validRefFilename,
  type CharacterRecord,
} from '~~/server/utils/characterRegistry'

function rec(over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    name: 'Reva', slug: 'reva', refImages: ['a.png', 'b.png'], coverIndex: 0,
    loraName: null, trigger: null, notes: '', createdAt: 't', updatedAt: 't', ...over,
  }
}

describe('slugifyCharacterName', () => {
  it('lowercases, hyphenates, strips unsafe chars', () => {
    expect(slugifyCharacterName('Reva Marlowe')).toBe('reva-marlowe')
    expect(slugifyCharacterName('  Dr. Núñez!  ')).toBe('dr-nunez')
  })
  it('returns empty for names with no usable chars', () => {
    expect(slugifyCharacterName('///')).toBe('')
  })
})

describe('parseCharacterRecord', () => {
  it('parses a full record and trusts the given slug over the file field', () => {
    const raw = JSON.stringify(rec({ slug: 'stale-slug' }))
    expect(parseCharacterRecord(raw, 'reva')?.slug).toBe('reva')
  })
  it('defaults missing fields (old/partial records hydrate safely)', () => {
    const r = parseCharacterRecord('{"name":"X"}', 'x')
    expect(r).toMatchObject({ name: 'X', slug: 'x', refImages: [], coverIndex: 0, loraName: null, notes: '' })
  })
  it('returns null for non-objects and invalid JSON', () => {
    expect(parseCharacterRecord('null', 'x')).toBeNull()
    expect(parseCharacterRecord('{bad', 'x')).toBeNull()
  })
  it('drops non-string and path-escaping ref filenames on parse', () => {
    const raw = JSON.stringify({ name: 'X', refImages: ['ok.png', '../evil.png', 5, 'sub/dir.png'] })
    expect(parseCharacterRecord(raw, 'x')?.refImages).toEqual(['ok.png'])
  })
})

describe('validRefFilename', () => {
  it('accepts plain filenames, rejects traversal/separators/empty', () => {
    expect(validRefFilename('char-reva_1.png')).toBe(true)
    expect(validRefFilename('../x.png')).toBe(false)
    expect(validRefFilename('a/b.png')).toBe(false)
    expect(validRefFilename('a\\b.png')).toBe(false)
    expect(validRefFilename('')).toBe(false)
  })
})

describe('healRefImages', () => {
  it('drops refs whose file is gone and clamps coverIndex', () => {
    const { record, dropped } = healRefImages(rec({ coverIndex: 1 }), f => f === 'b.png')
    expect(record.refImages).toEqual(['b.png'])
    expect(record.coverIndex).toBe(0)
    expect(dropped).toBe(1)
  })
  it('no-ops when all files exist', () => {
    const { record, dropped } = healRefImages(rec(), () => true)
    expect(record.refImages).toEqual(['a.png', 'b.png'])
    expect(dropped).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/character-registry.unit.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `frontend/server/utils/characterRegistry.ts`:

```typescript
/**
 * Pure helpers for the character registry (models/characters/<slug>.json).
 * Reference images live in the ComfyUI INPUT dir and records store filenames —
 * a cast ref is exactly `/view?filename=<name>&type=input`, which the Shot
 * Director ref chain already resolves. Pure (fs-free) so it unit-tests like
 * loraPrompt.ts; the endpoints own the IO.
 */

export interface CharacterRecord {
  name: string
  slug: string
  /** Ordered ComfyUI input-dir filenames — the canonical reference sheet. */
  refImages: string[]
  coverIndex: number
  /** Optional link to a trained LoRA sidecar in models/loras (opt-in). */
  loraName: string | null
  trigger: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export function slugifyCharacterName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function validRefFilename(name: string): boolean {
  return typeof name === 'string' && name.length > 0
    && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

export function parseCharacterRecord(raw: string, slug: string): CharacterRecord | null {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const r = obj as Record<string, unknown>
  const refImages = (Array.isArray(r.refImages) ? r.refImages : [])
    .filter((f): f is string => validRefFilename(f as string))
  const cover = typeof r.coverIndex === 'number' ? r.coverIndex : 0
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : slug,
    slug,
    refImages,
    coverIndex: Math.min(Math.max(0, cover), Math.max(0, refImages.length - 1)),
    loraName: typeof r.loraName === 'string' && r.loraName ? r.loraName : null,
    trigger: typeof r.trigger === 'string' && r.trigger ? r.trigger : null,
    notes: typeof r.notes === 'string' ? r.notes : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  }
}

/** Drop refs whose input-dir file vanished (self-healing list). */
export function healRefImages(
  record: CharacterRecord,
  exists: (filename: string) => boolean,
): { record: CharacterRecord, dropped: number } {
  const kept = record.refImages.filter(exists)
  const dropped = record.refImages.length - kept.length
  if (!dropped) return { record, dropped: 0 }
  return {
    record: {
      ...record,
      refImages: kept,
      coverIndex: Math.min(record.coverIndex, Math.max(0, kept.length - 1)),
    },
    dropped,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/character-registry.unit.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/characterRegistry.ts frontend/tests/unit/character-registry.unit.spec.ts
git commit -m "feat(characters): pure registry helpers — record parse/slugify/heal"
```

---

### Task 2: Registry API — `/api/characters-local` GET/POST/PATCH

**Files:**
- Create: `frontend/server/api/characters-local.get.ts`
- Create: `frontend/server/api/characters-local.post.ts`
- Create: `frontend/server/api/characters-local.patch.ts`

**Interfaces:**
- Consumes: Task 1's exports.
- Produces (Tasks 5/7/8/9/12 rely on these):
  - `GET /api/characters-local` → `{ characters: CharacterRecord[] }` (self-healed; healed records are written back)
  - `POST /api/characters-local` body `{ name: string }` → `CharacterRecord` (409 if slug exists, 400 if unusable name)
  - `PATCH /api/characters-local` body `{ slug: string; name?; notes?; loraName?: string|null; trigger?: string|null; refImages?: string[]; coverIndex?: number; remove?: true }` → `{ ok: true }` (404 unknown slug; 400 invalid filenames; `remove: true` deletes the JSON — ref files stay in the input dir)

- [ ] **Step 1: Implement all three endpoints**

Create `frontend/server/api/characters-local.get.ts`:

```typescript
// List castable characters. Records self-heal on read: refs whose input-dir
// file vanished are dropped and the healed record is written back.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { healRefImages, parseCharacterRecord } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async () => {
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  const inputDir = path.resolve(process.cwd(), '..', 'input')
  let files: string[]
  try { files = await fs.readdir(dir) } catch { return { characters: [] } }

  const existing = new Set(await fs.readdir(inputDir).catch(() => [] as string[]))
  const characters = []
  for (const f of files.filter(f => f.endsWith('.json'))) {
    const slug = f.slice(0, -5)
    let parsed
    try { parsed = parseCharacterRecord(await fs.readFile(path.join(dir, f), 'utf8'), slug) }
    catch { continue }
    if (!parsed) continue
    const { record, dropped } = healRefImages(parsed, name => existing.has(name))
    if (dropped) {
      record.updatedAt = new Date().toISOString()
      await fs.writeFile(path.join(dir, f), JSON.stringify(record, null, 2)).catch(() => {})
    }
    characters.push(record)
  }
  characters.sort((a, b) => a.name.localeCompare(b.name))
  return { characters }
})
```

Create `frontend/server/api/characters-local.post.ts`:

```typescript
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { slugifyCharacterName, type CharacterRecord } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { name?: string }
  const name = (body?.name || '').trim()
  const slug = slugifyCharacterName(name)
  if (!name || !slug) throw createError({ statusCode: 400, message: 'A usable character name is required' })

  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${slug}.json`)
  try { await fs.access(file); throw createError({ statusCode: 409, message: `Character '${slug}' already exists` }) }
  catch (e: any) { if (e?.statusCode === 409) throw e }

  const now = new Date().toISOString()
  const record: CharacterRecord = {
    name, slug, refImages: [], coverIndex: 0,
    loraName: null, trigger: null, notes: '', createdAt: now, updatedAt: now,
  }
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return record
})
```

Create `frontend/server/api/characters-local.patch.ts`:

```typescript
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseCharacterRecord, validRefFilename } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    slug?: string, name?: string, notes?: string, loraName?: string | null,
    trigger?: string | null, refImages?: string[], coverIndex?: number, remove?: true,
  }
  const slug = (body?.slug || '').trim()
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid slug' })
  }
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  const file = path.join(dir, `${slug}.json`)
  let record
  try { record = parseCharacterRecord(await fs.readFile(file, 'utf8'), slug) }
  catch { throw createError({ statusCode: 404, message: `No character '${slug}'` }) }
  if (!record) throw createError({ statusCode: 404, message: `No character '${slug}'` })

  if (body.remove === true) {
    // Ref files stay in the input dir — other shots may still point at them.
    await fs.unlink(file)
    return { ok: true }
  }
  if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
  if (typeof body.notes === 'string') record.notes = body.notes
  if (body.loraName !== undefined) record.loraName = body.loraName || null
  if (body.trigger !== undefined) record.trigger = body.trigger || null
  if (Array.isArray(body.refImages)) {
    if (!body.refImages.every(validRefFilename)) {
      throw createError({ statusCode: 400, message: 'Invalid ref filename' })
    }
    record.refImages = body.refImages
  }
  if (typeof body.coverIndex === 'number') {
    record.coverIndex = Math.min(Math.max(0, body.coverIndex), Math.max(0, record.refImages.length - 1))
  }
  record.updatedAt = new Date().toISOString()
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return { ok: true }
})
```

- [ ] **Step 2: Verify with typecheck + curl smoke**

Run: `cd frontend && npx nuxi typecheck 2>&1 | grep -c "error TS"` — expect ≤ 396.
With the dev server running: `curl -s -X POST http://127.0.0.1:3000/api/characters-local -H 'Content-Type: application/json' -d '{"name":"Test Char"}'` → JSON record with `"slug":"test-char"`; `curl -s http://127.0.0.1:3000/api/characters-local` → list containing it; `curl -s -X PATCH … -d '{"slug":"test-char","remove":true}'` → `{"ok":true}`. If no dev server is reachable, note the skip — Task 7's smoke covers it.

- [ ] **Step 3: Commit**

```bash
git add frontend/server/api/characters-local.get.ts frontend/server/api/characters-local.post.ts frontend/server/api/characters-local.patch.ts
git commit -m "feat(characters): registry API — list (self-healing), create, patch/remove"
```

---

### Task 3: Cast core — `ShotSheet.cast`, `Ref.castSlug`, `materializeCast`, `castClause`

**Files:**
- Modify: `frontend/app/lib/shotdirector/types.ts` (Ref + ShotSheet + default)
- Modify: `frontend/app/lib/shotdirector/hydrate.ts` (cast default)
- Create: `frontend/app/lib/shotdirector/cast.ts`
- Test: `frontend/tests/unit/shotdirector-cast.unit.spec.ts`

**Interfaces:**
- Consumes: `Ref`, `ShotSheet`, `ValidationIssue` (existing), `ModelProfile` from `~/lib/shotdirector/profiles`.
- Produces (Tasks 4/6/7/11 rely on these exact names):
  - `types.ts`: `CastMember = { slug: string; name: string; via: 'wire' | 'picker' }`; `ShotSheet.cast: CastMember[]`; `Ref.castSlug?: string`
  - `cast.ts`: `CAST_MAX = 3`, `CAST_REF_CAP = 3`
  - `materializeCast(sheet: ShotSheet, resolved: Record<string, string[]>, profile: ModelProfile): { sheet: ShotSheet; issues: ValidationIssue[] }`
  - `castClause(sheet: ShotSheet, profile: ModelProfile): string` — from cast-tagged image refs, e.g. `Characters: Reva [Image1] [Image2]; Marcus [Image3].` Empty string when no cast refs.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shotdirector-cast.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CAST_MAX, castClause, materializeCast } from '~/lib/shotdirector/cast'
import { hydrateShotSheet } from '~/lib/shotdirector/hydrate'
import { SEEDANCE_PROFILE } from '~/lib/shotdirector/profiles'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

const U = (n: string) => `/view?filename=${n}&type=input`

function sheetWithCast() {
  const s = createDefaultShotSheet()
  s.cast = [
    { slug: 'reva', name: 'Reva', via: 'picker' },
    { slug: 'marcus', name: 'Marcus', via: 'wire' },
  ]
  return s
}

describe('materializeCast', () => {
  it('injects identity-lock refs cast-first and renumbers manual refs after', () => {
    const s = sheetWithCast()
    s.references = [{ kind: 'image', slot: 1, src: U('manual.png'), role: 'style-transfer' }]
    const { sheet } = materializeCast(s, { reva: [U('r1'), U('r2')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const imgs = sheet.references.filter(r => r.kind === 'image')
    expect(imgs.map(r => [r.slot, r.src, r.castSlug ?? null])).toEqual([
      [1, U('r1'), 'reva'], [2, U('r2'), 'reva'], [3, U('m1'), 'marcus'], [4, U('manual.png'), null],
    ])
    expect(imgs[0]!.role).toBe('identity-lock')
  })

  it('caps refs per member at 3', () => {
    const s = sheetWithCast()
    s.cast = [s.cast[0]!]
    const { sheet } = materializeCast(s, { reva: [U('1'), U('2'), U('3'), U('4')] }, SEEDANCE_PROFILE)
    expect(sheet.references.filter(r => r.castSlug === 'reva')).toHaveLength(3)
  })

  it('is idempotent — re-materializing replaces cast refs, never duplicates', () => {
    const s = sheetWithCast()
    const once = materializeCast(s, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE).sheet
    const twice = materializeCast(once, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE).sheet
    expect(twice.references).toHaveLength(2)
  })

  it('squeezes per-member caps when manual refs crowd the budget, min 1, with a warning', () => {
    const s = sheetWithCast()
    s.references = Array.from({ length: 5 }, (_, i) => ({
      kind: 'image' as const, slot: i + 1, src: U(`man${i}`), role: 'style-transfer' as const,
    }))
    // budget 9 − 5 manual = 4; 2 members → floor(4/2)=2 each
    const { sheet, issues } = materializeCast(s, { reva: [U('1'), U('2'), U('3')], marcus: [U('4'), U('5'), U('6')] }, SEEDANCE_PROFILE)
    expect(sheet.references.filter(r => r.castSlug === 'reva')).toHaveLength(2)
    expect(issues.some(i => i.level === 'warning' && i.code === 'cast-refs-squeezed')).toBe(true)
  })

  it('errors on a member with zero resolved refs and on unknown slugs', () => {
    const s = sheetWithCast()
    const { issues } = materializeCast(s, { reva: [] }, SEEDANCE_PROFILE)
    const errs = issues.filter(i => i.level === 'error' && i.code === 'cast-member-no-refs')
    expect(errs).toHaveLength(2) // reva empty + marcus missing entirely
    expect(errs[0]!.message).toContain('Reva')
  })

  it('errors on duplicates and on more than CAST_MAX members', () => {
    const s = createDefaultShotSheet()
    s.cast = [
      { slug: 'a', name: 'A', via: 'picker' }, { slug: 'a', name: 'A', via: 'wire' },
      { slug: 'b', name: 'B', via: 'picker' }, { slug: 'c', name: 'C', via: 'picker' },
      { slug: 'd', name: 'D', via: 'picker' },
    ]
    const { issues } = materializeCast(s, { a: [U('1')], b: [U('2')], c: [U('3')], d: [U('4')] }, SEEDANCE_PROFILE)
    expect(issues.some(i => i.code === 'cast-duplicate')).toBe(true)
    expect(issues.some(i => i.code === 'cast-too-many')).toBe(true)
    expect(CAST_MAX).toBe(3)
  })
})

describe('castClause', () => {
  it('names each member with their bracket tags in slot order', () => {
    const s = sheetWithCast()
    const { sheet } = materializeCast(s, { reva: [U('r1'), U('r2')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    expect(castClause(sheet, SEEDANCE_PROFILE)).toBe('Characters: Reva [Image1] [Image2]; Marcus [Image3].')
  })
  it('is empty with no cast refs', () => {
    expect(castClause(createDefaultShotSheet(), SEEDANCE_PROFILE)).toBe('')
  })
})

describe('hydrate back-compat', () => {
  it('old sheets without cast hydrate to []', () => {
    expect(hydrateShotSheet({ subject: 'x' }).cast).toEqual([])
  })
  it('cast entries survive hydration', () => {
    const cast = [{ slug: 'reva', name: 'Reva', via: 'picker' }]
    expect(hydrateShotSheet({ cast }).cast).toEqual(cast)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast.unit.spec.ts`
Expected: FAIL — `~/lib/shotdirector/cast` missing; `cast` not on ShotSheet.

- [ ] **Step 3: Implement**

In `frontend/app/lib/shotdirector/types.ts`:
- Add to `Ref`: `/** set when this ref was injected from a cast member — materializeCast owns these. */ castSlug?: string`
- Add above `ShotSheet`: `export interface CastMember { slug: string; name: string; via: 'wire' | 'picker' }`
- Add to `ShotSheet` (after `constraints`): `cast: CastMember[]`
- In `createDefaultShotSheet()` add `cast: [],`

In `frontend/app/lib/shotdirector/hydrate.ts`, inside the returned object (after `constraints`):

```typescript
    cast: arr<ShotSheet['cast'][number]>(r.cast).filter(c =>
      c && typeof c.slug === 'string' && typeof c.name === 'string'
      && (c.via === 'wire' || c.via === 'picker')),
```

Create `frontend/app/lib/shotdirector/cast.ts`:

```typescript
/**
 * Cast materialization: turn `sheet.cast` (live registry links) into concrete
 * identity-lock image references, cast-first so [Image1] is always cast
 * member #1. Pure — the caller resolves slugs → ref URLs (useCharacters).
 * Cast-injected refs carry `castSlug`; re-materializing replaces them, so the
 * operation is idempotent and manual refs are preserved and renumbered.
 */
import type { ModelProfile } from '~/lib/shotdirector/profiles'
import type { Ref, ShotSheet } from '~/lib/shotdirector/types'
import type { ValidationIssue } from '~/lib/shotdirector/rules'

export const CAST_MAX = 3
export const CAST_REF_CAP = 3

export function materializeCast(
  sheet: ShotSheet,
  resolved: Record<string, string[]>,
  profile: ModelProfile,
): { sheet: ShotSheet, issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const manual = sheet.references.filter(r => !r.castSlug)
  if (!sheet.cast.length) {
    return { sheet: { ...sheet, references: renumber(manual) }, issues }
  }

  const seen = new Set<string>()
  for (const m of sheet.cast) {
    if (seen.has(m.slug)) issues.push({ level: 'error', code: 'cast-duplicate', message: `${m.name} is cast twice.` })
    seen.add(m.slug)
  }
  if (sheet.cast.length > CAST_MAX) {
    issues.push({ level: 'error', code: 'cast-too-many', message: `At most ${CAST_MAX} characters per shot.` })
  }

  const members = sheet.cast.filter((m, i) => sheet.cast.findIndex(x => x.slug === m.slug) === i)
  const manualImages = manual.filter(r => r.kind === 'image').length
  const budget = Math.max(0, profile.maxRefImages - manualImages)
  const perMember = Math.min(CAST_REF_CAP, Math.max(1, Math.floor(budget / Math.max(1, members.length))))
  if (perMember < CAST_REF_CAP && members.some(m => (resolved[m.slug] ?? []).length > perMember)) {
    issues.push({
      level: 'warning', code: 'cast-refs-squeezed',
      message: `Manual references crowd the ${profile.maxRefImages}-image budget — cast members are limited to ${perMember} reference(s) each.`,
    })
  }

  const castRefs: Ref[] = []
  for (const m of members) {
    const srcs = (resolved[m.slug] ?? []).slice(0, perMember)
    if (!srcs.length) {
      issues.push({ level: 'error', code: 'cast-member-no-refs', message: `${m.name} has no reference photos — add some to their character sheet.` })
      continue
    }
    for (const src of srcs) {
      castRefs.push({ kind: 'image', slot: 0, src, role: 'identity-lock', castSlug: m.slug })
    }
  }
  return { sheet: { ...sheet, references: renumber([...castRefs, ...manual]) }, issues }
}

/** Reassign 1-based slots per kind, preserving array order. */
function renumber(refs: Ref[]): Ref[] {
  const counters: Record<string, number> = {}
  return refs.map((r) => {
    counters[r.kind] = (counters[r.kind] ?? 0) + 1
    return { ...r, slot: counters[r.kind]! }
  })
}

/** "Characters: Reva [Image1] [Image2]; Marcus [Image3]." from cast-tagged refs. */
export function castClause(sheet: ShotSheet, profile: ModelProfile): string {
  const bySlug = new Map<string, string[]>()
  for (const r of sheet.references) {
    if (r.kind !== 'image' || !r.castSlug) continue
    const tags = bySlug.get(r.castSlug) ?? []
    tags.push(profile.refTag('image', r.slot))
    bySlug.set(r.castSlug, tags)
  }
  if (!bySlug.size) return ''
  const parts = sheet.cast
    .filter(m => bySlug.has(m.slug))
    .map(m => `${m.name} ${bySlug.get(m.slug)!.join(' ')}`)
  return `Characters: ${parts.join('; ')}.`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-dispatch.unit.spec.ts tests/unit/shotdirector-composable.unit.spec.ts`
Expected: ALL PASS (existing suites prove the additive fields broke nothing).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/types.ts frontend/app/lib/shotdirector/hydrate.ts frontend/app/lib/shotdirector/cast.ts frontend/tests/unit/shotdirector-cast.unit.spec.ts
git commit -m "feat(character-cast): cast core — ShotSheet.cast, materializeCast, castClause"
```

---

### Task 4: Compiler integration — cast clause in the compiled prompt

**Files:**
- Modify: `frontend/app/lib/shotdirector/compile.ts` (`compileShot` only)
- Test: extend `frontend/tests/unit/shotdirector-cast.unit.spec.ts`

**Interfaces:**
- Consumes: `castClause` (Task 3).
- Produces: `compileShot` output whose `prompt` begins with the cast clause when cast refs are present. Signature unchanged: `compileShot(sheet, profile): CompileResult`.

- [ ] **Step 1: Write the failing test** (append to `shotdirector-cast.unit.spec.ts`)

```typescript
import { compileShot } from '~/lib/shotdirector/compile'

describe('compileShot cast integration', () => {
  it('prepends the cast clause to the compiled prompt and counts it in the word budget', () => {
    const s = sheetWithCast()
    s.subject = 'two friends'
    s.action = 'walk along a pier'
    const { sheet } = materializeCast(s, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const res = compileShot(sheet, SEEDANCE_PROFILE)
    expect(res.prompt.startsWith('Characters: Reva [Image1]; Marcus [Image2].')).toBe(true)
    expect(res.prompt).toContain('two friends')
  })
  it('prompt is unchanged for sheets with no cast', () => {
    const s = createDefaultShotSheet()
    s.subject = 'a lighthouse'
    s.action = 'stands in fog'
    expect(compileShot(s, SEEDANCE_PROFILE).prompt.startsWith('Characters:')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast.unit.spec.ts`
Expected: the two new tests FAIL (no clause in prompt).

- [ ] **Step 3: Implement**

In `frontend/app/lib/shotdirector/compile.ts`, add the import and change `compileShot`'s prompt assembly (the function currently does `const prompt = buildPrompt(sheet, profile)`):

```typescript
import { castClause } from '~/lib/shotdirector/cast'
```

```typescript
  const clause = castClause(sheet, profile)
  const base = buildPrompt(sheet, profile)
  const prompt = clause ? `${clause} ${base}` : base
```

(Word budget and `buildInput` flow through unchanged — `countWords(prompt)` already runs on the final string.)

- [ ] **Step 4: Run to verify pass + regressions**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-composable.unit.spec.ts tests/unit/shotdirector-dispatch.unit.spec.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/compile.ts frontend/tests/unit/shotdirector-cast.unit.spec.ts
git commit -m "feat(character-cast): compiled prompt opens with the cast declaration"
```

---

### Task 5: `useCharacters` composable — cached registry client

**Files:**
- Create: `frontend/app/composables/useCharacters.ts`
- Test: `frontend/tests/unit/characters-composable.unit.spec.ts`

**Interfaces:**
- Consumes: `GET /api/characters-local` (Task 2), `viewRefUrl` from `~/lib/shotdirector/refUpload`, `CharacterRecord` shape (structural — declare a local interface, do NOT import from `~~/server` into app code).
- Produces (Tasks 6/7/9/10/12 rely on these):
  - `useCharacters()` → `{ characters: Ref<CharacterClient[]>, loading: Ref<boolean>, refresh(): Promise<void>, resolveRefs(slugs: string[]): Record<string, string[]>, coverUrl(c: CharacterClient): string | null }`
  - `CharacterClient = { name: string; slug: string; refImages: string[]; coverIndex: number; loraName: string | null; trigger: string | null; notes: string }`
  - Refreshes on window event **`comfynext:charactersChanged`** — every mutating path (panel, save-as-character, sheet node) MUST dispatch it after a successful write.
  - Module-level shared state (one fetch per app, all consumers share the same refs) — same pattern as other `useX` singletons.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/characters-composable.unit.spec.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'

const REVA = { name: 'Reva', slug: 'reva', refImages: ['r1.png', 'r2.png'], coverIndex: 1, loraName: null, trigger: null, notes: '' }

describe('useCharacters', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('fetches once, resolves refs to /view URLs, and computes coverUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh, resolveRefs, coverUrl } = useCharacters()
    await refresh()
    expect(characters.value).toHaveLength(1)
    expect(resolveRefs(['reva', 'ghost'])).toEqual({
      reva: ['/view?filename=r1.png&type=input', '/view?filename=r2.png&type=input'],
      ghost: [],
    })
    expect(coverUrl(characters.value[0]!)).toBe('/view?filename=r2.png&type=input')
  })

  it('survives a failed fetch (offline) with an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh } = useCharacters()
    await refresh()
    expect(characters.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/characters-composable.unit.spec.ts`
Expected: FAIL — composable missing.

- [ ] **Step 3: Implement**

Create `frontend/app/composables/useCharacters.ts`:

```typescript
/**
 * Cached client for the character registry. Module-level shared state: one
 * fetch feeds every consumer (surface, picker, panel, canvas nodes). Any code
 * that mutates the registry must dispatch `comfynext:charactersChanged` so
 * every view refreshes.
 */
import { ref } from 'vue'
import { viewRefUrl } from '~/lib/shotdirector/refUpload'

export interface CharacterClient {
  name: string
  slug: string
  refImages: string[]
  coverIndex: number
  loraName: string | null
  trigger: string | null
  notes: string
}

const characters = ref<CharacterClient[]>([])
const loading = ref(false)
let fetchedOnce = false
let listenerBound = false

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const res = await fetch('/api/characters-local')
    if (res.ok) {
      const data = await res.json() as { characters?: CharacterClient[] }
      characters.value = data.characters ?? []
    }
  } catch { /* offline — keep last known list */ }
  finally { fetchedOnce = true; loading.value = false }
}

export function useCharacters() {
  if (!listenerBound && typeof window !== 'undefined') {
    listenerBound = true
    window.addEventListener('comfynext:charactersChanged', () => { void refresh() })
  }
  if (!fetchedOnce && typeof window !== 'undefined') void refresh()

  function resolveRefs(slugs: string[]): Record<string, string[]> {
    const bySlug = new Map(characters.value.map(c => [c.slug, c]))
    const out: Record<string, string[]> = {}
    for (const slug of slugs) {
      out[slug] = (bySlug.get(slug)?.refImages ?? []).map(viewRefUrl)
    }
    return out
  }

  function coverUrl(c: CharacterClient): string | null {
    const f = c.refImages[c.coverIndex] ?? c.refImages[0]
    return f ? viewRefUrl(f) : null
  }

  return { characters, loading, refresh, resolveRefs, coverUrl }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/characters-composable.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCharacters.ts frontend/tests/unit/characters-composable.unit.spec.ts
git commit -m "feat(character-cast): useCharacters — cached registry client + charactersChanged refresh"
```

---

### Task 6: `useShotDirector` cast API + materialize-in-result

**Files:**
- Modify: `frontend/app/composables/useShotDirector.ts`
- Test: extend `frontend/tests/unit/shotdirector-composable.unit.spec.ts`

**Interfaces:**
- Consumes: `materializeCast` (Task 3); existing composable signature `useShotDirector(initial, persist)`.
- Produces (Task 7 relies on these):
  - New third param: `useShotDirector(initial, persist, resolveCast?: (slugs: string[]) => Record<string, string[]>)`
  - `result` computed now = `compileShot(materialized.sheet)` with `issues` = `[...castIssues, ...compileIssues]`
  - New returns: `addCastMember(slug: string, name: string, via?: 'wire' | 'picker'): void` (default `'picker'`; no-op if slug already cast), `removeCastMember(slug: string): void`
  - `sheet.cast` persists via the existing `update()`/`persist` path (the persisted sheet stores `cast` and MANUAL references only — materialized cast refs are recomputed, never persisted; strip `castSlug` refs in `persist`-bound updates by materializing only inside `result`).

- [ ] **Step 1: Write the failing tests** (append to `shotdirector-composable.unit.spec.ts`)

```typescript
import { materializeCast } from '~/lib/shotdirector/cast'

describe('useShotDirector cast', () => {
  const U = (n: string) => `/view?filename=${n}&type=input`

  it('addCastMember persists cast and result materializes refs + clause', () => {
    let persisted: ShotSheet | undefined
    const resolve = (slugs: string[]) => Object.fromEntries(slugs.map(s => [s, [U(`${s}.png`)]]))
    const { sheet, result, addCastMember } = useShotDirector(createDefaultShotSheet(), (s) => { persisted = s }, resolve)

    addCastMember('reva', 'Reva')
    expect(sheet.value.cast).toEqual([{ slug: 'reva', name: 'Reva', via: 'picker' }])
    expect(persisted?.cast).toHaveLength(1)
    // persisted sheet holds NO materialized cast refs
    expect(persisted?.references.some(r => r.castSlug)).toBe(false)
    // but the compiled result does
    expect(result.value.prompt).toContain('Characters: Reva [Image1].')
  })

  it('addCastMember dedupes; removeCastMember removes', () => {
    const { sheet, addCastMember, removeCastMember } = useShotDirector(createDefaultShotSheet(), () => {}, () => ({}))
    addCastMember('reva', 'Reva')
    addCastMember('reva', 'Reva', 'wire')
    expect(sheet.value.cast).toHaveLength(1)
    removeCastMember('reva')
    expect(sheet.value.cast).toHaveLength(0)
  })

  it('zero-ref cast member surfaces as an error issue in result', () => {
    const { result, addCastMember } = useShotDirector(createDefaultShotSheet(), () => {}, () => ({ reva: [] }))
    addCastMember('reva', 'Reva')
    expect(result.value.issues.some(i => i.code === 'cast-member-no-refs' && i.level === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-composable.unit.spec.ts`
Expected: new tests FAIL (no third param / no cast API).

- [ ] **Step 3: Implement**

In `frontend/app/composables/useShotDirector.ts`:
- Signature: `export function useShotDirector(initial: unknown, persist: (sheet: ShotSheet) => void, resolveCast?: (slugs: string[]) => Record<string, string[]>)`
- Import `materializeCast` from `~/lib/shotdirector/cast`.
- Replace the `result` computed body (currently `compileShot(sheet.value, profile)`):

```typescript
  const result = computed(() => {
    const s = sheet.value
    if (!s.cast.length || !resolveCast) {
      return compileShot(s, profile)
    }
    const resolved = resolveCast(s.cast.map(m => m.slug))
    const { sheet: materialized, issues: castIssues } = materializeCast(s, resolved, profile)
    const compiled = compileShot(materialized, profile)
    return { ...compiled, issues: [...castIssues, ...compiled.issues] }
  })
```

- Add and export:

```typescript
  function addCastMember(slug: string, name: string, via: 'wire' | 'picker' = 'picker') {
    if (sheet.value.cast.some(m => m.slug === slug)) return
    update(s => ({ ...s, cast: [...s.cast, { slug, name, via }] }))
  }
  function removeCastMember(slug: string) {
    update(s => ({ ...s, cast: s.cast.filter(m => m.slug !== slug) }))
  }
```

Add both to the return object. (The persisted sheet never contains materialized refs because materialization happens only inside `result` — `update()` mutators operate on the raw sheet.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-composable.unit.spec.ts tests/unit/shotdirector-cast.unit.spec.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useShotDirector.ts frontend/tests/unit/shotdirector-composable.unit.spec.ts
git commit -m "feat(character-cast): useShotDirector cast API + materialized result"
```

---

### Task 7: Generate-path resolution + Cast section UI + picker modal

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`handleShotDirectorGenerate`)
- Modify: `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` (Cast section; pass `resolveCast` into `useShotDirector`)
- Create: `frontend/app/components/vue-canvas/CharacterPickerModal.vue`

**Interfaces:**
- Consumes: `useCharacters` (Task 5), `materializeCast` (Task 3), composable cast API (Task 6).
- Produces: the Generate path materializes cast before compiling; the surface Cast section (chips + "+ Cast" picker). `CharacterPickerModal` props `{ excludeSlugs: string[] }`, emits `{ pick: [slug: string, name: string], close: [] }`.

- [ ] **Step 1: Wire the canvas Generate handler**

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, `handleShotDirectorGenerate`: make it `async`, and after `const sheet = hydrateShotSheet(...)` replace the compile block:

```typescript
  let effectiveSheet = sheet
  let castIssues: import('~/lib/shotdirector/rules').ValidationIssue[] = []
  if (sheet.cast.length) {
    // Live link: resolve cast refs from the registry at generate time.
    let resolved: Record<string, string[]> = {}
    try {
      const res = await fetch('/api/characters-local')
      const data = res.ok ? await res.json() as { characters?: { slug: string, refImages: string[] }[] } : {}
      const bySlug = new Map((data.characters ?? []).map(c => [c.slug, c]))
      resolved = Object.fromEntries(sheet.cast.map(m => [
        m.slug, (bySlug.get(m.slug)?.refImages ?? []).map(f => `/view?${new URLSearchParams({ filename: f, type: 'input' })}`),
      ]))
    } catch { /* resolved stays empty → zero-ref errors below */ }
    const mat = materializeCast(sheet, resolved, getProfile('seedance-2.0'))
    effectiveSheet = mat.sheet
    castIssues = mat.issues
  }
  const result = compileShot(effectiveSheet, getProfile('seedance-2.0'))
  const errors = [...castIssues, ...result.issues].filter(i => i.level === 'error')
```

…and pass `effectiveSheet` (not `sheet`) to `buildFilmShotPatch(effectiveSheet, result)`. Add the import: `import { materializeCast } from '~/lib/shotdirector/cast'`. (The listener registration already handles async handlers — `addEventListener` ignores the returned promise.)

- [ ] **Step 2: Create the picker modal**

Create `frontend/app/components/vue-canvas/CharacterPickerModal.vue` (leaner sibling of `LoraGalleryModal.vue`):

```vue
<script setup lang="ts">
// Cast picker: choose a character from the registry. Emits pick(slug, name);
// the caller owns adding it to sheet.cast.
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useCharacters, type CharacterClient } from '~/composables/useCharacters'

const props = defineProps<{ excludeSlugs: string[] }>()
const emit = defineEmits<{ pick: [slug: string, name: string], close: [] }>()

const { characters, loading, coverUrl, refresh } = useCharacters()
void refresh()
const q = ref('')
const visible = computed<CharacterClient[]>(() => {
  const query = q.value.trim().toLowerCase()
  return characters.value
    .filter(c => !props.excludeSlugs.includes(c.slug))
    .filter(c => !query || c.name.toLowerCase().includes(query))
})
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="w-[520px] max-h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-[#111] p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[13px] font-medium text-white/90">Cast a character</h3>
        <button class="text-white/40 hover:text-white/80" @click="emit('close')"><X :size="14" /></button>
      </div>
      <input
        v-model="q" placeholder="Search characters…"
        class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
      >
      <div class="grid grid-cols-3 gap-2 overflow-y-auto">
        <button
          v-for="c in visible" :key="c.slug"
          class="group rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left hover:border-white/25"
          @click="emit('pick', c.slug, c.name)"
        >
          <div class="aspect-square w-full overflow-hidden rounded bg-white/[0.05]">
            <img v-if="coverUrl(c)" :src="coverUrl(c)!" class="h-full w-full object-cover" :alt="c.name">
          </div>
          <div class="mt-1.5 truncate text-[12px] text-white/85">{{ c.name }}</div>
          <div class="text-[10px] text-white/40">{{ c.refImages.length }} reference{{ c.refImages.length === 1 ? '' : 's' }}</div>
        </button>
      </div>
      <p v-if="!loading && !visible.length" class="py-6 text-center text-[11px] text-white/40">
        No castable characters yet — create one in the Characters panel or save one from any image.
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add the Cast section to the surface**

In `frontend/app/components/vue-canvas/ShotDirectorSurface.vue`:
- Pass the resolver: where `useShotDirector(...)` is called, add third arg using `useCharacters`:

```typescript
const { resolveRefs, coverUrl, characters } = useCharacters()
const { sheet, result, addReference, removeReference, update, rerollSeed, addCastMember, removeCastMember }
  = useShotDirector(/* existing args */, slugs => resolveRefs(slugs))
```

- Above the existing References block (the `IMAGES ≤9` rail), add the Cast section:

```vue
<!-- Cast: registry-linked characters; refs materialize at compile time -->
<div class="mb-3">
  <div class="mb-1.5 flex items-center justify-between">
    <span class="text-[11px] font-medium uppercase tracking-wide text-white/50">Cast <span class="normal-case">≤3</span></span>
    <button
      class="rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40"
      :disabled="sheet.cast.length >= 3"
      @click="castPickerOpen = true"
    >+ Cast</button>
  </div>
  <div v-if="sheet.cast.length" class="flex flex-wrap gap-1.5">
    <span
      v-for="m in sheet.cast" :key="m.slug"
      class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] py-0.5 pl-0.5 pr-2 text-[11px] text-white/80"
    >
      <img v-if="castCover(m.slug)" :src="castCover(m.slug)!" class="h-5 w-5 rounded-full object-cover" :alt="m.name">
      {{ m.name }}
      <span v-if="m.via === 'wire'" class="text-[9px] text-white/35" title="Cast by canvas wire — remove by unwiring or here">⌁</span>
      <button class="text-white/35 hover:text-white/80" @click="onRemoveCast(m)">×</button>
    </span>
  </div>
  <p v-else class="text-[11px] text-white/30">No cast — the shot uses manual references only.</p>
</div>

<CharacterPickerModal
  v-if="castPickerOpen"
  :exclude-slugs="sheet.cast.map(m => m.slug)"
  @pick="(slug, name) => { addCastMember(slug, name); castPickerOpen = false }"
  @close="castPickerOpen = false"
/>
```

- Script additions:

```typescript
import CharacterPickerModal from '~/components/vue-canvas/CharacterPickerModal.vue'
import type { CastMember } from '~/lib/shotdirector/types'

const castPickerOpen = ref(false)
function castCover(slug: string): string | null {
  const c = characters.value.find(x => x.slug === slug)
  return c ? coverUrl(c) : null
}
function onRemoveCast(m: CastMember) {
  if (m.via === 'wire') {
    // One gesture, both representations: ask the canvas to drop the edge;
    // the edge-sync (Slice B Task 11) removes the cast entry. Until Task 11
    // lands, fall through to direct removal.
    window.dispatchEvent(new CustomEvent('comfynext:uncastCharacter', { detail: { nodeId: props.nodeId, slug: m.slug } }))
  }
  removeCastMember(m.slug)
}
```

(Existing error-issue display + Generate disabling already key off `result.issues` — cast errors flow through with no further wiring.)

- [ ] **Step 4: Verify — suites, typecheck, browser smoke**

Run: `cd frontend && npx vitest run` (known 3 unrelated failures only) and `npx nuxi typecheck 2>&1 | grep -c "error TS"` ≤ 396.
Browser (dev server + preview): create a character via curl or the API, PATCH one uploaded ref filename in, open Shot Director → Cast → pick it → compiled preview shows `Characters: … [Image1].` and Generate stays enabled; remove the ref (PATCH `refImages: []`) → preview shows the zero-refs error and Generate disables. **Do NOT click Generate through to a run.**

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/ShotDirectorSurface.vue frontend/app/components/vue-canvas/CharacterPickerModal.vue
git commit -m "feat(character-cast): cast section + picker + live resolution on Generate"
```

---

### Task 8: "Save as character" on image artifacts

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue`

**Interfaces:**
- Consumes: `uploadRefFile` from `~/lib/shotdirector/refUpload`; Task 2's POST/PATCH; the node's `data.images[0]` URL (existing).
- Produces: an action that creates a registry character with the image as `refImages[0]`, then dispatches `comfynext:charactersChanged`.

- [ ] **Step 1: Implement the action**

In `ArtifactImageNode.vue`, alongside the existing action functions (`openInpaint` etc.):

```typescript
import { uploadRefFile } from '~/lib/shotdirector/refUpload'

async function saveAsCharacter() {
  const src = (props.data as any)?.images?.[0]
  if (!src) return
  const name = window.prompt('Character name')?.trim()
  if (!name) return
  try {
    const blob = await (await fetch(src)).blob()
    const refUrl = await uploadRefFile(new File([blob], 'character.png', { type: blob.type || 'image/png' }))
    const filename = new URLSearchParams(refUrl.split('?')[1]).get('filename')!
    const created = await fetch('/api/characters-local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (!created.ok) throw new Error(`create ${created.status}`)
    const { slug } = await created.json() as { slug: string }
    await fetch('/api/characters-local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, refImages: [filename] }),
    })
    window.dispatchEvent(new CustomEvent('comfynext:charactersChanged'))
  } catch (e) {
    console.warn('[saveAsCharacter]', e)
  }
}
```

Add the button where the node's other secondary actions live (match the surrounding action-button idiom in the file — icon `Drama` from `lucide-vue-next`, title "Save as character").

- [ ] **Step 2: Verify**

`cd frontend && npx nuxi typecheck 2>&1 | grep -c "error TS"` ≤ 396. Browser: generate/open any image artifact → Save as character → name it → `curl -s http://127.0.0.1:3000/api/characters-local` lists it with one ref.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(character-cast): save-as-character action on image artifacts"
```

---

### Task 9: Characters panel — castable section + minimal sheet editor

**Files:**
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue`

**Interfaces:**
- Consumes: `useCharacters` (Task 5), Task 2 API, `uploadRefFile`.
- Produces: panel section listing registry characters with an inline sheet editor (ref grid: add via file input → `uploadRefFile` → PATCH; remove; set cover; delete character; "New character"); a "make castable" button on LoRA characters lacking a registry record (creates one with `loraName`/`trigger` linked). All mutations dispatch `comfynext:charactersChanged`.

- [ ] **Step 1: Implement**

At the top of `CharacterLibraryPanel.vue`'s content (above the trained-LoRA section), add a "Castable characters" section. Script additions:

```typescript
import { useCharacters, type CharacterClient } from '~/composables/useCharacters'
import { uploadRefFile } from '~/lib/shotdirector/refUpload'

const { characters: castChars, coverUrl, refresh: refreshChars } = useCharacters()
const expandedSlug = ref<string | null>(null)
const refFileInput = ref<HTMLInputElement | null>(null)

function changed() { window.dispatchEvent(new CustomEvent('comfynext:charactersChanged')) }

async function createCharacter() {
  const name = window.prompt('Character name')?.trim()
  if (!name) return
  const res = await fetch('/api/characters-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  if (res.ok) { changed(); expandedSlug.value = (await res.json()).slug }
}

async function patchChar(slug: string, patch: Record<string, unknown>) {
  await fetch('/api/characters-local', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...patch }),
  })
  changed()
}

async function addRefFiles(c: CharacterClient, e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  const names: string[] = []
  for (const f of files) {
    try {
      const url = await uploadRefFile(f)
      names.push(new URLSearchParams(url.split('?')[1]).get('filename')!)
    } catch { /* skip failed upload */ }
  }
  if (names.length) await patchChar(c.slug, { refImages: [...c.refImages, ...names] })
  ;(e.target as HTMLInputElement).value = ''
}

async function removeRef(c: CharacterClient, idx: number) {
  await patchChar(c.slug, { refImages: c.refImages.filter((_, i) => i !== idx) })
}

async function deleteCharacter(c: CharacterClient) {
  if (!window.confirm(`Delete character “${c.name}”? Shots casting them will show an error.`)) return
  await patchChar(c.slug, { remove: true })
}

/** LoRA character (kind==='character') without a registry record → create + link. */
async function makeCastable(lora: { name: string, filename: string, trigger: string | null }) {
  const res = await fetch('/api/characters-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: lora.name }),
  })
  if (!res.ok) return
  const { slug } = await res.json() as { slug: string }
  await patchChar(slug, { loraName: lora.filename, trigger: lora.trigger })
  expandedSlug.value = slug
}
```

Template section (match the panel's existing card/section idiom):

```vue
<div class="mb-4">
  <div class="mb-2 flex items-center justify-between">
    <h4 class="text-[11px] font-medium uppercase tracking-wide text-white/50">Castable characters</h4>
    <button class="rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 hover:bg-white/10" @click="createCharacter">New</button>
  </div>
  <div v-for="c in castChars" :key="c.slug" class="mb-1.5 rounded-lg border border-white/10 bg-white/[0.03]">
    <button class="flex w-full items-center gap-2 p-2 text-left" @click="expandedSlug = expandedSlug === c.slug ? null : c.slug">
      <img v-if="coverUrl(c)" :src="coverUrl(c)!" class="h-8 w-8 rounded object-cover" :alt="c.name">
      <div v-else class="h-8 w-8 rounded bg-white/[0.06]" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] text-white/85">{{ c.name }}</div>
        <div class="text-[10px] text-white/40">{{ c.refImages.length }} refs{{ c.loraName ? ' · LoRA-linked' : '' }}</div>
      </div>
    </button>
    <div v-if="expandedSlug === c.slug" class="border-t border-white/[0.06] p-2">
      <div class="grid grid-cols-4 gap-1.5">
        <div v-for="(f, i) in c.refImages" :key="f" class="group relative aspect-square overflow-hidden rounded">
          <img :src="`/view?filename=${encodeURIComponent(f)}&type=input`" class="h-full w-full object-cover">
          <button
            class="absolute right-0.5 top-0.5 hidden rounded bg-black/70 px-1 text-[10px] text-white/80 group-hover:block"
            @click="removeRef(c, i)"
          >×</button>
          <button
            v-if="i !== c.coverIndex"
            class="absolute bottom-0.5 left-0.5 hidden rounded bg-black/70 px-1 text-[9px] text-white/70 group-hover:block"
            @click="patchChar(c.slug, { coverIndex: i })"
          >cover</button>
        </div>
        <label class="flex aspect-square cursor-pointer items-center justify-center rounded border border-dashed border-white/15 text-[16px] text-white/40 hover:border-white/30">
          +<input ref="refFileInput" type="file" accept="image/*" multiple class="hidden" @change="addRefFiles(c, $event)">
        </label>
      </div>
      <div class="mt-2 flex justify-end">
        <button class="text-[10px] text-white/35 hover:text-red-400/80" @click="deleteCharacter(c)">Delete character</button>
      </div>
    </div>
  </div>
  <p v-if="!castChars.length" class="text-[11px] text-white/30">None yet — “New”, or save one from any image on the canvas.</p>
</div>
```

On the existing trained-LoRA character cards, add a small "Make castable" button (calls `makeCastable(lora)`) shown when no `castChars` entry has `loraName === lora.filename`.

- [ ] **Step 2: Verify**

Typecheck ≤ 396; browser: New → upload 2 photos → grid shows them; set cover; remove one; picker modal (Task 7) shows the character with cover; Delete removes it and the picker updates without reload (the event refresh).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/CharacterLibraryPanel.vue
git commit -m "feat(character-cast): panel — castable characters section + minimal sheet editor + make-castable"
```

**Slice A complete — casting works end-to-end (registry → picker → materialized refs → compiled cast clause → Generate).**

---

### Task 10: Slice B — `CHARACTER` port, Character node, ShotDirector cast inputs

**Files:**
- Create: `frontend/app/components/vue-canvas/CharacterNode.vue`
- Modify: `frontend/app/composables/useVueNodes.ts` (nodeType map entry)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (nodeTypes registration + `createNodeData` synthesis)
- Modify: `frontend/app/components/vue-canvas/ShotDirectorNode.vue` (render 3 `CHARACTER` input handles)
- Modify: `frontend/app/data/toolbox-items.ts` (Add-menu entry)

**Interfaces:**
- Consumes: `useCharacters` (Task 5); node registration idioms (`useVueNodes.ts` `ShotDirector: 'shot-director'` line; `nodeTypes` map at VueNodeCanvas.vue ~:169; synthesis block ~:1380).
- Produces (Task 11/12 rely on these):
  - nodeType `'Character'` ↔ vueFlowType `'character'`; node data `properties.comfynext_characterSlug: string` + `comfynext_characterName: string`
  - Character node outputs: `[{ name: 'character', type: 'CHARACTER', links: null }]`
  - ShotDirector inputs: `[{ name: 'cast_1', type: 'CHARACTER', link: null, optional: true }, … cast_2, cast_3]`
  - Both cards render handles via the `Handle` idiom used by studio nodes (`ComfyNodePort` / direct `Handle` with `id="output-0"` / `id="input-<i>"`).

- [ ] **Step 1: Registrations**

- `useVueNodes.ts`: below `ShotDirector: 'shot-director',` add `Character: 'character',`
- `VueNodeCanvas.vue` `nodeTypes`: add `'character': markRaw(CharacterNode),` + import.
- `VueNodeCanvas.vue` `createNodeData` synthesis (the block at ~:1380): extend —

```typescript
if (nodeType === 'Character' && (!data.data.outputs || data.data.outputs.length === 0)) {
  data.data.outputs = [{ name: 'character', type: 'CHARACTER', links: null }]
}
if (nodeType === 'ShotDirector' && (!data.data.inputs || data.data.inputs.length === 0)) {
  data.data.inputs = [1, 2, 3].map(i => ({ name: `cast_${i}`, type: 'CHARACTER', link: null, optional: true }))
}
```

- `toolbox-items.ts`: add `{ nodeType: 'Character', label: 'Character', description: 'A castable person — wire into a Shot Director.', icon: Drama }` (import `Drama` from lucide; match the file's entry shape exactly).

- [ ] **Step 2: Create CharacterNode.vue**

Model on `ShotDirectorNode.vue`'s card structure (header, body, footer, output Handle). Core:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle } from '@vue-flow/core'
import { Drama } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import CharacterPickerModal from '~/components/vue-canvas/CharacterPickerModal.vue'

const props = defineProps<{ id: string, data: any }>()
const { characters, coverUrl } = useCharacters()
const pickerOpen = ref(false)

const slug = computed<string | null>(() => props.data?.properties?.comfynext_characterSlug ?? null)
const character = computed(() => characters.value.find(c => c.slug === slug.value) ?? null)

function pick(s: string, name: string) {
  if (!props.data.properties) props.data.properties = {}
  props.data.properties.comfynext_characterSlug = s
  props.data.properties.comfynext_characterName = name
  pickerOpen.value = false
  // Nudge any wired Shot Directors to re-sync their cast (Task 11 listens).
  window.dispatchEvent(new CustomEvent('comfynext:castEdgesChanged'))
}
</script>

<template>
  <div class="min-w-[180px] rounded-xl border border-white/10 bg-[#141414] text-white/90">
    <div class="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-1.5 text-[11px] text-white/60">
      <Drama :size="12" /> Character
    </div>
    <div class="p-2.5">
      <template v-if="character">
        <div class="flex items-center gap-2">
          <img v-if="coverUrl(character)" :src="coverUrl(character)!" class="h-10 w-10 rounded object-cover" :alt="character.name">
          <div class="min-w-0">
            <div class="truncate text-[12px]">{{ character.name }}</div>
            <div class="text-[10px] text-white/40">{{ character.refImages.length }} references</div>
          </div>
        </div>
        <div v-if="!character.refImages.length" class="mt-1.5 text-[10px] text-amber-400/80">
          No reference photos — add some in the Characters panel.
        </div>
      </template>
      <div v-else-if="slug" class="text-[11px] text-red-400/80">Character “{{ data?.properties?.comfynext_characterName || slug }}” was deleted.</div>
      <p v-else class="text-[11px] text-white/40">No character picked.</p>
      <button class="mt-2 w-full rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 hover:bg-white/10" @click.stop="pickerOpen = true">
        {{ character ? 'Change' : 'Pick character' }}
      </button>
    </div>
    <Handle id="output-0" type="source" position="right" class="!h-2.5 !w-2.5 !rounded-full !border-2 !bg-[#1a1a1a]" />
    <CharacterPickerModal v-if="pickerOpen" :exclude-slugs="[]" @pick="pick" @close="pickerOpen = false" />
  </div>
</template>
```

(If `Handle`'s `position` prop needs the `Position` enum in this codebase — check `ShaderStudioNode.vue`'s usage and mirror it exactly.)

- [ ] **Step 3: Render cast input handles on ShotDirectorNode.vue**

Mirror how `ShaderStudioNode.vue` renders its `image` input handle: three target Handles on the left (`id="input-0"`, `input-1`, `input-2`), each with a tiny `CHARACTER`-colored label. Follow the existing port-label idiom (`ComfyNodePort` if the studio cards use it; else raw `Handle` + span).

- [ ] **Step 5: Verify**

Typecheck ≤ 396; browser: Add menu shows Character; add → pick → card shows cover/name; wire its output to a Shot Director cast input — the edge connects (type `CHARACTER` matches; the `onConnect` compatibility check passes on equal types). Note: the wire does nothing yet — sync is Task 11.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/CharacterNode.vue frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/ShotDirectorNode.vue frontend/app/data/toolbox-items.ts
git commit -m "feat(character-cast): CHARACTER port + Character node + ShotDirector cast inputs"
```

---

### Task 11: Edge ⇄ cast sync

**Files:**
- Create: `frontend/app/lib/shotdirector/castEdges.ts` (pure mapper)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (watcher + uncast handler)
- Test: `frontend/tests/unit/shotdirector-cast-edges.unit.spec.ts`

**Interfaces:**
- Consumes: node/edge lite shapes (as in `dispatch.ts`'s `findShotTarget`); `CastMember` (Task 3); Character node properties (Task 10).
- Produces:
  - `wireCastFor(studioId: string, nodes: { id: string; nodeType?: string; characterSlug?: string | null; characterName?: string | null }[], edges: { source: string; target: string; targetHandle?: string | null }[]): CastMember[]` — wire-members for one Shot Director, in cast-input order.
  - `syncCast(existing: CastMember[], wire: CastMember[]): CastMember[] | null` — merges: keeps all `via:'picker'` entries, replaces `via:'wire'` entries with `wire` (dedupe by slug, picker wins); returns `null` when nothing changed (caller skips persist).
  - Canvas watcher applying `syncCast` to every shot-director node's persisted sheet on edge/property changes; `comfynext:uncastCharacter` handler (from Task 7) removing the edge for a wired member.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shotdirector-cast-edges.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { syncCast, wireCastFor } from '~/lib/shotdirector/castEdges'

const N = (id: string, slug: string | null, name = slug ?? '') =>
  ({ id, nodeType: 'Character', characterSlug: slug, characterName: name })
const SD = { id: 'sd1', nodeType: 'ShotDirector' }
const E = (source: string, handle: string) => ({ source, target: 'sd1', targetHandle: handle })

describe('wireCastFor', () => {
  it('maps wired Character nodes to cast members in input order', () => {
    const nodes = [SD, N('c1', 'reva', 'Reva'), N('c2', 'marcus', 'Marcus')]
    const edges = [E('c2', 'input-1'), E('c1', 'input-0')]
    expect(wireCastFor('sd1', nodes, edges)).toEqual([
      { slug: 'reva', name: 'Reva', via: 'wire' },
      { slug: 'marcus', name: 'Marcus', via: 'wire' },
    ])
  })
  it('skips slugless Character nodes and non-character sources', () => {
    const nodes = [SD, N('c1', null), { id: 'img', nodeType: 'Image' }]
    expect(wireCastFor('sd1', nodes, [E('c1', 'input-0'), E('img', 'input-1')])).toEqual([])
  })
})

describe('syncCast', () => {
  const reva = { slug: 'reva', name: 'Reva', via: 'picker' as const }
  const marcusWire = { slug: 'marcus', name: 'Marcus', via: 'wire' as const }

  it('keeps picker entries, replaces wire entries', () => {
    expect(syncCast([reva, marcusWire], [])).toEqual([reva])
    expect(syncCast([reva], [marcusWire])).toEqual([reva, marcusWire])
  })
  it('dedupes by slug — picker wins over an identical wire member', () => {
    expect(syncCast([reva], [{ ...reva, via: 'wire' }])).toBeNull() // no change: picker entry already covers the slug
  })
  it('returns null when nothing changed', () => {
    expect(syncCast([marcusWire], [marcusWire])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast-edges.unit.spec.ts` — FAIL (module missing).

- [ ] **Step 3: Implement the pure mapper**

Create `frontend/app/lib/shotdirector/castEdges.ts`:

```typescript
/** Edges are one EDITOR of sheet.cast (via:'wire'); the picker is the other.
 *  Pure mapping so the canvas watcher stays a thin shell. */
import type { CastMember } from '~/lib/shotdirector/types'

export interface CastNodeLite { id: string, nodeType?: string, characterSlug?: string | null, characterName?: string | null }
export interface CastEdgeLite { source: string, target: string, targetHandle?: string | null }

export function wireCastFor(studioId: string, nodes: CastNodeLite[], edges: CastEdgeLite[]): CastMember[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges
    .filter(e => e.target === studioId && (e.targetHandle ?? '').startsWith('input-'))
    .sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
    .map(e => byId.get(e.source))
    .filter((n): n is CastNodeLite => !!n && n.nodeType === 'Character' && !!n.characterSlug)
    .map(n => ({ slug: n.characterSlug!, name: n.characterName || n.characterSlug!, via: 'wire' as const }))
}

export function syncCast(existing: CastMember[], wire: CastMember[]): CastMember[] | null {
  const picker = existing.filter(m => m.via === 'picker')
  const pickerSlugs = new Set(picker.map(m => m.slug))
  const next = [...picker, ...wire.filter(m => !pickerSlugs.has(m.slug))]
  const same = next.length === existing.length
    && next.every((m, i) => existing[i]!.slug === m.slug && existing[i]!.via === m.via)
  return same ? null : next
}
```

- [ ] **Step 4: Wire the canvas watcher + uncast handler**

In `VueNodeCanvas.vue` (near the other shot-director handlers):

```typescript
import { syncCast, wireCastFor } from '~/lib/shotdirector/castEdges'

function syncAllShotDirectorCasts() {
  const liteNodes = (nodes.value as any[]).map(n => ({
    id: String(n.id), nodeType: n.data?.nodeType as string | undefined,
    characterSlug: n.data?.properties?.comfynext_characterSlug ?? null,
    characterName: n.data?.properties?.comfynext_characterName ?? null,
  }))
  const liteEdges = (edges.value as any[]).map(e => ({
    source: String(e.source), target: String(e.target), targetHandle: e.targetHandle ?? null,
  }))
  for (const n of nodes.value as any[]) {
    if (n.data?.nodeType !== 'ShotDirector') continue
    const raw = n.data?.properties?.comfynext_shotDirector
    const sheet = hydrateShotSheet(raw)
    const next = syncCast(sheet.cast, wireCastFor(String(n.id), liteNodes, liteEdges))
    if (next) {
      if (!n.data.properties) n.data.properties = {}
      n.data.properties.comfynext_shotDirector = { ...sheet, cast: next }
    }
  }
}

watch(edges, () => syncAllShotDirectorCasts(), { deep: true })
window.addEventListener('comfynext:castEdgesChanged', syncAllShotDirectorCasts)

function handleUncastCharacter(e: Event) {
  const { nodeId, slug } = (e as CustomEvent<{ nodeId: string, slug: string }>).detail ?? {}
  if (!nodeId || !slug) return
  const drop = (edges.value as any[]).filter((ed) => {
    if (String(ed.target) !== String(nodeId)) return false
    const src = (nodes.value as any[]).find(n => String(n.id) === String(ed.source))
    return src?.data?.properties?.comfynext_characterSlug === slug
  })
  if (drop.length) removeEdges(drop.map((d: any) => d.id))
}
window.addEventListener('comfynext:uncastCharacter', handleUncastCharacter)
```

Add both `removeEventListener` calls in the teardown block (mirror the existing shot-director pairs).

- [ ] **Step 5: Verify**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast-edges.unit.spec.ts tests/unit/shotdirector-cast.unit.spec.ts` — PASS; typecheck ≤ 396.
Browser: wire Character→ShotDirector → open the editor: the member appears with the wire glyph; unwire → chip disappears; pick the same character via picker, then wire it too → still one chip (picker wins); remove a wired chip in the surface → the canvas edge disappears.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shotdirector/castEdges.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/tests/unit/shotdirector-cast-edges.unit.spec.ts
git commit -m "feat(character-cast): edge <-> cast sync — wires are an editor of sheet.cast"
```

---

### Task 12: Character Sheet Builder node

**Files:**
- Create: `frontend/app/components/vue-canvas/CharacterSheetNode.vue`
- Modify: `frontend/app/data/character-shot-scenes.ts` (canonical sheet prompts)
- Modify: `frontend/app/composables/useVueNodes.ts`, `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, `frontend/app/data/toolbox-items.ts` (registration, synthesis: optional `IMAGE` input + `CHARACTER` output)

**Interfaces:**
- Consumes: `POST /api/cloud-train/character-shot` `{ referenceImageDataUrl, prompt, aspectRatio }` → `{ imageDataUrl }` (existing, ~$0.08/shot); `uploadRefFile`; Task 2 API; Task 10 registration idioms; upstream image via the wired node's `data.images[0]` (same read as other consumers).
- Produces:
  - `character-shot-scenes.ts`: `export const CHARACTER_SHEET_CANONICAL: CharacterShotScene[]` — exactly 4: `{ prompt: 'close-up portrait, facing camera directly, neutral expression, soft even light, plain background', framing: 'closeup' }`, `{ prompt: 'three-quarter view medium shot, natural relaxed pose, soft daylight, plain background', framing: 'medium' }`, `{ prompt: 'profile view close-up, looking to the side, soft even light, plain background', framing: 'closeup' }`, `{ prompt: 'full-body shot, standing naturally, arms relaxed, soft daylight, plain seamless background', framing: 'full' }`
  - nodeType `'CharacterSheet'` ↔ `'character-sheet'`; synthesis: inputs `[{ name: 'image', type: 'IMAGE', link: null, optional: true }]`, outputs `[{ name: 'character', type: 'CHARACTER', links: null }]`; after Save the node stores `properties.comfynext_characterSlug/Name` (so Task 11's sync treats it like a Character node — extend `wireCastFor`'s nodeType check to `n.nodeType === 'Character' || n.nodeType === 'CharacterSheet'` and update its unit test accordingly).

- [ ] **Step 1: Add the canonical prompts + registrations** (exact values above; registration mirrors Task 10 steps).

- [ ] **Step 2: Create CharacterSheetNode.vue**

Structure (model on the card idiom of `ShotDirectorNode.vue` + the dataset-builder generate/re-roll pattern from `LoraTrainerSurface.vue`):
- **Source row:** upstream image thumbnail if a wired source exists (find via injected `vueFlowNodes`/`vueFlowEdges` — the provide at VueNodeCanvas:875 — first edge targeting this node's `input-0`, read source node `data.images[0]`), else a file-input upload (data URL held locally).
- **Name field** (`v-model="charName"`, `text-[12px]` input idiom).
- **Expand button:** label `Expand sheet · ~$0.32`; disabled without source+name. On click: for each of `CHARACTER_SHEET_CANONICAL` (sequential, concurrency 1 is fine for 4 shots): POST `/api/cloud-train/character-shot` with `{ referenceImageDataUrl: sourceDataUrl, prompt: scene.prompt, aspectRatio: scene.framing === 'full' ? '3:4' : '1:1' }`; push `{ dataUrl, scene }` into `shots` as they land; per-tile re-roll button re-posts that scene. Failures render a per-tile retry (dataset-builder pattern).
- **Save button** (emerald, since it writes durable state but spends nothing): uploads source + each shot via `uploadRefFile` (convert data URL → File with `dataUrlToFile`-style helper inline), POSTs the character, PATCHes `refImages` (source first), sets `properties.comfynext_characterSlug/Name`, dispatches `comfynext:charactersChanged` + `comfynext:castEdgesChanged`, and flips the card into the "saved" state (cover + name + ref count, like CharacterNode).
- Handles: target `input-0` (left), source `output-0` (right), mirroring Task 10.
- If the node already has `comfynext_characterSlug`, render the saved state with a "New sheet" reset button.

(Write the full component; it will be ~200 lines. Reuse `useCharacters` for the saved-state display. Wired-source read: `const upstream = computed(() => { const e = (edgesInj?.value ?? []).find((e: any) => String(e.target) === props.id && e.targetHandle === 'input-0'); const n = e && (nodesInj?.value ?? []).find((n: any) => String(n.id) === String(e.source)); return n?.data?.images?.[0] ?? null })` with `const nodesInj = inject<any>('vueFlowNodes', null); const edgesInj = inject<any>('vueFlowEdges', null)`.)

- [ ] **Step 3: LoRA source mode (the spec's fourth creation path)**

Add a source toggle to the card: `Photo | Trained LoRA`. In LoRA mode, replace the upload/wired source with a picker of character LoRAs (fetch `/api/loras-local`, filter `kind === 'character'`, reuse the panel's fetch idiom) and generate the 4 canonical shots via the existing LoRA generation composable instead of ideogram:

```typescript
import { useInpaint } from '~/composables/useInpaint'
const { loraGen } = useInpaint()

async function generateLoraShot(scene: CharacterShotScene): Promise<string> {
  // loraGen(prompt, loraFilename, opts) — check the exact signature in
  // useInpaint.ts and mirror an existing caller (Generate Object uses it);
  // prompt = `${selectedLora.trigger ?? ''}, ${scene.prompt}`.trim()
  // returns/records an image URL — convert to data URL if the tile renderer
  // needs one, else render the URL directly.
  …
}
```

On Save in LoRA mode, also PATCH `{ loraName: selectedLora.filename, trigger: selectedLora.trigger }` onto the new record. Cost label on the LoRA expand button: `~$0.12` (4 × ~$0.03 trained-LoRA inference). If `loraGen`'s real signature diverges from the sketch, adapt to it — the requirement is: 4 canonical shots through the character's own LoRA with its trigger word, per-tile re-roll, same Save flow.

- [ ] **Step 4: Update `wireCastFor` + its test** for the `CharacterSheet` nodeType (see Interfaces).

- [ ] **Step 5: Verify**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast-edges.unit.spec.ts` — PASS (updated). Full suite + typecheck ≤ 396.
Browser: add Character Sheet node, upload a photo, type a name — **STOP before clicking Expand (it spends ~$0.32). Ask the user for go-ahead; with it, run one expansion** and verify 4 tiles render, Save creates the character (panel + picker show it), and wiring the node into a Shot Director casts it.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/CharacterSheetNode.vue frontend/app/data/character-shot-scenes.ts frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/data/toolbox-items.ts frontend/app/lib/shotdirector/castEdges.ts frontend/tests/unit/shotdirector-cast-edges.unit.spec.ts
git commit -m "feat(character-cast): Character Sheet builder node — expand one photo into a canonical sheet"
```

---

### Task 13: Full-suite gate + docs note

**Files:**
- Modify: `docs/superpowers/specs/2026-07-01-character-cast-shot-director-design.md` (status line only)

- [ ] **Step 1:** `cd frontend && npx vitest run` — expect only the 3 known unrelated failures; `npx nuxi typecheck 2>&1 | grep -c "error TS"` ≤ 396; `cd .. && .venv/bin/python -m pytest tests-unit/comfy_api_test/ -q` — all pass (proves zero Python impact).
- [ ] **Step 2:** Update the spec's `**Status:**` line to `Implemented (slices A+B) — <date>`.
- [ ] **Step 3:** Commit:

```bash
git add docs/superpowers/specs/2026-07-01-character-cast-shot-director-design.md
git commit -m "docs(character-cast): mark spec implemented"
```

**Not in this plan (needs explicit user go-ahead at the time):** a real cast Seedance generation (combines with the still-pending Shot Director Task 7 spike — one shot with a cast character is the ideal combined verification, ~$0.90 at 720p/5s, after a ComfyUI restart).
