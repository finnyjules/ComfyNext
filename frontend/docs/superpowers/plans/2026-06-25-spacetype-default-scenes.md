# Type Studio Default Scenes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-service "Make as default" button that persists an authored Type Studio scene as that effect's default look, applied by fresh node cards and the editor.

**Architecture:** Backend routes write/read per-effect scene JSON files (committable). A cached frontend composable loads them once; pure helpers neutralize the camera and merge a scene onto state; the node card and editor apply the default scene for fresh/unconfigured nodes and effect-switches, with a node's own saved config always winning.

**Tech Stack:** ComfyUI Python (aiohttp routes via `PromptServer`), Nuxt 4 / Vue 3 / TypeScript, Vitest, pytest.

## Global Constraints

- Type Studio only. A node's saved config always wins over a default scene.
- Default scene captures the LOOK: `params + post + projection + panX/Y + bgColor + gradientStops`. **Excludes** dims/fps/W/H/transparent.
- On "Make as default", neutralize the camera in the saved payload: `rotateX/rotateY/rotateZ → 0`, `scale → 1` (only for param keys that exist), `panX/panY → 0`. Do NOT mutate the live editor sliders.
- `effectId` validated server-side as `^[a-z0-9]+$` (no path traversal).
- Graceful fallback: any fetch failure → behave exactly as today (no default scenes).
- Frontend tests: `cd frontend && npx vitest run <path>`. `vue-tsc --noEmit` has a large pre-existing baseline — only check no NEW errors in touched files. Python tests: `pytest tests-unit/comfy_extras_test/<file> -v`. Commit on `main`; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Backend routes + storage

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (inside the `try: from server import PromptServer` block, after `_spacetype_encode_route`, ~line 1250)
- Test: `tests-unit/comfy_extras_test/spacetype_defaults_test.py` (create)

**Interfaces:**
- Produces: `POST /comfynext/space_default/{effect_id}` (writes a scene file), `GET /comfynext/space_defaults` (returns `{effectId: scene}` map). A pure helper `_scene_defaults_dir()` and `_valid_effect_id(s)` for testability.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/spacetype_defaults_test.py`:

```python
import importlib
nt = importlib.import_module("comfy_extras.nodes_timeline")

def test_valid_effect_id_accepts_lowercase_alnum():
    assert nt._valid_effect_id("ribbon")
    assert nt._valid_effect_id("sliceglitch")

def test_valid_effect_id_rejects_traversal_and_caps():
    assert not nt._valid_effect_id("../etc")
    assert not nt._valid_effect_id("a/b")
    assert not nt._valid_effect_id("Ribbon")
    assert not nt._valid_effect_id("")

def test_scene_defaults_dir_is_under_bridge(tmp_path, monkeypatch):
    d = nt._scene_defaults_dir()
    assert d.endswith("scene_defaults")
    assert "comfynext_bridge" in d
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests-unit/comfy_extras_test/spacetype_defaults_test.py -v`
Expected: FAIL — `_valid_effect_id` / `_scene_defaults_dir` not defined.

- [ ] **Step 3: Add the helpers + routes**

In `comfy_extras/nodes_timeline.py`, add module-level helpers near the top (after the existing imports — `os`, `json`, `re` are needed; add `import re` / `import json` if not already imported):

```python
def _valid_effect_id(s: str) -> bool:
    return isinstance(s, str) and re.fullmatch(r"[a-z0-9]+", s) is not None

