# Capture-and-save Effect Thumbnails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Capture thumbnail" button in the Type Studio editor snapshots the current preview frame and saves it per-effect; the gallery loads the saved images. Drop the offscreen auto-generator.

**Architecture:** Backend routes (mirroring scene-defaults) save/serve per-effect PNGs. A `useEffectThumbnails` composable loads the `{id: url}` map and saves captures. The editor renders the current frame, downscales it, and POSTs it. The gallery loads the map.

**Tech Stack:** ComfyUI Python (aiohttp via PromptServer), Nuxt 4 / Vue 3 / TS, Vitest, pytest.

## Global Constraints

- Reuse `_valid_effect_id` (`^[a-z0-9]+$`, traversal guard) for all thumbnail routes.
- Capture = the **current preview frame** (`previewFrame`), downscaled preserving the output aspect.
- The Capture button is gated by a `SHOW_THUMB_CAPTURE` constant.
- Graceful: any fetch failure → empty map (label-only cards), never throw.
- Frontend tests: `cd frontend && npx vitest run <path>`. `vue-tsc --noEmit` has a large baseline — only confirm no NEW errors in touched files. Python: `pytest tests-unit/comfy_extras_test/<file> -v`. Commit on `main`; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Backend routes — save / list / serve thumbnails

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (helper near `_scene_defaults_dir`; routes inside the `try: from server import PromptServer` block, beside the `space_default` routes)
- Test: `tests-unit/comfy_extras_test/spacetype_thumbnails_test.py` (create)

**Interfaces:**
- Produces: `_scene_thumbnails_dir()`; `POST /sailor/space_thumbnail/{effect_id}` (save bytes), `GET /sailor/space_thumbnails` (`{id: url}` map), `GET /sailor/space_thumbnail/{effect_id}` (serve PNG).

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/spacetype_thumbnails_test.py`:

```python
import importlib
nt = importlib.import_module("comfy_extras.nodes_timeline")

def test_scene_thumbnails_dir_under_bridge():
    d = nt._scene_thumbnails_dir()
    assert d.endswith("scene_thumbnails")
    assert "sailor_bridge" in d

