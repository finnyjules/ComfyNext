# Project Previews From Studio Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All-Projects / Home cards show studio-node and Frame content as preview thumbnails instead of "No preview" when a project has no paid renders.

**Architecture:** Two sourcing layers, no new rendering. (1) The grid's image collector in `useRecentProjects` stops discarding `type: 'input'` generation assets (Frame composites, Gradient/SpaceType studio renders recorded via `recordAsset`) — they become fallback thumbnails behind real outputs. (2) At durable-save time, `saveDurableVersion` scans the saved `ProjectDoc` for persisted node previews (`properties.sailor_preview.images` `/view?` URLs; Scene3D `beauty_image` widget filenames) and stamps up to 3 as the project's `cover` via the existing-but-unused `PUT /sailor/projects/{uuid}` `cover` field. The grid uses cover images as the last fallback. All extraction logic lives in a new pure module `app/lib/projectCover.ts` (unit-tested); composables/layout only glue.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/*.unit.spec.ts`, node env), existing ComfyUI `/sailor/projects` endpoints (NO server changes — the PUT handler already persists `cover` verbatim, `comfy_extras/nodes_sailor_projects.py:482-483`).

## Global Constraints

- No backend/Python changes; no ComfyUI restart needed.
- Working dir for all frontend commands: `/Users/julien/Documents/GitHub/Sailor/frontend`.
- Typecheck baseline is ~328 pre-existing errors — do NOT run a full typecheck as a gate; verify via targeted vitest runs.
- PARALLEL SESSIONS are editing this repo. Stage ONLY the files this plan touches (`git add <exact paths>`), never `git add -A`, never stash. Commit directly to `main`.
- `RecentProject.images` keeps its `{ filename; subfolder; type }[]` shape — `AllProjectsView.vue` and the Home row must not need changes.
- Preview candidates are images only (`kind === 'image'`); videos/audio never become thumbnails (matches current behavior).

---

### Task 1: Pure extraction module `projectCover.ts` + unit tests

**Files:**
- Create: `frontend/app/lib/projectCover.ts`
- Test: `frontend/tests/unit/project-cover.unit.spec.ts`

**Interfaces:**
- Consumes: `GenOutput`, `classifyOutput` from `~/lib/generations` (existing: `GenOutput = { kind: 'image'|'video'|'audio'; filename: string; subfolder: string; type: string }`).
- Produces (later tasks rely on these exact signatures):
  - `parseViewUrl(url: string): GenOutput | null`
  - `extractCoverImages(doc: any): GenOutput[]` (max 3, priority Frame → Scene3D → other node previews, deduped)
  - `buildPreviewImages(sources: GenOutput[][], cap?: number): GenOutput[]` (default cap 3, first-source-wins dedup by `subfolder/filename`)

Domain facts baked into this task (do not re-derive):
- A saved `ProjectDoc` is `{ canvases: [{ id, name, workflow }], activeCanvasId, ... }`; each `workflow` is litegraph-format with `nodes[]` carrying `type`, `properties`, `widgets_values`.
- Artifact/Frame nodes persist their last on-node preview as `properties.sailor_preview.images: string[]` — `/view?filename=…&type=…[&subfolder=…]` URL strings (see `app/composables/useVueNodes.ts:536-550`). Some entries can be data URLs; those must be skipped.
- The Frame's litegraph type is `Compositor`; Scene3D's is `Scene3DStudio` (see `ARTIFACT_NODE_COMPONENTS`, `app/composables/useVueNodes.ts:160-220`).
- Scene3D persists its last bake as a widget value: an input-dir filename prefixed `scene3d_beauty_<nodeId>` (upload at `Scene3DStudioSurface.vue:1112`). Widgets are positional, and widget defs aren't available in a pure lib — detect by filename pattern.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/tests/unit/project-cover.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { parseViewUrl, extractCoverImages, buildPreviewImages } from '~/lib/projectCover'

const view = (filename: string, type = 'input', subfolder = '') => {
  const p = new URLSearchParams({ filename, type })
  if (subfolder) p.set('subfolder', subfolder)
  return `/view?${p}`
}

function doc(nodes: any[], extraCanvases: any[] = []) {
  return { canvases: [{ id: 'c1', name: 'Canvas', workflow: { nodes } }, ...extraCanvases], activeCanvasId: 'c1' }
}

describe('parseViewUrl', () => {
  it('parses a /view URL into filename/subfolder/type parts', () => {
    expect(parseViewUrl(view('frame_1.png', 'input', 'sub'))).toEqual({
      kind: 'image', filename: 'frame_1.png', subfolder: 'sub', type: 'input',
    })
  })
  it('defaults subfolder to empty and classifies kind from the extension', () => {
    expect(parseViewUrl(view('clip.mp4', 'output'))).toEqual({
      kind: 'video', filename: 'clip.mp4', subfolder: '', type: 'output',
    })
  })
  it('rejects data URLs, non-view URLs, and URLs without filename', () => {
    expect(parseViewUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(parseViewUrl('https://example.com/x.png')).toBeNull()
    expect(parseViewUrl('/view?type=input')).toBeNull()
  })
})

describe('buildPreviewImages', () => {
  const img = (filename: string, subfolder = ''): any => ({ kind: 'image', filename, subfolder, type: 'input' })
  it('fills from sources in order, dedups by subfolder/filename, caps at 3', () => {
    const out = buildPreviewImages([
      [img('a.png'), img('b.png')],
      [img('a.png'), img('c.png'), img('d.png')],
    ])
    expect(out.map((o) => o.filename)).toEqual(['a.png', 'b.png', 'c.png'])
  })
  it('treats same filename in different subfolders as distinct', () => {
    const out = buildPreviewImages([[img('a.png'), img('a.png', 'sub')]])
    expect(out).toHaveLength(2)
  })
})

describe('extractCoverImages', () => {
  it('collects Frame composites first, then Scene3D bakes, then other node previews', () => {
    const d = doc([
      { type: 'Image', properties: { sailor_preview: { images: [view('gen_out.png', 'output')] } } },
      { type: 'Scene3DStudio', widgets_values: ['{}', 'scene3d_beauty_7_abc.png', 'scene3d_depth_7_abc.png'] },
      { type: 'Compositor', properties: { sailor_preview: { images: [view('frame_comp.png')] } } },
    ])
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual([
      'frame_comp.png', 'scene3d_beauty_7_abc.png', 'gen_out.png',
    ])
  })
  it('reads Scene3D bakes as input-type images', () => {
    const d = doc([{ type: 'Scene3DStudio', widgets_values: ['scene3d_beauty_2_x.png'] }])
    expect(extractCoverImages(d)).toEqual([
      { kind: 'image', filename: 'scene3d_beauty_2_x.png', subfolder: '', type: 'input' },
    ])
  })
  it('skips data URLs, videos, and nodes without previews; dedups across nodes; caps at 3', () => {
    const d = doc([
      { type: 'Compositor', properties: { sailor_preview: { images: ['data:image/png;base64,AA', view('a.png'), view('v.mp4')] } } },
      { type: 'Image', properties: { sailor_preview: { images: [view('a.png'), view('b.png'), view('c.png'), view('d.png')] } } },
      { type: 'KSampler' },
    ])
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual(['a.png', 'b.png', 'c.png'])
  })
  it('walks every canvas in the doc', () => {
    const d = doc(
      [{ type: 'Compositor', properties: { sailor_preview: { images: [view('one.png')] } } }],
      [{ id: 'c2', name: 'B', workflow: { nodes: [{ type: 'Compositor', properties: { sailor_preview: { images: [view('two.png')] } } }] } }],
    )
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual(['one.png', 'two.png'])
  })
  it('tolerates a legacy bare-workflow doc and garbage input', () => {
    expect(extractCoverImages({ nodes: [{ type: 'Compositor', properties: { sailor_preview: { images: [view('x.png')] } } }] })
      .map((o) => o.filename)).toEqual(['x.png'])
    expect(extractCoverImages(null)).toEqual([])
    expect(extractCoverImages({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/project-cover.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/projectCover`.

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/projectCover.ts
/**
 * projectCover — derive a project's preview images from its saved doc.
 *
 * Studio nodes and Frames never run through ComfyUI, so their renders don't
 * appear in generation records as `type: 'output'` files. They DO persist as
 * server-side input files referenced from the saved ProjectDoc: artifact/Frame
 * nodes stash `/view?…` URLs in `properties.sailor_preview.images` (see
 * useVueNodes convertToLiteGraph) and Scene3D stores its beauty bake as a
 * `scene3d_beauty_<nodeId>…` widget filename. This module extracts those
 * references so the save path can stamp them onto the project's `cover` field
 * and the All Projects grid can fall back to them.
 */