def _scene_defaults_dir() -> str:
    # comfy_extras/ -> repo root -> custom_nodes/comfynext_bridge/scene_defaults
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "custom_nodes", "comfynext_bridge", "scene_defaults"))
```

Inside the `try: from server import PromptServer` block (after `_spacetype_encode_route`), add:

```python
    @PromptServer.instance.routes.get("/comfynext/space_defaults")
    async def _space_defaults_list(request):
        out = {}
        d = _scene_defaults_dir()
        if os.path.isdir(d):
            for fn in os.listdir(d):
                if fn.endswith(".json") and _valid_effect_id(fn[:-5]):
                    try:
                        with open(os.path.join(d, fn), "r", encoding="utf-8") as f:
                            out[fn[:-5]] = json.load(f)
                    except Exception:
                        pass
        return web.json_response(out)

    @PromptServer.instance.routes.post("/comfynext/space_default/{effect_id}")
    async def _space_default_save(request):
        effect_id = request.match_info.get("effect_id", "")
        if not _valid_effect_id(effect_id):
            return web.json_response({"error": "invalid effect id"}, status=400)
        try:
            scene = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        d = _scene_defaults_dir()
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{effect_id}.json"), "w", encoding="utf-8") as f:
            json.dump(scene, f, indent=2)
        return web.json_response({"ok": True})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests-unit/comfy_extras_test/spacetype_defaults_test.py -v`
Expected: PASS (3 tests). If `re`/`json` import errors, add the missing `import` at the top of the module.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/spacetype_defaults_test.py
git commit -m "feat(space-type): backend routes for per-effect default scenes

GET /comfynext/space_defaults returns the {effectId: scene} map; POST
/comfynext/space_default/{id} writes a committable scene_defaults/<id>.json.
effect_id validated (^[a-z0-9]+$) against path traversal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Scene helpers (pure)

**Files:**
- Create: `frontend/app/lib/spacetype/scene.ts`
- Test: `frontend/tests/unit/spacetype-scene.unit.spec.ts`

**Interfaces:**
- Consumes: `Params` from `./effect`; `PostSettings` from `./post`; `GradientStop` from `./gradient`; `SpaceTypeState` from `./state`.
- Produces:
  - `type Scene = { params: Params; post?: PostSettings; projection?: 'perspective'|'isometric'; panX?: number; panY?: number; bgColor?: string; gradientStops?: GradientStop[] }`
  - `neutralizeCamera(params: Params): Params`
  - `applySceneToState(base: SpaceTypeState, scene: Scene): SpaceTypeState`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-scene.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { neutralizeCamera, applySceneToState, type Scene } from '~/lib/spacetype/scene'
import { defaultSpaceTypeState } from '~/lib/spacetype/state'

describe('neutralizeCamera', () => {
  it('zeros rotate + sets scale 1 only for keys present', () => {
    const out = neutralizeCamera({ rotateX: 0.5, rotateY: -0.3, rotateZ: 0.2, scale: 1.7, depth: 4 })
    expect(out).toMatchObject({ rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, depth: 4 })
  })
  it('does not add keys the effect lacks', () => {
    const out = neutralizeCamera({ depth: 4 })
    expect('rotateX' in out).toBe(false)
    expect('scale' in out).toBe(false)
  })
  it('does not mutate the input', () => {
    const input = { rotateX: 0.5 }
    neutralizeCamera(input)
    expect(input.rotateX).toBe(0.5)
  })
})

describe('applySceneToState', () => {
  it('replaces params and overrides present look fields', () => {
    const base = defaultSpaceTypeState()
    const scene: Scene = { params: { text: 'HI' }, projection: 'isometric', panX: 0.2, bgColor: '#123456' }
    const out = applySceneToState(base, scene)
    expect(out.params).toEqual({ text: 'HI' })
    expect(out.projection).toBe('isometric')
    expect(out.panX).toBe(0.2)
    expect(out.bgColor).toBe('#123456')
  })
  it('leaves base fields when the scene omits them', () => {
    const base = { ...defaultSpaceTypeState(), bgColor: '#aaaaaa' }
    const out = applySceneToState(base, { params: { text: 'X' } })
    expect(out.bgColor).toBe('#aaaaaa')
    expect(out.fps).toBe(base.fps)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-scene.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scene.ts`**

Create `frontend/app/lib/spacetype/scene.ts`:

```ts
import type { Params } from './effect'
import type { PostSettings } from './post'
import type { GradientStop } from './gradient'
import type { SpaceTypeState } from './state'

export interface Scene {
  params: Params
  post?: PostSettings
  projection?: 'perspective' | 'isometric'
  panX?: number
  panY?: number
  bgColor?: string
  gradientStops?: GradientStop[]
}

const CAMERA_ZERO = ['rotateX', 'rotateY', 'rotateZ'] as const

/** A copy of params with the camera/framing neutralized: rotate→0, scale→1 — but only for keys
 *  the effect actually declares (so we never inject controls it doesn't have). */
export function neutralizeCamera(params: Params): Params {
  const out: Params = { ...params }
  for (const k of CAMERA_ZERO) if (k in out) out[k] = 0
  if ('scale' in out) out.scale = 1
  return out
}

/** Merge a saved scene over a base state: params replace; post/projection/pan/bg/gradientStops
 *  override only when the scene provides them. Pure — returns a new state. */
export function applySceneToState(base: SpaceTypeState, scene: Scene): SpaceTypeState {
  return {
    ...base,
    params: { ...scene.params },
    ...(scene.post ? { post: { ...scene.post } } : {}),
    ...(scene.projection ? { projection: scene.projection } : {}),
    ...(scene.panX !== undefined ? { panX: scene.panX } : {}),
    ...(scene.panY !== undefined ? { panY: scene.panY } : {}),
    ...(scene.bgColor ? { bgColor: scene.bgColor } : {}),
    ...(scene.gradientStops ? { gradientStops: scene.gradientStops.map(g => ({ ...g })) } : {}),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-scene.unit.spec.ts`
