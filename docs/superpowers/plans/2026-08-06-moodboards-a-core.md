# Moodboards Plan A — Library, Node, Modal, Gallery, Slot Apply

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the moodboard core — an app-level moodboard library (images + editable Fable reading), a pile-faced canvas node, a brand-guidelines-document modal, a Moodboards gallery tab, and weightless slot apply that injects the taste block into generation prompts.

**Architecture:** Library owns, nodes reference (brand-kits CRUD precedent: one JSON per entry in `server/moodboards/`, images in `input/moodboard_<ms>/` with own guarded routes). The node is frontend-only in this plan (Plan B gives it a Python twin + ports). Apply rides the existing multi-LoRA slot machinery: a moodboard pick writes `properties.aesthetic_<letter>` via the proven `writeAesthetic` path, plus `properties.sailor_moodboard_<letter>` for identity, and `composeLoraStyle` (unchanged) carries it into the prompt at run time.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, h3 server routes, vitest (`frontend/tests/unit/*.unit.spec.ts`), Playwright for the E2E.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-06-moodboard-styles-design.md`. Where this plan and the spec disagree, the spec wins.
- All new `/api/*` routes MUST be allowlisted in `frontend/server/middleware/comfyui-proxy.ts` (`NITRO_API_PREFIXES`) or they proxy to ComfyUI and 404. `/api/moodboards` is the one new prefix.
- Node state persists ONLY under `properties.*` — `convertToLiteGraph()` (`frontend/app/composables/useVueNodes.ts:579-592`) silently drops any other `data.*` field on save.
- Image folder guard: `/^moodboard_\d+$/` — never widen the datasets' `FOLDER_RE`.
- Multipart uploads use `server/utils/multipart.ts` (h3's `readMultipartFormData` RangeErrors over 64 MiB).
- The reading's palette is CURATED (Fable-named `{name, hex}[]`) — never raw k-means.
- No `Math.random` at render time — pile scatter seeds from image ids (`PileStack.vue` already does this).
- No purple anywhere; amber is the taste accent. Follow `.impeccable.md` idioms (13px headings, 11px labels).
- Typecheck baseline is ~411 pre-existing errors repo-wide; zero NEW errors in touched files.
- Broken-control discipline: every non-trivial assertion demonstrated able to fail.
- Commit after every task with the repo's `type(scope): summary` style + the Fable co-author trailer.

---

### Task A1: Moodboard shared type, validation, and library CRUD routes

**Files:**
- Create: `frontend/shared/taste/moodboard.ts`
- Create: `frontend/server/api/moodboards/index.get.ts`
- Create: `frontend/server/api/moodboards/[id].put.ts`
- Create: `frontend/server/api/moodboards/[id].delete.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (add `'/api/moodboards'` to `NITRO_API_PREFIXES`, line ~27)
- Test: `frontend/tests/unit/moodboard-entry.unit.spec.ts`

**Interfaces:**
- Produces: `MoodboardReading { summary: string; palette: { name: string; hex: string }[]; avoids: string[] }`; `MoodboardEntry { id: string; name: string; createdAt: string; updatedAt: string; folder: string; reading: MoodboardReading }`; `validateMoodboardEntry(raw: unknown): MoodboardEntry` (throws `Error` with a plain message on invalid); `MOODBOARD_ID_RE = /^[a-z0-9-]{1,64}$/`; `MOODBOARD_FOLDER_RE = /^moodboard_\d+$/`.
- Routes: `GET /api/moodboards → { moodboards: MoodboardEntry[] }` (sorted by name; missing dir → `[]`); `PUT /api/moodboards/:id` (body = entry, `body.id === id`, validated, `updatedAt` stamped server-side); `DELETE /api/moodboards/:id`.
- Storage: `join(process.cwd(), 'server', 'moodboards', `${id}.json`)` — the brand-kits pattern verbatim (`frontend/server/api/brand-kits/[id].put.ts`).

- [ ] **Step 1: Failing test** — `frontend/tests/unit/moodboard-entry.unit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateMoodboardEntry, MOODBOARD_ID_RE, MOODBOARD_FOLDER_RE } from '../../shared/taste/moodboard'

const good = {
  id: 'pastel-miami', name: 'Pastel Miami', createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z', folder: 'moodboard_1786000000000',
  reading: { summary: 'sun-bleached pastel', palette: [{ name: 'Blush', hex: '#F6C1CB' }], avoids: ['neon'] },
}

describe('validateMoodboardEntry', () => {
  it('accepts a well-formed entry and round-trips it', () => {
    expect(validateMoodboardEntry(structuredClone(good))).toEqual(good)
  })
  it('rejects a traversal id, a bad folder, and a bad hex', () => {
    expect(() => validateMoodboardEntry({ ...good, id: '../etc' })).toThrow(/id/)
    expect(() => validateMoodboardEntry({ ...good, folder: 'lora_dataset_1' })).toThrow(/folder/)
    expect(() => validateMoodboardEntry({ ...good, reading: { ...good.reading, palette: [{ name: 'X', hex: 'red' }] } })).toThrow(/hex/)
  })
  it('rejects an empty summary — a moodboard never saves without a reading', () => {
    expect(() => validateMoodboardEntry({ ...good, reading: { ...good.reading, summary: ' ' } })).toThrow(/summary/)
  })
  it('regexes are anchored (broken control: unanchored would pass these)', () => {
    expect(MOODBOARD_ID_RE.test('a/../b')).toBe(false)
    expect(MOODBOARD_FOLDER_RE.test('xmoodboard_1x')).toBe(false)
  })
})
```

- [ ] **Step 2:** Run `cd frontend && npx vitest run tests/unit/moodboard-entry.unit.spec.ts` — FAIL (module not found).
- [ ] **Step 3: Implement** `frontend/shared/taste/moodboard.ts`:

```ts
/** Moodboard — the taste-read style object (spec 2026-08-06). Library owns; nodes reference. */
export interface MoodboardReading {
  summary: string
  palette: { name: string; hex: string }[]  // CURATED (Fable-named) — never raw k-means
  avoids: string[]
}
export interface MoodboardEntry {
  id: string; name: string; createdAt: string; updatedAt: string
  folder: string                            // input/moodboard_<ms> image folder
  reading: MoodboardReading
}