def test_thumbnails_reuse_effect_id_validator():
    assert nt._valid_effect_id("ribbon")
    assert not nt._valid_effect_id("../x")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests-unit/comfy_extras_test/spacetype_thumbnails_test.py -v`
Expected: FAIL — `_scene_thumbnails_dir` not defined.

- [ ] **Step 3: Add the helper + routes**

Add the helper next to `_scene_defaults_dir`:
```python
def _scene_thumbnails_dir() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "custom_nodes", "sailor_bridge", "scene_thumbnails"))
```

Inside the `try: from server import PromptServer` block (next to the `space_default` routes), add:
```python
    @PromptServer.instance.routes.get("/sailor/space_thumbnails")
    async def _space_thumbnails_list(request):
        out = {}
        d = _scene_thumbnails_dir()
        if os.path.isdir(d):
            for fn in os.listdir(d):
                if fn.endswith(".png") and _valid_effect_id(fn[:-4]):
                    eid = fn[:-4]
                    mtime = int(os.path.getmtime(os.path.join(d, fn)))
                    out[eid] = f"/sailor/space_thumbnail/{eid}?v={mtime}"
        return web.json_response(out)

    @PromptServer.instance.routes.post("/sailor/space_thumbnail/{effect_id}")
    async def _space_thumbnail_save(request):
        effect_id = request.match_info.get("effect_id", "")
        if not _valid_effect_id(effect_id):
            return web.json_response({"error": "invalid effect id"}, status=400)
        data = await request.read()
        if not data:
            return web.json_response({"error": "empty body"}, status=400)
        d = _scene_thumbnails_dir()
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{effect_id}.png"), "wb") as f:
            f.write(data)
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.get("/sailor/space_thumbnail/{effect_id}")
    async def _space_thumbnail_get(request):
        effect_id = request.match_info.get("effect_id", "")
        if not _valid_effect_id(effect_id):
            return web.json_response({"error": "invalid effect id"}, status=400)
        p = os.path.join(_scene_thumbnails_dir(), f"{effect_id}.png")
        if not os.path.isfile(p):
            return web.json_response({"error": "not found"}, status=404)
        with open(p, "rb") as f:
            return web.Response(body=f.read(), content_type="image/png")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests-unit/comfy_extras_test/spacetype_thumbnails_test.py -v`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/spacetype_thumbnails_test.py
git commit -m "feat(space-type): backend routes for captured effect thumbnails

POST /sailor/space_thumbnail/{id} saves a PNG; GET .../space_thumbnails
returns the {id: url} map; GET .../space_thumbnail/{id} serves the PNG.
Mirrors scene-defaults; effect_id validated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `useEffectThumbnails` composable

**Files:**
- Create: `frontend/app/composables/useEffectThumbnails.ts`
- Test: `frontend/tests/unit/use-effect-thumbnails.unit.spec.ts`

**Interfaces:**
- Produces: `loadEffectThumbnails(): Promise<Record<string,string>>` (memoized), `effectThumbUrl(id): string|null`, `saveEffectThumbnail(id, blob): Promise<boolean>`, `__resetEffectThumbnailsCache()`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/use-effect-thumbnails.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadEffectThumbnails, effectThumbUrl, saveEffectThumbnail, __resetEffectThumbnailsCache } from '~/composables/useEffectThumbnails'

beforeEach(() => { __resetEffectThumbnailsCache(); vi.restoreAllMocks() })

describe('useEffectThumbnails', () => {
  it('fetches the map once and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ribbon: '/sailor/space_thumbnail/ribbon?v=1' }) })
    vi.stubGlobal('fetch', fetchMock)
    await loadEffectThumbnails(); await loadEffectThumbnails()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(effectThumbUrl('ribbon')).toContain('/sailor/space_thumbnail/ribbon')
    expect(effectThumbUrl('field')).toBeNull()
  })
  it('resolves {} on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect(await loadEffectThumbnails()).toEqual({})
  })
  it('saveEffectThumbnail posts and updates the cache', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })       // load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // save
    vi.stubGlobal('fetch', fetchMock)
    await loadEffectThumbnails()
    const ok = await saveEffectThumbnail('coil', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    expect(ok).toBe(true)
    expect(effectThumbUrl('coil')).toContain('/sailor/space_thumbnail/coil')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/use-effect-thumbnails.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the composable**

Create `frontend/app/composables/useEffectThumbnails.ts`:

```ts
let _cache: Promise<Record<string, string>> | null = null
let _resolved: Record<string, string> = {}

/** Fetch the {effectId: imageUrl} map of captured thumbnails once; memoized. Failure → {}. */
export function loadEffectThumbnails(): Promise<Record<string, string>> {
  if (!_cache) {
    _cache = fetch('/sailor/space_thumbnails')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m: Record<string, string>) => { _resolved = m || {}; return _resolved })
  }
  return _cache
}

/** Sync read of the resolved map (null before load resolves or if the effect has no thumbnail). */
export function effectThumbUrl(id: string): string | null { return _resolved[id] ?? null }

/** POST a captured PNG as effect `id`'s thumbnail; updates the cached URL (cache-busted) on success. */
export async function saveEffectThumbnail(id: string, blob: Blob): Promise<boolean> {
  try {
    const r = await fetch(`/sailor/space_thumbnail/${id}`, { method: 'POST', body: blob })
    if (!r.ok) return false
    _resolved = { ..._resolved, [id]: `/sailor/space_thumbnail/${id}?v=${Date.now()}` }
    return true
  } catch { return false }
}