Expected: PASS. (This depends on Task 4's `SpaceTypeState` optional fields for `post/projection/panX/panY` to typecheck — if `vue-tsc` complains here, it resolves once Task 4 lands; the runtime test still passes. Do Task 4's state.ts change first if you prefer strict typecheck order.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/scene.ts frontend/tests/unit/spacetype-scene.unit.spec.ts
git commit -m "feat(space-type): scene helpers (neutralizeCamera, applySceneToState)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cached defaults composable

**Files:**
- Create: `frontend/app/composables/useSpaceDefaults.ts`
- Test: `frontend/tests/unit/use-space-defaults.unit.spec.ts`

**Interfaces:**
- Consumes: `Scene` from `~/lib/spacetype/scene`.
- Produces:
  - `loadSpaceDefaults(): Promise<Record<string, Scene>>` — memoized GET (resolves `{}` on error)
  - `spaceDefaultFor(id: string): Scene | null` — sync read of the resolved map (null before load / if absent)
  - `saveSpaceDefault(id: string, scene: Scene): Promise<boolean>` — POST + update cache; returns success
  - `__resetSpaceDefaultsCache()` — test-only cache reset

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/use-space-defaults.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadSpaceDefaults, spaceDefaultFor, saveSpaceDefault, __resetSpaceDefaultsCache } from '~/composables/useSpaceDefaults'

beforeEach(() => { __resetSpaceDefaultsCache(); vi.restoreAllMocks() })

describe('useSpaceDefaults', () => {
  it('fetches the map once and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ribbon: { params: { text: 'R' } } }) })
    vi.stubGlobal('fetch', fetchMock)
    await loadSpaceDefaults(); await loadSpaceDefaults()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spaceDefaultFor('ribbon')?.params.text).toBe('R')
    expect(spaceDefaultFor('field')).toBeNull()
  })
  it('resolves to {} on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect(await loadSpaceDefaults()).toEqual({})
  })
  it('saveSpaceDefault posts and updates the cache', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })       // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // save
    vi.stubGlobal('fetch', fetchMock)
    await loadSpaceDefaults()
    const ok = await saveSpaceDefault('coil', { params: { text: 'C' } })
    expect(ok).toBe(true)
    expect(spaceDefaultFor('coil')?.params.text).toBe('C')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/use-space-defaults.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the composable**

Create `frontend/app/composables/useSpaceDefaults.ts`:

```ts
import type { Scene } from '~/lib/spacetype/scene'

let _cache: Promise<Record<string, Scene>> | null = null
let _resolved: Record<string, Scene> = {}

/** Fetch the {effectId: scene} default map once; memoized. Network failure → {} (today's behavior). */
export function loadSpaceDefaults(): Promise<Record<string, Scene>> {
  if (!_cache) {
    _cache = fetch('/comfynext/space_defaults')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m: Record<string, Scene>) => { _resolved = m || {}; return _resolved })
  }
  return _cache
}

/** Synchronous read of the resolved map (null before load resolves or if the effect has none). */
export function spaceDefaultFor(id: string): Scene | null {
  return _resolved[id] ?? null
}

/** Persist a scene as effect `id`'s default; updates the in-memory cache on success. */
export async function saveSpaceDefault(id: string, scene: Scene): Promise<boolean> {
  try {
    const r = await fetch(`/comfynext/space_default/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scene),
    })
    if (!r.ok) return false
    _resolved = { ..._resolved, [id]: scene }
    return true
  } catch { return false }
}

/** Test-only: reset the module cache. */
export function __resetSpaceDefaultsCache(): void { _cache = null; _resolved = {} }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/use-space-defaults.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useSpaceDefaults.ts frontend/tests/unit/use-space-defaults.unit.spec.ts
git commit -m "feat(space-type): cached useSpaceDefaults composable (load/save map)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: State type + node card renders & applies default scene