export const MOODBOARD_ID_RE = /^[a-z0-9-]{1,64}$/
export const MOODBOARD_FOLDER_RE = /^moodboard_\d+$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function validateMoodboardEntry(raw: unknown): MoodboardEntry {
  const e = raw as Partial<MoodboardEntry> | null
  if (!e || typeof e !== 'object') throw new Error('entry must be an object')
  if (typeof e.id !== 'string' || !MOODBOARD_ID_RE.test(e.id)) throw new Error('invalid id')
  if (typeof e.name !== 'string' || !e.name.trim()) throw new Error('name is required')
  if (typeof e.folder !== 'string' || !MOODBOARD_FOLDER_RE.test(e.folder)) throw new Error('invalid folder')
  const r = e.reading as Partial<MoodboardReading> | undefined
  if (!r || typeof r !== 'object') throw new Error('reading is required')
  if (typeof r.summary !== 'string' || !r.summary.trim()) throw new Error('summary is required — never save without a reading')
  const palette = Array.isArray(r.palette) ? r.palette : []
  for (const p of palette) {
    if (!p || typeof p.name !== 'string' || typeof p.hex !== 'string' || !HEX_RE.test(p.hex)) throw new Error('palette hex must be #rrggbb with a name')
  }
  const avoids = (Array.isArray(r.avoids) ? r.avoids : []).filter((a): a is string => typeof a === 'string' && !!a.trim())
  return {
    id: e.id, name: e.name.trim(),
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date().toISOString(),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString(),
    folder: e.folder,
    reading: { summary: r.summary.trim(), palette, avoids },
  }
}
```

- [ ] **Step 4:** Run the test — PASS. Then temporarily unanchor `MOODBOARD_ID_RE` (drop `^`) and confirm the anchored-regex test FAILS; restore.
- [ ] **Step 5: Routes** — copy the brand-kits shape exactly. `frontend/server/api/moodboards/index.get.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateMoodboardEntry, type MoodboardEntry } from '../../../shared/taste/moodboard'