/** Test-only: reset the module cache. */
export function __resetEffectThumbnailsCache(): void { _cache = null; _resolved = {} }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/use-effect-thumbnails.unit.spec.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useEffectThumbnails.ts frontend/tests/unit/use-effect-thumbnails.unit.spec.ts
git commit -m "feat(space-type): useEffectThumbnails composable (load map / save capture)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Editor — "Capture thumbnail" button

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`

**Interfaces:**
- Consumes: `saveEffectThumbnail` (Task 2); the existing `engine`, `previewFrame`, `stopPreview`/`startPreview`, `W`/`H`, `effectId`, `params`.

- [ ] **Step 1: Import + flag + state + handler**

In `SpaceTypeSurface.vue` script, add the import (near the other composable imports):
```ts
import { saveEffectThumbnail } from '~/composables/useEffectThumbnails'
```
Add a module-level flag (near the top consts) and the capture state/handler (near `makeAsDefault`):
```ts
// Authoring tool: flip to false (or remove the button) once all effect thumbnails are captured.
const SHOW_THUMB_CAPTURE = true
```
```ts
const capturingThumb = ref(false)
async function captureThumbnail() {
  if (!engine) return
  capturingThumb.value = true
  stopPreview()
  try {
    const tw = 480
    const th = Math.max(1, Math.round(tw * H.value / W.value))
    engine.renderFrame(previewFrame, params)   // capture the frame currently on screen
    const blob = await engine.frameToBlob(tw, th)
    const ok = await saveEffectThumbnail(effectId.value, blob)
    if (!ok) console.error('[space-type] failed to save thumbnail')
  } finally {
    capturingThumb.value = false
    startPreview()
  }
}
```

- [ ] **Step 2: Add the button**

In the Effect card (next to the existing "Make as default" button at ~line 725), add:
```vue
            <button v-if="SHOW_THUMB_CAPTURE" type="button" @click="captureThumbnail" :disabled="capturingThumb"
                    class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25 disabled:opacity-40">
              {{ capturingThumb ? 'Capturing…' : 'Capture thumbnail' }}
            </button>
```

- [ ] **Step 3: Typecheck + suite**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "SpaceTypeSurface.vue" | grep -v "(1[01][0-9]," || echo "(no new errors)"` then `npx vitest run tests/unit/`
Expected: no new errors (known onVibeRevert error excepted); suite green.
Manual (needs ComfyUI running): frame an effect, click "Capture thumbnail" → no error; re-open gallery shows the captured image for that effect.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(space-type): Capture thumbnail button (current frame → saved per-effect)

Renders the current preview frame, downscales it, POSTs it as the effect's
gallery thumbnail. Gated by SHOW_THUMB_CAPTURE.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Gallery loads saved thumbnails + remove the auto-generator

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue`
- Delete: `frontend/app/lib/spacetype/thumbnails.ts`, `frontend/tests/unit/spacetype-thumbnails.unit.spec.ts`

**Interfaces:**
- Consumes: `loadEffectThumbnails` (Task 2).

- [ ] **Step 1: Point the gallery at saved thumbnails**

In `SpaceTypeEffectGalleryModal.vue`, replace the import + onMounted:
```ts
import { loadEffectThumbnails } from '~/composables/useEffectThumbnails'
// ...
onMounted(async () => { thumbs.value = await loadEffectThumbnails() })
```
(Remove the `import { effectThumbnails } from '~/lib/spacetype/thumbnails'`. The `#card` template's `thumbs[id]` is now a URL — no other change.)

- [ ] **Step 2: Delete the auto-generator**

```bash
git rm frontend/app/lib/spacetype/thumbnails.ts frontend/tests/unit/spacetype-thumbnails.unit.spec.ts
```
Then grep to confirm nothing else imports it:
Run: `cd frontend && grep -rn "spacetype/thumbnails" app tests || echo "(no remaining refs)"`
Expected: `(no remaining refs)`.

- [ ] **Step 3: Typecheck + suite**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "SpaceTypeEffectGalleryModal.vue|spacetype/thumbnails" || echo "(clean)"` then `npx vitest run tests/unit/`
Expected: clean + suite green (the deleted thumbnails spec is gone).

- [ ] **Step 4: Commit**

```bash
git add -A frontend/app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue
git commit -m "feat(space-type): gallery loads captured thumbnails; drop offscreen auto-gen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd frontend && npm run test:unit` — full suite green (incl. use-effect-thumbnails; thumbnails spec removed).
- [ ] `pytest tests-unit/comfy_extras_test/spacetype_thumbnails_test.py -v` — green.
- [ ] `cd frontend && npx vue-tsc --noEmit` — no new errors in touched files.
- [ ] **In-app (needs ComfyUI restarted for the new routes):** Capture a thumbnail for an effect → it shows in the gallery; re-capture updates it; uncaptured effects show label-only cards.

## Notes / deferred

- New routes require a ComfyUI restart.
- `scene_thumbnails/` is under the gitignored `custom_nodes/` — same commit/ship caveat as scene-defaults (open `.gitignore`-exception decision).
- Flip `SHOW_THUMB_CAPTURE` to false once thumbnails are captured.