**Files:**
- Modify: `frontend/app/lib/spacetype/state.ts` (`SpaceTypeState` interface)
- Modify: `frontend/app/components/vue-canvas/SpaceTypeNode.vue`

**Interfaces:**
- Consumes: `loadSpaceDefaults`, `spaceDefaultFor` (Task 3); `applySceneToState` (Task 2); `DEFAULT_POST` from `~/lib/spacetype/post`.
- Produces: `SpaceTypeState` gains optional `post?: PostSettings`, `projection?: 'perspective'|'isometric'`, `panX?: number`, `panY?: number`. The card renders those and applies a default scene to fresh nodes.

- [ ] **Step 1: Extend `SpaceTypeState`**

In `frontend/app/lib/spacetype/state.ts`, add the import and optional fields:

```ts
import type { PostSettings } from './post'
// ...
export interface SpaceTypeState {
  effectId: string
  params: Params
  gradientStops: { color: string; on: boolean }[]
  fps: number
  loopDuration: number
  dimsKey: string
  transparent: boolean
  bgColor: string
  post?: PostSettings
  projection?: 'perspective' | 'isometric'
  panX?: number
  panY?: number
}
```

- [ ] **Step 2: Make the card render post/projection/pan**

In `SpaceTypeNode.vue`, import `DEFAULT_POST`:

```ts
import { DEFAULT_POST } from '~/lib/spacetype/post'
```

In `onMounted`, pass `projection` to the engine constructor and apply post/pan after build. Change the engine construction block to include `projection: s.projection ?? 'perspective'`, then after `rebuild()` add:

```ts
  engine.setPost({ ...(s.post ?? DEFAULT_POST) })
  engine.setPan(s.panX ?? 0, s.panY ?? 0)
```

In `rebuild()`, after `engine.setBackground(...)`, add:

```ts
  engine.setProjection(s.projection ?? 'perspective')
  engine.setPost({ ...(s.post ?? DEFAULT_POST) })
  engine.setPan(s.panX ?? 0, s.panY ?? 0)
```

- [ ] **Step 3: Apply a default scene to fresh nodes**

In `SpaceTypeNode.vue`, the preview currently reads `state` as a computed from props. Add a resolved-state ref that starts from the computed and, for a node with NO saved config, swaps to the effect's default scene once the map loads. Near the existing `state` computed, add:

```ts
import { loadSpaceDefaults, spaceDefaultFor } from '~/composables/useSpaceDefaults'
import { applySceneToState } from '~/lib/spacetype/scene'
// ...
const hadSavedConfig = !!props.data?.properties?.comfynext_spaceType
```

In `onMounted` (before building the engine), if there was no saved config, hydrate from a default scene:

```ts
  if (!hadSavedConfig) {
    await loadSpaceDefaults()
    const scene = spaceDefaultFor(defaultSpaceTypeState().effectId)
    if (scene) {
      const merged = applySceneToState(defaultSpaceTypeState(), scene)
      const n = props.data
      if (n) { (n.properties ||= {}).comfynext_spaceType = merged }
    }
  }
```