const DIR = join(process.cwd(), 'server', 'moodboards')

export default defineEventHandler(async () => {
  let files: string[] = []
  try { files = (await readdir(DIR)).filter(f => f.endsWith('.json')) }
  catch { return { moodboards: [] } }
  const moodboards: MoodboardEntry[] = []
  for (const f of files) {
    try { moodboards.push(validateMoodboardEntry(JSON.parse(await readFile(join(DIR, f), 'utf8')))) }
    catch { /* skip corrupt entries; never 500 the whole list */ }
  }
  moodboards.sort((a, b) => a.name.localeCompare(b.name))
  return { moodboards }
})
```

`[id].put.ts` (mirror `brand-kits/[id].put.ts`: validate id against `MOODBOARD_ID_RE`, `body.id === id`, run `validateMoodboardEntry`, stamp `updatedAt = new Date().toISOString()`, `mkdir` recursive, write pretty JSON, return the entry). `[id].delete.ts` (id guard + `rm(..., { force: true })`, return `{ ok: true }`). Add `'/api/moodboards'` to `NITRO_API_PREFIXES`.

- [ ] **Step 6: Verify live** — with the dev server up: `curl -s http://127.0.0.1:3000/api/moodboards` → `{"moodboards":[]}`; PUT a valid entry with curl, GET shows it, DELETE removes it, PUT with `id: '../x'` → 400.
- [ ] **Step 7: Commit** — `feat(moodboard): library type + CRUD routes (brand-kits pattern)`.

---

### Task A2: Moodboard image routes — upload, list, serve

**Files:**
- Create: `frontend/server/api/moodboards/images.post.ts` (multipart upload)
- Create: `frontend/server/api/moodboards/images.get.ts` (list + serve)
- Test: `frontend/tests/unit/moodboard-image-routes.unit.spec.ts`

**Interfaces:**
- `POST /api/moodboards/images` — multipart form: field `folder` (optional; omitted → server mints `moodboard_${Date.now()}`), files under `images`. Saves JPEG/PNG/WebP into `<repo-root>/input/<folder>/`. Returns `{ folder: string, files: string[] }`.
- `GET /api/moodboards/images?folder=moodboard_123` → `{ files: string[] }` (sorted). `GET ...?folder=...&file=x.png` → raw image bytes, `Cache-Control: no-store`.
- Guards (exported for tests from a small helper in `images.get.ts` or a shared `frontend/server/utils/moodboardImages.ts`): `MOODBOARD_FOLDER_RE` from A1; `safeImageFile(name: string): boolean` — rejects `/`, `\\`, `..`, requires `/\.(png|jpe?g|webp)$/i`. Input dir = `path.resolve(process.cwd(), '..', 'input')` (the `dataset-match.get.ts:23` pattern).

- [ ] **Step 1: Failing test** — pure-guard tests (the file-serving path mirrors `training-image.get.ts`, which is trusted):

```ts
import { describe, expect, it } from 'vitest'
import { safeImageFile } from '../../server/utils/moodboardImages'
import { MOODBOARD_FOLDER_RE } from '../../shared/taste/moodboard'

describe('moodboard image guards', () => {
  it('accepts plain image names, rejects traversal and non-images', () => {
    expect(safeImageFile('a.png')).toBe(true)
    expect(safeImageFile('b.JPEG')).toBe(true)
    for (const bad of ['../a.png', 'a/../b.png', 'a\\b.png', 'x.svg', 'x.png.exe', '']) {
      expect(safeImageFile(bad), bad).toBe(false)
    }
  })
  it('folder guard admits only moodboard_<digits>', () => {
    expect(MOODBOARD_FOLDER_RE.test('moodboard_1786000000000')).toBe(true)
    for (const bad of ['lora_dataset_1', 'moodboard_', 'moodboard_1/..', 'MOODBOARD_1']) {
      expect(MOODBOARD_FOLDER_RE.test(bad), bad).toBe(false)
    }
  })
})
```