import { classifyOutput, type GenOutput } from '~/lib/generations'

const COVER_CAP = 3

// Scene3D widgets are positional and widget defs aren't available here, so the
// beauty bake is recognized by its upload prefix (Scene3DStudioSurface).
const SCENE3D_BEAUTY_RE = /^scene3d_beauty_[^/\\]*\.(png|jpe?g|webp)$/i

/** Parse a persisted `/view?filename=…` preview URL back into file parts.
 *  Data URLs and anything else non-/view (or missing a filename) → null. */
export function parseViewUrl(url: string): GenOutput | null {
  if (typeof url !== 'string' || !url.startsWith('/view?')) return null
  let params: URLSearchParams
  try {
    params = new URL(url, 'http://sailor.local').searchParams
  } catch {
    return null
  }
  const filename = params.get('filename')
  if (!filename) return null
  return {
    kind: classifyOutput(filename),
    filename,
    subfolder: params.get('subfolder') || '',
    type: params.get('type') || 'output',
  }
}

/** Merge candidate lists in priority order — first source wins, deduped by
 *  subfolder/filename, capped. Shared by cover extraction and the grid. */
export function buildPreviewImages(sources: GenOutput[][], cap = COVER_CAP): GenOutput[] {
  const out: GenOutput[] = []
  const seen = new Set<string>()
  for (const src of sources) {
    for (const img of src) {
      const key = `${img.subfolder}/${img.filename}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(img)
      if (out.length >= cap) return out
    }
  }
  return out
}

/** Scan a saved ProjectDoc for preview-able images. Priority: Frame
 *  composites (the deliverable) → Scene3D beauty bakes → any other node's
 *  persisted preview. Images only; max COVER_CAP. */
export function extractCoverImages(doc: any): GenOutput[] {
  const frames: GenOutput[] = []
  const scene3d: GenOutput[] = []
  const rest: GenOutput[] = []
  // Legacy pre-ProjectDoc saves are a bare litegraph workflow.
  const canvases = Array.isArray(doc?.canvases) ? doc.canvases : [{ workflow: doc }]
  for (const c of canvases) {
    const nodes = c?.workflow?.nodes
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (node?.type === 'Scene3DStudio') {
        const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : []
        for (const v of widgets) {
          if (typeof v === 'string' && SCENE3D_BEAUTY_RE.test(v)) {
            scene3d.push({ kind: 'image', filename: v, subfolder: '', type: 'input' })
          }
        }
      }
      const imgs = node?.properties?.sailor_preview?.images
      if (!Array.isArray(imgs)) continue
      const bucket = node?.type === 'Compositor' ? frames : rest
      for (const u of imgs) {
        const parsed = parseViewUrl(u)
        if (parsed?.kind === 'image') bucket.push(parsed)
      }
    }
  }
  return buildPreviewImages([frames, scene3d, rest], COVER_CAP)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/project-cover.unit.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/projectCover.ts frontend/tests/unit/project-cover.unit.spec.ts
git commit -m "feat(previews): projectCover lib — extract studio/Frame preview images from a saved doc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `setProjectCover` client API + cover typing

**Files:**
- Modify: `frontend/app/composables/useProjects.ts` (interface `ProjectMeta` at lines 15-20, interface `Project` at lines 39-47, new function next to `renameProject` at lines 131-137, return object at line 187)

**Interfaces:**
- Consumes: existing `PUT /sailor/projects/{uuid}` route (already persists a `cover` body field verbatim — `comfy_extras/nodes_sailor_projects.py:482-483`; no server change).
- Produces: `setProjectCover(uuid: string, cover: GenOutput[]): Promise<void>` exported from `useProjects()`; `ProjectMeta.cover: GenOutput[] | string | null`.

No unit test: this mirrors the untested thin `$fetch` wrappers beside it (`renameProject`, `deleteProject`); behavior is covered by Task 5's live verification.

- [ ] **Step 1: Widen the cover types**

In `frontend/app/composables/useProjects.ts`, change the import (line 13) and both `cover` fields:

```typescript
import type { GenerationRecord, GenOutput } from '~/lib/generations'
```

```typescript
export interface ProjectMeta {
  uuid: string
  name: string | null
  // Preview images stamped from the saved doc (studio/Frame renders); the
  // string form never shipped but stays tolerated in old project.json files.
  cover: GenOutput[] | string | null
  updatedAt: number | null
}
```

In `export interface Project` change `cover: string | null` to `cover: GenOutput[] | string | null`.

- [ ] **Step 2: Add `setProjectCover`**

Directly below `renameProject` (after line 137):

```typescript
  /** Stamp the project's preview images (derived from the saved doc — see
   *  ~/lib/projectCover). Fire-and-forget safe: failures only warn. */
  async function setProjectCover(uuid: string, cover: GenOutput[]): Promise<void> {
    try {
      await $fetch(`/sailor/projects/${encodeURIComponent(uuid)}`, { method: 'PUT', body: { cover } })
    } catch (e) {
      console.warn('[useProjects] setProjectCover failed:', e)
    }
  }
```

Add `setProjectCover` to the return object on line 187 (after `deleteProject`).

- [ ] **Step 3: Verify it compiles in isolation**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/project-cover.unit.spec.ts`
Expected: PASS (confirms `~/lib/generations` exports still resolve; the composable itself has no test harness).

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useProjects.ts
git commit -m "feat(previews): setProjectCover client API; cover typed as preview image list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Grid sourcing — input-asset fallback + cover fallback

**Files:**
- Modify: `frontend/app/composables/useRecentProjects.ts` (imports at line 1, durable-project loop at lines 76-94)

**Interfaces:**
- Consumes: `buildPreviewImages(sources, cap?)` from Task 1; `ProjectMeta.cover: GenOutput[] | string | null` from Task 2.
- Produces: unchanged `RecentProject.images: { filename; subfolder; type }[]` — no consumer changes.

- [ ] **Step 1: Update imports**

Replace line 1 of `frontend/app/composables/useRecentProjects.ts`:

```typescript
import { historyEntryToRecord, type GenOutput } from '~/lib/generations'
import { buildPreviewImages } from '~/lib/projectCover'
```

- [ ] **Step 2: Replace the image collector in the durable loop**

Replace lines 79-85 (`const images: … = []` through the closing `}` of the `for (const g of gens)` loop):

```typescript
        // Paid renders (type 'output') headline the card; studio/Frame assets
        // recorded as generations (type 'input' — recordAsset) fill behind
        // them, and the doc-derived cover (stamped at save time) is the last
        // resort so pure-studio projects aren't blank.
        const outputImages: GenOutput[] = []
        const inputAssets: GenOutput[] = []
        for (const g of gens) {
          if (g.promptId) recordedPromptIds.add(g.promptId)
          for (const o of g.outputs || []) {
            if (o.kind !== 'image') continue
            if (o.type === 'output') { if (outputImages.length < 3) outputImages.push(o) }
            else if (inputAssets.length < 3) inputAssets.push(o)
          }
        }
        const cover: GenOutput[] = Array.isArray(d.cover)
          ? d.cover.filter((c): c is GenOutput => !!c && typeof c.filename === 'string')
              .map((c) => ({ kind: c.kind || 'image', filename: c.filename, subfolder: c.subfolder || '', type: c.type || 'input' }))
          : []
        const images = buildPreviewImages([outputImages, inputAssets, cover])
```

The subsequent `projects.push({ … images, … })` (line 86-93) stays as-is. The `/history` fallback branch (lines 99-137) is untouched — history entries only ever contain `type: 'output'` files.

- [ ] **Step 3: Run the unit suite for the touched lib**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/project-cover.unit.spec.ts`
Expected: PASS.

- [ ] **Step 4: Compile-check the dev bundle**

With the dev server running (see `./dev.sh` note in Task 5 — skip if not running yet):
Run: `curl -s -o /dev/null -w "%{http_code}" 'http://127.0.0.1:3000/'`
Expected: `200` (no Vite compile error overlay). If no server is up, defer to Task 5.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useRecentProjects.ts
git commit -m "feat(previews): project cards fall back to studio/Frame input assets and doc cover

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Stamp the cover at durable-save time

**Files:**
- Modify: `frontend/app/layouts/default.vue` (`saveDurableVersion` at lines 1480-1490 plus a small helper beside it)

**Interfaces:**
- Consumes: `extractCoverImages(doc)` from Task 1; `setProjectCover(uuid, cover)` from Task 2; existing `saveVersion` semantics (resolves version id, `'stale'`, or `null`).
- Produces: nothing new — side effect only.

**CAUTION — parallel sessions:** `default.vue` may carry another session's uncommitted edits. Before committing, run `git diff frontend/app/layouts/default.vue` and stage ONLY this task's hunks (`git add -p` is unavailable non-interactively — use `git diff … > /tmp/x.patch`, edit to your hunks, `git apply --cached`) if any foreign hunks exist. If the file's only changes are yours, a plain `git add` of it is fine.

- [ ] **Step 1: Add the import**

In `frontend/app/layouts/default.vue` `<script setup>`, alongside the existing `~/lib` imports (search for `from '~/lib/projectDoc'`), add:

```typescript
import { extractCoverImages } from '~/lib/projectCover'
```

- [ ] **Step 2: Add the stamping helper + call**

Directly above `function saveDurableVersion` (line 1480), add:

```typescript
// Stamp doc-derived preview images (studio bakes, Frame composites — see
// ~/lib/projectCover) onto the project's cover so All Projects can show
// content for projects that never ran a paid render. Deduped per uuid so the
// 3 s debounced autosave doesn't re-PUT an unchanged cover every burst.
const lastSentCoverByProject = new Map<string, string>()
function stampProjectCover(uuid: string, doc: any) {
  const cover = extractCoverImages(doc)
  if (!cover.length) return
  const key = JSON.stringify(cover)
  if (lastSentCoverByProject.get(uuid) === key) return
  lastSentCoverByProject.set(uuid, key)
  useProjects().setProjectCover(uuid, cover)
}
```

Then in `saveDurableVersion`, extend the `.then` (lines 1486-1489) to stamp on success:

```typescript
  useProjects().saveVersion(tab.projectUuid, { id: 'current', name, workflow: doc }, name).then((id) => {
    if (id === 'stale') warnStaleSaveRejected()
    else if (!id) warnAutosaveFailure('The durable server copy of this project isn’t updating.')
    else stampProjectCover(tab.projectUuid, doc)
  })
```

- [ ] **Step 3: Compile-check**

Run: `curl -s -o /dev/null -w "%{http_code}" 'http://127.0.0.1:3000/'`
Expected: `200`. (If no dev server is running, start it per Task 5 Step 1 first.)

- [ ] **Step 4: Commit (own hunks only)**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git diff frontend/app/layouts/default.vue
```
If only this task's hunks appear:
```bash
git add frontend/app/layouts/default.vue
git commit -m "feat(previews): stamp project cover from saved doc on durable save

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Otherwise stage only your hunks via a filtered patch + `git apply --cached` before committing.

---

### Task 5: Live verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Ensure servers are up**

Check for running servers first (parallel sessions may own them): `ps aux | grep -E "nuxt|main.py" | grep -v grep`. If none, launch via `./dev.sh` (kills strays, starts Nuxt on 3000 + ComfyUI on 8188, reaps on exit). Always browse via `http://127.0.0.1:3000` — `localhost` hits the IPv6 WS listener and breaks.

- [ ] **Step 2: Seed a studio-only project**

In the app (browser tools): create a new project, add a studio node (e.g. Gradient Studio via the node catalog, or run `sailor:addNode` repro helper if available), render/close it so it bakes + records an asset, wait ≥3 s for the debounced autosave, then confirm via network tab (or `curl http://127.0.0.1:8188/sailor/projects` piped through `python3 -m json.tool`) that the project's `cover` is now a non-empty array.

- [ ] **Step 3: Verify the grid**

Open All Projects. Expected: the seeded project's card shows the studio render instead of "No preview". Also confirm a project with real generations still shows its generated outputs first (unchanged), and take a screenshot as proof.

- [ ] **Step 4: Regression sweep**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/project-cover.unit.spec.ts tests/unit/persist-takes.unit.spec.ts tests/unit/project-doc-recency.unit.spec.ts`
Expected: PASS (neighboring persistence suites unaffected).

---

## Self-review notes

- Spec coverage: layer 1 (input-asset fallback) = Task 3; cover stamping = Tasks 1+2+4; grid fallback to cover = Task 3; lazy backfill for old projects explicitly deferred (agreed follow-up).
- Type consistency: `GenOutput` used end-to-end; `buildPreviewImages(sources, cap?)` signature identical in Tasks 1 and 3; `setProjectCover(uuid, cover)` identical in Tasks 2 and 4.
- No server changes anywhere; `cover` persists via the existing PUT.