(Stamping onto `props.data.properties.comfynext_spaceType` makes the existing `state` computed pick it up and persists it on the node. The engine is then built from `state.value` as before.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "state.ts|SpaceTypeNode.vue|scene.ts" || echo "(clean)"`
Expected: no new errors in those files. Run `npx vitest run tests/unit/spacetype-scene.unit.spec.ts` again — now typecheck-clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/state.ts frontend/app/components/vue-canvas/SpaceTypeNode.vue
git commit -m "feat(space-type): card renders post/projection/pan + applies default scene

SpaceTypeState gains optional post/projection/pan; the node card now
applies them (faithful preview), and a fresh node hydrates from its
effect's default scene via the cached map.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Editor — apply default scene + "Make as default" button

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`

**Interfaces:**
- Consumes: `loadSpaceDefaults`, `spaceDefaultFor`, `saveSpaceDefault` (Task 3); `neutralizeCamera` (Task 2); the existing reactive refs `params`, `post`, `projection`, `panX`, `panY`, `bgColor`, `gradientStops`, `effectId`.

- [ ] **Step 1: Add a helper that applies a scene to the live editor state**

In `SpaceTypeSurface.vue` script, import and add:

```ts
import { loadSpaceDefaults, spaceDefaultFor, saveSpaceDefault } from '~/composables/useSpaceDefaults'
import { neutralizeCamera, type Scene } from '~/lib/spacetype/scene'

// Apply a saved default scene onto the live editor refs (used on fresh open / effect switch / reset).
function applyDefaultScene(scene: Scene) {
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, scene.params)
  if (scene.post) Object.assign(post, scene.post)
  if (scene.projection) projection.value = scene.projection
  if (scene.panX !== undefined) panX.value = scene.panX
  if (scene.panY !== undefined) panY.value = scene.panY
  if (scene.bgColor) bgColor.value = scene.bgColor
  if (scene.gradientStops) gradientStops.splice(0, gradientStops.length, ...scene.gradientStops.map(g => ({ ...g })))
  pullTextLines(); pullFills()
}
```

- [ ] **Step 2: Apply default scene on fresh open and effect switch**

In `onMounted`, after `loadConfig()` and `pullTextLines()/pullFills()`, when there is no saved config, apply the default scene:

```ts
  const hadConfig = !!currentNode()?.data?.properties?.comfynext_spaceType
  await loadSpaceDefaults()
  if (!hadConfig) { const sc = spaceDefaultFor(effectId.value); if (sc) applyDefaultScene(sc) }
```

In `applyEffectDefaults()` (the shared reset/switch helper from the hardening pass), after it restores control defaults + `rebuild()`, apply the new effect's default scene if present. Change its tail so that after the defaults are assigned it does:

```ts
  const sc = spaceDefaultFor(effect.value.id)
  if (sc) applyDefaultScene(sc)
  await ensureEffectFonts()
  rebuild()
```

(So an effect switch lands on the default scene when one exists, else the control defaults — preserving today's behavior for effects without a saved scene. "Reset to defaults" reuses `applyEffectDefaults`, so it also returns to the default scene.)

- [ ] **Step 3: Add the "Make as default" button**

In the Effect card template (next to the existing "Reset to defaults" button, from the hardening pass), add:

```vue
<button type="button" @click="makeAsDefault" :disabled="savingDefault"
        class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25 disabled:opacity-40">
  {{ savingDefault ? 'Saving…' : 'Make as default' }}
</button>
```

Add the handler + state in the script:

```ts
const savingDefault = ref(false)
async function makeAsDefault() {
  savingDefault.value = true
  try {
    const scene: Scene = {
      params: neutralizeCamera(params), // camera neutralized for the saved default (returns a copy)
      post: { ...post },
      projection: projection.value,
      panX: 0, panY: 0,
      bgColor: bgColor.value,
      gradientStops: gradientStops.map(g => ({ ...g })),
    }
    const ok = await saveSpaceDefault(effectId.value, scene)
    if (!ok) console.error('[space-type] failed to save default scene')
  } finally {
    savingDefault.value = false
  }
}
```

(`neutralizeCamera(params)` zeros rotate + sets scale 1; `panX/panY: 0` neutralize the framing. The live editor sliders are NOT changed — only the saved payload.)

- [ ] **Step 4: Typecheck + suite**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "SpaceTypeSurface.vue" | grep -v "(103," || echo "(no new errors)"` then `npx vitest run tests/unit/spacetype-*.unit.spec.ts`
Expected: no new errors (line 103 is the known pre-existing `onVibeRevert` error); suite green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(space-type): Make-as-default button + apply default scene in editor

Editor applies an effect's default scene on fresh open / switch / reset;
'Make as default' saves the current look (camera neutralized) via the
backend. Node saved config still wins.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd frontend && npm run test:unit` — full suite green (incl. the 3 new specs).
- [ ] `pytest tests-unit/comfy_extras_test/spacetype_defaults_test.py -v` — green.
- [ ] `cd frontend && npx vue-tsc --noEmit` — no new errors in touched files.
- [ ] **In-app sign-off** (needs ComfyUI restarted so the new routes load): author a Field scene with rotation + bloom → "Make as default" → add a fresh Type Studio node, switch it to Field → confirm the card + editor open with that look, camera neutral (front-on, centered, scale 1). Confirm an existing saved node is unchanged, and an effect with no saved scene still opens at its normal defaults.

## Notes / deferred

- New routes require a ComfyUI restart to register (bridge/back-end change).
- "Clear default" UI + propagation to other studios are out of scope.