- [ ] **Step 2:** Run — FAIL. Implement `frontend/server/utils/moodboardImages.ts`:

```ts
import path from 'node:path'
export function moodboardInputDir(): string { return path.resolve(process.cwd(), '..', 'input') }
export function safeImageFile(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return /\.(png|jpe?g|webp)$/i.test(name)
}
```

- [ ] **Step 3:** `images.post.ts` — use `server/utils/multipart.ts` (NOT `readMultipartFormData` — 64 MiB RangeError). Read its exported signature first and follow an existing consumer. Mint `folder` when absent, validate against `MOODBOARD_FOLDER_RE`, `mkdir` recursive, write each part whose filename passes `safeImageFile` (sanitize to basename, prefix an index for uniqueness: `${String(i).padStart(2, '0')}_${basename}`), return `{ folder, files }`. Reject zero valid files with 400. `images.get.ts` — both modes with the guards; serve with the `training-image.get.ts` content-type map and `no-store`.
- [ ] **Step 4:** Tests PASS; live check: upload two small PNGs via `curl -F`, list them, fetch one byte-for-byte (`cmp` against the original), confirm `?folder=lora_dataset_123` → 400 (moodboard routes must never open training folders).
- [ ] **Step 5: Commit** — `feat(moodboard): image upload/list/serve with own folder guard`.

---

### Task A3: Curated palette from the Fable read + production gate

**Files:**
- Modify: `frontend/server/api/taste/read.post.ts`
- Test: extend `frontend/tests/unit/` with `taste-read-palette.unit.spec.ts`

**Interfaces:**
- The read prompt gains: `"palette": exactly 4–6 entries [{ "name": "Blush", "hex": "#F6C1CB" }] — the CURATED design palette you would put in a brand book for this world. Name colours like an art director; hex must be #rrggbb.` in the STRICT JSON shape.
- Response becomes `{ reading, summary, briefs, palette: { name: string; hex: string }[] }`.
- Export `parseCuratedPalette(raw: unknown): { name: string; hex: string }[]` (clamps to 6, drops invalid hexes, trims names, title-cases nothing — Fable's naming stands).
- The `if (!import.meta.dev) throw 404` gate is REMOVED from `read.post.ts` (this is now a product endpoint). `analyze.post.ts` keeps its dev gate (spike instrumentation).

- [ ] **Step 1: Failing test:**

```ts
import { describe, expect, it } from 'vitest'
import { parseCuratedPalette } from '../../server/api/taste/read.post'

describe('parseCuratedPalette', () => {
  it('keeps valid named hexes, drops junk, clamps to 6', () => {
    const raw = [
      { name: 'Blush', hex: '#F6C1CB' }, { name: 'x', hex: 'red' }, { name: '', hex: '#000000' },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, hex: '#112233' })),
    ]
    const out = parseCuratedPalette(raw)
    expect(out[0]).toEqual({ name: 'Blush', hex: '#F6C1CB' })
    expect(out.every(p => /^#[0-9a-fA-F]{6}$/.test(p.hex) && p.name.trim())).toBe(true)
    expect(out.length).toBeLessThanOrEqual(6)
  })
  it('non-arrays → empty (never throws)', () => {
    expect(parseCuratedPalette(null)).toEqual([])
    expect(parseCuratedPalette('nope')).toEqual([])
  })
})
```

- [ ] **Step 2:** FAIL → implement `parseCuratedPalette` in `read.post.ts` (export it beside `extractJsonObject`), extend `READ_PROMPT`'s JSON contract + bullets with the palette spec above, add `palette: parseCuratedPalette(obj.palette)` to the return, and delete the dev-gate throw. Do NOT touch `TasteReading` in `shared/taste/facets.ts` — the palette lives on the response and in `MoodboardReading`.
- [ ] **Step 3:** Tests PASS. Run the full existing taste suite (`npx vitest run tests/unit/taste-analyze.unit.spec.ts tests/unit/taste-mapping.unit.spec.ts tests/unit/taste-style-block.unit.spec.ts tests/unit/taste-wall-observed.unit.spec.ts`) — all green (the wall page ignores the new field; verify `/dev/taste-wall` still loads with Playwright page-error check).
- [ ] **Step 4: Commit** — `feat(taste): curated palette in the Fable read; endpoint leaves dev-only`.

---

### Task A4: `useMoodboards` composable + named-palette style block

**Files:**
- Create: `frontend/app/composables/useMoodboards.ts`
- Modify: `frontend/app/lib/taste/styleBlock.ts`
- Test: extend `frontend/tests/unit/taste-style-block.unit.spec.ts`; create `frontend/tests/unit/moodboards-composable.unit.spec.ts`

**Interfaces:**
- `useMoodboards()` — module-singleton mirroring `useBrandLibrary.ts` verbatim: `{ moodboards: Ref<MoodboardEntry[]>, loaded: Ref<boolean>, refresh(): Promise<void>, save(entry: MoodboardEntry): Promise<void> /* optimistic upsert, rollback via refresh on failure */, remove(id: string): Promise<void>, byId(id: string): MoodboardEntry | undefined, slugifyMoodboardName(name: string): string }`.
- `styleBlock.ts` gains `moodboardStyleBlock(reading: MoodboardReading): string` producing exactly the spec block: `In the style of: <summary>. Palette: <Name #HEX, …>. Avoid: <a, b>.` — empty parts omitted (no dangling `Palette:`/`Avoid:`). The existing `tasteStyleBlock`/`tastedPrompt` stay untouched (the wall uses them).

- [ ] **Step 1: Failing tests** — in `taste-style-block.unit.spec.ts` add:

```ts
import { moodboardStyleBlock } from '../../app/lib/taste/styleBlock'

describe('moodboardStyleBlock', () => {
  const reading = {
    summary: 'Sun-bleached pastel world.',
    palette: [{ name: 'Blush', hex: '#F6C1CB' }, { name: 'Turquoise', hex: '#67C4C9' }],
    avoids: ['darkness', 'neon'],
  }
  it('composes summary + named palette + avoids in spec order', () => {
    expect(moodboardStyleBlock(reading)).toBe(
      'In the style of: Sun-bleached pastel world. Palette: Blush #F6C1CB, Turquoise #67C4C9. Avoid: darkness, neon.',
    )
  })
  it('omits empty parts — broken control: a dangling "Avoid:" must fail this', () => {
    expect(moodboardStyleBlock({ ...reading, avoids: [] })).not.toContain('Avoid')
    expect(moodboardStyleBlock({ ...reading, palette: [] })).not.toContain('Palette')
  })
})
```

`moodboards-composable.unit.spec.ts`: mirror `brand-library-optimistic.unit.spec.ts` — mock `$fetch`, assert optimistic upsert appears before the PUT resolves and rolls back (via `refresh`) when the PUT rejects.

- [ ] **Step 2:** FAIL → implement both. `moodboardStyleBlock`:

```ts
export function moodboardStyleBlock(reading: { summary: string; palette: { name: string; hex: string }[]; avoids: string[] }): string {
  const parts: string[] = []
  const summary = reading.summary.trim().replace(/\.?$/, '.')
  if (reading.summary.trim()) parts.push(`In the style of: ${summary}`)
  if (reading.palette.length) parts.push(`Palette: ${reading.palette.map(p => `${p.name} ${p.hex}`).join(', ')}.`)
  if (reading.avoids.length) parts.push(`Avoid: ${reading.avoids.join(', ')}.`)
  return parts.join(' ')
}
```

- [ ] **Step 3:** All style-block + composable tests PASS (verify the broken control by temporarily always appending `Avoid:` — test reds — restore).
- [ ] **Step 4: Commit** — `feat(moodboard): library composable + spec style block`.

---

### Task A5: The Moodboard canvas node — pile face, registration, persistence

**Files:**
- Create: `frontend/app/components/vue-canvas/MoodboardNode.vue`
- Modify: `frontend/app/composables/useVueNodes.ts` (`ARTIFACT_NODE_COMPONENTS` gains `Moodboard: 'moodboard'`)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (nodeTypes registry `'moodboard': markRaw(MoodboardNode)`; `createNodeData` synthesized-node branch so the type constructs with `properties: {}` and no ports in this plan)
- Modify: `frontend/app/data/studio-options.ts` + `frontend/app/data/toolbox-items.ts` (Add-menu + toolbox entries, label "Moodboard", icon `Images` from lucide)
- Modify: `frontend/app/lib/agent/capabilities.ts` (frontend-only registration so the strip removes it from runs — Plan B replaces this with the Python twin)
- Test: `frontend/tests/unit/moodboard-node-persistence.unit.spec.ts`

**Interfaces:**
- Node type string: `'Moodboard'`. State: `properties.sailor_moodboard = <library id | ''>` — NOTHING else on `data` (the `convertToLiteGraph` gotcha).
- `MoodboardNode.vue` props/pattern copied from `SketchPileNode.vue`: renders `PileStack` (`images` = first 5 board image URLs via `/api/moodboards/images?folder=…&file=…`, `seedKey` = moodboard id, `dashed` empty state "drop inspiration", count badge via the `#rail` slot), name row under the pile, one-line taste readout (`reading.summary` truncated). Open: click → `window.dispatchEvent(new CustomEvent('sailor:openMoodboard', { detail: { nodeId: props.id } }))` with the SketchPileNode click-vs-drag guard (lines 24-31).
- Produces for A6: the `sailor:openMoodboard` event name; for A7: `properties.sailor_moodboard` as the node↔library reference key.

- [ ] **Step 1: Failing test** — the persistence contract (this is the test that catches the gotcha):

```ts
// moodboard-node-persistence.unit.spec.ts — round-trip through the real converters
import { describe, expect, it } from 'vitest'
// Import the conversion pair the way useVueNodes' own tests do — check
// tests/unit for an existing convertToLiteGraph round-trip spec and follow its
// fixture shape exactly (graph-to-prompt.unit.spec.ts shows the workflow shape).
```

Concretely: build a minimal vue-node record of type `Moodboard` with `properties: { sailor_moodboard: 'pastel-miami' }` AND a decoy `data.boardThumbs = ['x']`, run `convertToLiteGraph` → `convertFromLiteGraph` (or the exported equivalents in `useVueNodes.ts` — read its test imports first), assert `properties.sailor_moodboard` survives and `boardThumbs` does NOT (proving state placement is correct, not accidental).

- [ ] **Step 2:** FAIL → register the node type everywhere listed under Files. `createNodeData` branch: `Moodboard` gets `inputs: [], outputs: []` in this plan (ports land in Plan B with real backend types), plus `properties: { sailor_moodboard: '' }`.
- [ ] **Step 3:** Implement `MoodboardNode.vue` (~90 lines): `PileStack` consumer per SketchPileNode; thumbs computed from `useMoodboards().byId(props.data?.properties?.sailor_moodboard)`; empty state dashed pile.
- [ ] **Step 4:** Test PASS. Live check with the browser-E2E recipe (`sailor:addNode` headless): add a Moodboard node on a scratch canvas, reload the page, node still there with its property (persistence through a real save cycle). Screenshot the empty pile.
- [ ] **Step 5: Commit** — `feat(moodboard): canvas node — pile face, registration, properties-only state`.

---

### Task A6: The modal — a brand-guidelines document

**Files:**
- Create: `frontend/app/components/vue-canvas/MoodboardModal.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (open-state ref + `sailor:openMoodboard` listener registered/removed with the others at `:4556-4661`, template mount beside the other studio modals)
- Test: `frontend/tests/unit/moodboard-modal-state.unit.spec.ts` (pure helpers), E2E coverage in A8

**Interfaces:**
- Consumes: `useMoodboards()` (A4), `POST /api/moodboards/images` (A2), `POST /api/taste/read` (A3), `moodboardStyleBlock` (A4 — for the save-time aesthetic sync in A7), `StudioModalShell.vue` chrome.
- Layout per spec (pared version — this is contractual): floating left nav `Board · Reading · Palette · Avoids` (active item tracks scroll via IntersectionObserver), scrollable content with **no section numbers, no subheaders, no dividers** — board grid + drop zone, summary as editable prose (`textarea` styled as open text, no box chrome), palette as named strikeable swatches, avoids as chips with `＋ add`. Floating footer: `Re-read` · `Save` (primary). Amber is the only accent.
- Behavior: images decode client-side (the taste-wall `scaled()` pattern) → upload once via A2 → `read` posts ≤8 of the 768px JPEGs → editable reading state → Save = `PUT /api/moodboards/:id` (slug id on first save) + write `properties.sailor_moodboard` onto the opening node (if opened from a node). Re-read re-posts the stored images (fetch → downscale → read). Read failure keeps the board and shows the error inline with retry; **never save without a summary** (A1 validation backs this server-side).
- Export pure helpers for the unit test: `sectionIds = ['board','reading','palette','avoids']` and `activeSection(scrollStates: { id: string; visible: boolean }[]): string` (first visible wins; falls back to previous active).

- [ ] **Step 1: Failing test** for `activeSection` (3 cases incl. none-visible fallback) — then implement the helpers file-local and exported.
- [ ] **Step 2:** Build the component. Read `GradientStudioSurface.vue`'s modal usage + `StudioModalShell.vue` props first and follow them. Keep the file focused (~300 lines): board pane, reading pane, nav, footer; upload/read/save logic in `<script setup>` calling the composable.
- [ ] **Step 3:** Wire the canvas: `moodboardOpenForId = ref<string | null>(null)`, `handleOpenMoodboard`, listener registration in BOTH the add and remove lists, template mount passing the node's `sailor_moodboard` + writing it back on save.
- [ ] **Step 4:** Live drive (Playwright against the dev server, hydration-gated like the wall tests): add node → open modal → drop 3 fixture images (setInputFiles) → mock `/api/taste/read` via `page.route` returning a fixed reading+palette → assert summary textarea filled, 2 swatches, avoids chips → Save → `GET /api/moodboards` shows the entry → reload page → node pile shows thumbs. Screenshot board + reading states.
- [ ] **Step 5: Commit** — `feat(moodboard): document-style modal — drop, read, correct, save`.

---

### Task A7: Gallery tab + weightless slot apply

**Files:**
- Modify: `frontend/app/lib/graph/loraGalleryTabs.ts` (4th source: signature `loraGallerySource<T>(characters, styles, houseItems, moodboards, tab)`; new tab id `'moodboards'`)
- Modify: `frontend/app/components/vue-canvas/LoraGalleryModal.vue` (filters entry `Moodboards`, source from `useMoodboards()`, `onConfirm` moodboard branch)
- Modify: `frontend/app/lib/graph/loraStyleBlocks.ts` (`loraSlotResetPlan` also clears `sailor_moodboard_<letter>`; new export `moodboardSlotKey(targetWidget: string): string | null` mirroring `slotAestheticKey`)
- Modify: `frontend/app/lib/graph/loraSlotVisibility.ts` (`slotFilled` gains an optional `properties` arg: a slot also counts filled when `properties[`sailor_moodboard_${slot}`]` is a non-empty string; update its call sites in `ComfyNode.vue`)
- Modify: `frontend/app/components/vue-canvas/widgets/WidgetLoraPicker.vue` + `ComfyNode.vue` (card renders the moodboard name + board-strip thumb via the images route; `scaleNameForPicker`/`foldedScaleNames` suppress the strength row when the slot holds a moodboard)
- Test: extend `frontend/tests/unit/lora-gallery-tabs.unit.spec.ts`, `lora-slot-visibility.unit.spec.ts`, `lora-style-blocks.unit.spec.ts`

**Interfaces:**
- Consumes: `useMoodboards()`, `moodboardStyleBlock` (A4), the `writeAesthetic`/`migrateLegacyAestheticIfNeeded` machinery already in `LoraGalleryModal.vue`.
- The moodboard pick (house-style branch as the template, `LoraGalleryModal.vue:241-252`): `set(picker, '[None]')`; `set(url, '')`; **no scale write**; `writeAesthetic(data, targetWidget, moodboardStyleBlock(entry.reading))`; `data.properties[moodboardSlotKey(targetWidget)] = entry.id`.
- Produces: the run-time behavior needs ZERO new code — `composeLoraStyle` already reads `aesthetic_<letter>`; A8 proves it end-to-end.

- [ ] **Step 1: Failing tests** (all three files):

```ts
// lora-gallery-tabs: new tab routes the 4th source
expect(loraGallerySource(['c'], ['s'], ['h'], ['m'], 'moodboards')).toEqual(['m'])
// existing 3 tabs unchanged — update all call sites/signatures in the same commit

// lora-slot-visibility: weightless slot counts as filled
const props = { sailor_moodboard_b: 'pastel-miami' }
expect(slotFilled('b', valuesWithNoneAndEmptyUrl, defs, props)).toBe(true)
expect(slotFilled('b', valuesWithNoneAndEmptyUrl, defs, {})).toBe(false) // broken control
// and: lora_c becomes VISIBLE when b holds only a moodboard

// lora-style-blocks: reset plan clears the moodboard key
expect(loraSlotResetPlan('lora_b').moodboardKey).toBe('sailor_moodboard_b')
```

- [ ] **Step 2:** FAIL → implement all modifications. Update EVERY `loraGallerySource` and `slotFilled` call site in the same change (grep both names; the compiler catches the signature change — that's the point of changing the signature rather than appending an optional source).
- [ ] **Step 3:** Tests PASS (including previously-existing suites for these files — no regressions).
- [ ] **Step 4:** Live drive: open the gallery from slot B on a multi-LoRA node → Moodboards tab lists the A6 entry → pick → card shows name + thumb, NO strength row → slot C is now revealed → clear (×) empties `aesthetic_b` and `sailor_moodboard_b`. Screenshot the picked card.
- [ ] **Step 5: Commit** — `feat(moodboard): gallery tab + weightless slot apply`.

---

### Task A8: End-to-end proof + paid checklist

**Files:**
- Create: `frontend/tests/moodboard-core.spec.ts` (Playwright, run against the live dev server like `tests/embed-network.spec.ts`)
- Modify: `docs/superpowers/specs/2026-08-06-moodboard-styles-design.md` (tick a short "Plan A shipped" status line with commit range)

**Interfaces:** consumes everything above; produces the release gate.

- [ ] **Step 1: The E2E** (mocked read via `page.route('/api/taste/read', …)`; real everything else):
  1. Add Moodboard node headlessly (`sailor:addNode`), open modal, drop 3 fixture PNGs, Read (mocked), edit the summary text, Save.
  2. Assert library: `GET /api/moodboards` carries the edited summary (the correction survived — white-box proof).
  3. Add a FluxMultiLoRA node, open slot B gallery → Moodboards tab → pick.
  4. **The composed-prompt assertion (the point of the whole plan):** run the same injection the app runs — evaluate `injectLoraStyleIntoPrompt` on a clone of the serialized workflow in-page (or trigger a run with the queue mocked) and assert `widgets_values[0]` starts with `In the style of:` and contains a palette hex from the mocked reading. Broken control: blank the `aesthetic_b` property and assert the prompt no longer carries the block.
  5. Delete the Moodboard node → `GET /api/moodboards` still returns the entry (library survives).
- [ ] **Step 2:** Run headed once, keep screenshots (node pile, modal, gallery tab, picked card).
- [ ] **Step 3: Paid manual checklist** (Julien or a session with keys; record results in the spec): one real Fable read on a real board (summary quality + curated palette sanity), one real generation with a moodboard in a slot (block visible in the served prompt, output plausibly styled).
- [ ] **Step 4: Commit** — `test(moodboard): core E2E — create→read→correct→save→apply→composed prompt`.

---

## Explicitly deferred to Plan B (`2026-08-06-moodboards-b-wires.md`)

Ports (`style`/`image` out), the Python Moodboard twin (so the node survives the run strip), `style_in`/`prompt_in` on the two generators, the TASTE edge type + colors, refs-at-generation gated by the `multi-image` tag (recon: those models' input builders take no refs today — Python `ModelInputBuilder` widening required), @refs exposure of board images, and the removal of Plan A's frontend-only registration. Plan A ships a complete, useful product without any of it.
