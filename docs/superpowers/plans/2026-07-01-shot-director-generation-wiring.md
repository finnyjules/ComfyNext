# Shot Director Phase 3 — Generation Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Shot Director studio's Generate button compiles the ShotSheet and runs a real Seedance 2.0 generation through the existing FilmShotNode rails, with the video landing as a downstream artifact; plus a "New take" reroll and a $-cost estimate.

**Architecture:** Shot Director stays a config-only studio. Generate → `compileShot()` (already built) → a pure `buildFilmShotPatch()` splits the compiled Replicate input into FilmShotNode widget values (prompt/model/aspect_ratio/duration/seed) + a `model_options` JSON carrying references/resolution/audio flags → the canvas finds-or-spawns an adjacent FilmShotNode, patches its widgets, and fires the existing `comfynext:runFiltered` run. On the Python side, `_b_seedance_2_0` learns to forward those `model_options` keys and drops the schema-invalid `camera_fixed`/`fps`. **No graph edge studio→film in v1** — ShotDirector bakes nothing (null baker), so we track the target via `comfynext_shotDirectorTargetId` in the studio node's data instead of risking a dangling edge into the film node's optional image input.

**Tech Stack:** Vue 3 / Nuxt 4 / TypeScript (frontend), Vitest unit tests, Python ComfyUI custom API nodes, pytest.

## Global Constraints

- Work directly on `main`; do NOT create branches (user rule).
- Stage files with explicit paths only; NEVER `git add -A` (user has parallel WIP).
- Python changes to `comfy_api_nodes/` require a ComfyUI restart to take effect (kill, don't hot-reload).
- Frontend tests: `cd frontend && npx vitest run tests/unit/<file>`. Python tests: `.venv/bin/python -m pytest tests-unit/comfy_api_test/<file> -v` from repo root.
- No violet/purple accents in any UI (user rule); use white-opacity neutrals + emerald only for run actions.
- Match surrounding code style; Vue UI classes follow the existing `text-[11px] text-white/50` idiom in `ShotDirectorSurface.vue`.
- Verified live-schema facts (do not "fix" these back): `bytedance/seedance-2.0` has NO `fps`, NO `camera_fixed`; references are mutually exclusive with first/last-frame `image`; refs tagged `[Image1]`-style in prompt.

---

### Task 1: Python — Seedance 2.0 builder: drop invalid fields, forward Shot Director inputs

**Files:**
- Modify: `comfy_api_nodes/video_models.py:234-248` (`_b_seedance_2_0`)
- Test: `tests-unit/comfy_api_test/video_models_seedance_test.py` (create)

**Interfaces:**
- Consumes: existing helpers in `video_models.py` — `_opt_str(adv, key, default)`, `_opt_bool(adv, key, default)`, `_dur_or(allowed, dur, fallback)`, `_maybe_set_seed(inp, seed)`, `_ar_or(_SEEDANCE_AR, ar, "16:9")`.
- Produces: `_b_seedance_2_0(prompt, ar, dur, seed, image, audio, adv)` that Task 3's `model_options` JSON keys feed: `resolution`, `generate_audio`, `image` (data URL), `last_frame_image`, `reference_images`, `reference_videos`, `reference_audios`. Builder signature is UNCHANGED (it's a registry `VideoModelInputBuilder`).

- [ ] **Step 1: Write the failing tests**

Create `tests-unit/comfy_api_test/video_models_seedance_test.py` (mirrors the header style of `video_models_kling_test.py`):

```python
"""Input-shape tests for the Seedance 2.0 builder.

Replicate's bytedance/seedance-2.0 schema (verified live 2026-06-30, see
docs/superpowers/specs/2026-06-30-shot-director-design.md) has NO fps and NO
camera_fixed fields, takes reference_images/videos/audios (mutually exclusive
with first/last-frame image), and generate_audio. The Shot Director forwards
those via the FilmShotNode's model_options JSON, which reaches the builder as
`adv`.
"""
from comfy_api_nodes.video_models import _b_seedance_2_0

DATA_URL = "data:image/png;base64,x"


def test_seedance_omits_schema_invalid_fields():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert "fps" not in inp, "bytedance/seedance-2.0 has no fps input"
    assert "camera_fixed" not in inp, "bytedance/seedance-2.0 has no camera_fixed input"


def test_seedance_plain_t2v_baseline():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert inp["prompt"] == "a dog"
    assert inp["duration"] == 5
    assert inp["resolution"] == "1080p"
    assert inp["aspect_ratio"] == "16:9"
    # generate_audio only sent when explicitly set — keeps plain Film a Shot
    # payloads unchanged.
    assert "generate_audio" not in inp


def test_seedance_forwards_reference_arrays():
    adv = {
        "reference_images": [DATA_URL, DATA_URL],
        "reference_videos": [DATA_URL],
        "reference_audios": [DATA_URL],
        "resolution": "720p",
        "generate_audio": True,
    }
    inp = _b_seedance_2_0("p", "9:16", 10, 7, None, None, adv)
    assert inp["reference_images"] == [DATA_URL, DATA_URL]
    assert inp["reference_videos"] == [DATA_URL]
    assert inp["reference_audios"] == [DATA_URL]
    assert inp["resolution"] == "720p"
    assert inp["generate_audio"] is True
    assert inp["aspect_ratio"] == "9:16"
    assert inp["seed"] == 7


def test_seedance_first_last_frame_via_adv():
    adv = {"image": DATA_URL, "last_frame_image": DATA_URL,
           "reference_images": [DATA_URL]}
    inp = _b_seedance_2_0("p", "16:9", 5, 0, None, None, adv)
    assert inp["image"] == DATA_URL
    assert inp["last_frame_image"] == DATA_URL
    # image dims replace aspect_ratio; refs are mutually exclusive with image
    assert "aspect_ratio" not in inp
    assert "reference_images" not in inp


def test_seedance_wired_image_wins_over_adv():
    wired = "data:image/png;base64,wired"
    inp = _b_seedance_2_0("p", "16:9", 5, 0, wired, None, {"image": DATA_URL})
    assert inp["image"] == wired
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/video_models_seedance_test.py -v`
Expected: FAIL — `test_seedance_omits_schema_invalid_fields` and the reference/first-last tests fail against the current builder (it sends `fps`/`camera_fixed`, ignores adv references).

- [ ] **Step 3: Rewrite the builder**

Replace `_b_seedance_2_0` in `comfy_api_nodes/video_models.py` (keep its position and the registry entry untouched):

```python
def _b_seedance_2_0(prompt, ar, dur, seed, image, audio, adv):
    # Live schema (verified 2026-06-30): no fps / camera_fixed. References
    # arrive via the FilmShotNode's model_options JSON (adv) — the Shot
    # Director forwards data URLs there. Refs XOR first/last-frame image.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": _dur_or([3, 5, 10, 15], dur, 5),
        "resolution": _opt_str(adv, "resolution", "1080p"),
    }
    if "generate_audio" in adv:
        inp["generate_audio"] = bool(adv["generate_audio"])
    # First frame: a wired IMAGE tensor (already a data URL here) wins over a
    # Shot Director data URL in adv.
    first = image or _opt_str(adv, "image", "")
    if first:
        inp["image"] = first
        if last := _opt_str(adv, "last_frame_image", ""):
            inp["last_frame_image"] = last
    else:
        inp["aspect_ratio"] = _ar_or(_SEEDANCE_AR, ar, "16:9")
        for key in ("reference_images", "reference_videos", "reference_audios"):
            vals = adv.get(key)
            if isinstance(vals, list) and vals:
                inp[key] = vals
    _maybe_set_seed(inp, seed)
    return inp
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/video_models_seedance_test.py tests-unit/comfy_api_test/video_models_kling_test.py -v`
Expected: ALL PASS (Kling suite proves no collateral damage).

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/video_models.py tests-unit/comfy_api_test/video_models_seedance_test.py
git commit -m "fix(video-models): seedance-2.0 builder — drop invalid fps/camera_fixed, forward references via model_options"
```

---

### Task 2: Frontend catalog — drop the phantom Seedance advanced fields

**Files:**
- Modify: `frontend/app/data/video-models.ts:295-300` (the `seedance-2.0` entry's `advanced` array)

**Interfaces:**
- Consumes: nothing new.
- Produces: the Seedance entry with `advanced: []` — the Film a Shot advanced panel stops offering knobs the API rejects. `CAMERA_FIXED` const stays (other models use it at lines 318+).

- [ ] **Step 1: Check for test/consumer references**

Run: `cd frontend && grep -rn "camera_fixed" app tests | grep -vi kling`
Expected: only the `CAMERA_FIXED` const definition (`app/data/video-models.ts:102`) and non-Seedance entries. If a Seedance-specific assertion exists in tests, update it in this task.

- [ ] **Step 2: Edit the entry**

In `frontend/app/data/video-models.ts`, replace the Seedance entry's advanced block:

```typescript
    advanced: [
      CAMERA_FIXED,
      { name: 'fps', type: 'select', label: 'Frame rate',
        default: '24', options: ['24', '30'] },
    ],
```

with:

```typescript
    // Live schema has no camera_fixed / fps (verified 2026-06-30).
    advanced: [],
```

- [ ] **Step 3: Run the frontend unit suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (no suite pins the Seedance advanced list; if one does, fix it here).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/data/video-models.ts
git commit -m "fix(video-models): drop phantom camera_fixed/fps advanced fields from Seedance 2.0 entry"
```

---

### Task 3: Pure dispatch mapping — `lib/shotdirector/dispatch.ts`

**Files:**
- Create: `frontend/app/lib/shotdirector/dispatch.ts`
- Test: `frontend/tests/unit/shotdirector-dispatch.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `ShotSheet` from `~/lib/shotdirector/types`, `CompileResult` from `~/lib/shotdirector/compile`, `ModelInput` from `~/lib/shotdirector/profiles`.
- Produces (Task 4 relies on these exact names):
  - `interface FilmShotWidgetPatch { prompt: string; model: string; aspect_ratio: string; duration: number; seed: number; model_options: string }`
  - `function buildFilmShotPatch(sheet: ShotSheet, result: CompileResult): FilmShotWidgetPatch`
  - `function findShotTarget(nodes: TargetNode[], edges: TargetEdge[], studioId: string, storedTargetId?: string | null): string | null` with `interface TargetNode { id: string; nodeType?: string }` / `interface TargetEdge { source: string; target: string }`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shotdirector-dispatch.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { compileShot } from '~/lib/shotdirector/compile'
import { buildFilmShotPatch, findShotTarget } from '~/lib/shotdirector/dispatch'
import { SEEDANCE_PROFILE } from '~/lib/shotdirector/profiles'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

const DATA_URL = 'data:image/png;base64,x'

function referenceSheet() {
  const sheet = createDefaultShotSheet()
  sheet.subject = 'a woman in a red coat'
  sheet.action = 'walks toward camera'
  sheet.references.push({ kind: 'image', slot: 1, src: DATA_URL, role: 'identity-lock' })
  sheet.format.durationS = 10
  sheet.format.resolution = '720p'
  sheet.format.seed = 42
  return sheet
}

describe('buildFilmShotPatch', () => {
  it('splits widget-native fields from model_options extras (reference mode)', () => {
    const sheet = referenceSheet()
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    expect(patch.model).toBe('seedance-2.0')
    expect(patch.prompt.length).toBeGreaterThan(0)
    expect(patch.duration).toBe(10)
    expect(patch.seed).toBe(42)
    expect(patch.aspect_ratio).toBe(sheet.format.aspectRatio)
    const opts = JSON.parse(patch.model_options)
    expect(opts.resolution).toBe('720p')
    expect(opts.reference_images).toEqual([DATA_URL])
    // widget-native keys must NOT leak into model_options
    for (const k of ['prompt', 'duration', 'aspect_ratio', 'seed']) {
      expect(opts).not.toHaveProperty(k)
    }
  })

  it('carries first/last frame through model_options in firstLastFrame mode', () => {
    const sheet = createDefaultShotSheet()
    sheet.subject = 's'
    sheet.action = 'a'
    sheet.mode = 'firstLastFrame'
    sheet.firstFrame = DATA_URL
    sheet.lastFrame = DATA_URL
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    const opts = JSON.parse(patch.model_options)
    expect(opts.image).toBe(DATA_URL)
    expect(opts.last_frame_image).toBe(DATA_URL)
    expect(opts.reference_images).toBeUndefined()
  })

  it('sends seed 0 when the sheet has no seed', () => {
    const sheet = referenceSheet()
    sheet.format.seed = 0
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    expect(patch.seed).toBe(0)
    expect(JSON.parse(patch.model_options)).not.toHaveProperty('seed')
  })
})

describe('findShotTarget', () => {
  const film = { id: 'f1', nodeType: 'FilmShotNode' }
  const other = { id: 'x1', nodeType: 'Image' }

  it('prefers a still-existing stored target', () => {
    expect(findShotTarget([film, other], [], 's1', 'f1')).toBe('f1')
  })

  it('ignores a stored target that was deleted', () => {
    expect(findShotTarget([other], [], 's1', 'f1')).toBeNull()
  })

  it('falls back to a downstream FilmShotNode via edges', () => {
    const edges = [{ source: 's1', target: 'x1' }, { source: 'x1', target: 'f1' }]
    expect(findShotTarget([film, other], edges, 's1', null)).toBe('f1')
  })

  it('returns null when nothing qualifies', () => {
    expect(findShotTarget([other], [{ source: 's1', target: 'x1' }], 's1', null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-dispatch.unit.spec.ts`
Expected: FAIL — `~/lib/shotdirector/dispatch` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/shotdirector/dispatch.ts`:

```typescript
/**
 * Pure mapping from a compiled ShotSheet to the FilmShotNode widget patch that
 * dispatches it, plus target-node discovery. The FilmShotNode's own widgets
 * carry prompt/model/aspect_ratio/duration/seed; everything else the Seedance
 * builder needs (resolution, references, first/last frame, generate_audio)
 * rides in the model_options JSON, which reaches the Python builder as `adv`.
 */
import type { CompileResult } from '~/lib/shotdirector/compile'
import type { ShotSheet } from '~/lib/shotdirector/types'

export interface FilmShotWidgetPatch {
  prompt: string
  model: string
  aspect_ratio: string
  duration: number
  seed: number
  model_options: string
}

/** Keys of the compiled Replicate input that map to FilmShotNode widgets —
 *  everything else goes into model_options. */
const WIDGET_NATIVE = new Set(['prompt', 'duration', 'aspect_ratio', 'seed'])

export function buildFilmShotPatch(sheet: ShotSheet, result: CompileResult): FilmShotWidgetPatch {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.input)) {
    if (!WIDGET_NATIVE.has(key)) extras[key] = value
  }
  return {
    prompt: result.prompt,
    model: 'seedance-2.0',
    // In firstLastFrame mode the compiled input has no aspect_ratio (image
    // dims win); send the sheet's anyway — the builder ignores it then.
    aspect_ratio: sheet.format.aspectRatio,
    duration: sheet.format.durationS,
    seed: sheet.format.seed && sheet.format.seed > 0 ? sheet.format.seed : 0,
    model_options: JSON.stringify(extras),
  }
}

export interface TargetNode { id: string, nodeType?: string }
export interface TargetEdge { source: string, target: string }

/** The FilmShotNode a Shot Director drives: the remembered target if it still
 *  exists, else the first FilmShotNode reachable downstream, else null. */
export function findShotTarget(
  nodes: TargetNode[],
  edges: TargetEdge[],
  studioId: string,
  storedTargetId?: string | null,
): string | null {
  if (storedTargetId && nodes.some(n => n.id === storedTargetId && n.nodeType === 'FilmShotNode')) {
    return storedTargetId
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const queue = [studioId]
  const seen = new Set<string>(queue)
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of edges) {
      if (e.source !== cur || seen.has(e.target)) continue
      seen.add(e.target)
      if (byId.get(e.target)?.nodeType === 'FilmShotNode') return e.target
      queue.push(e.target)
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-dispatch.unit.spec.ts`
Expected: PASS. Note: if `createDefaultShotSheet()`'s defaults fail compile validation with error-level issues (e.g. empty subject), the golden tests still pass — `buildFilmShotPatch` maps whatever compile returns; gating on issues is Task 4's job.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/dispatch.ts frontend/tests/unit/shotdirector-dispatch.unit.spec.ts
git commit -m "feat(shot-director): pure dispatch mapping — ShotSheet -> FilmShotNode widget patch + target discovery"
```

---

### Task 4: Canvas wiring — Generate event handler + node-card button

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (new event handler near `handleOpenShotDirector` at :2433; listener registration at :2949/:2988 blocks)
- Modify: `frontend/app/components/vue-canvas/ShotDirectorNode.vue` (footer Generate button next to the Edit button at :114-121)

**Interfaces:**
- Consumes: `buildFilmShotPatch`, `findShotTarget` (Task 3); `hydrateShotSheet` from `~/lib/shotdirector/hydrate`; `compileShot` from `~/lib/shotdirector/compile`; `getProfile` from `~/lib/shotdirector/profiles`; existing `createNodeData(nodeType, position, widgetOverrides?, propertyOverrides?)` (VueNodeCanvas.vue:1321); existing `comfynext:runFiltered` CustomEvent contract `{ detail: { targetIds: string[], direction?: 'downstream' } }`.
- Produces: window CustomEvent contract **`comfynext:shotDirectorGenerate`** with `detail: { sourceNodeId: string }` (Task 5 dispatches the same event from the surface). Studio node data key `comfynext_shotDirectorTargetId` (string) and transient `data.shotError` (string | null) shown on the card.

- [ ] **Step 1: Add the handler in VueNodeCanvas.vue**

Insert after `handleOpenShotDirector` (:2433 area), imports added alongside the existing shotdirector imports:

```typescript
import { buildFilmShotPatch, findShotTarget } from '~/lib/shotdirector/dispatch'
import { hydrateShotSheet } from '~/lib/shotdirector/hydrate'
import { compileShot } from '~/lib/shotdirector/compile'
import { getProfile } from '~/lib/shotdirector/profiles'
```

```typescript
/** Shot Director "Generate": compile the sheet, patch the (found-or-spawned)
 *  FilmShotNode's widgets, and hand off to the normal filtered run. No studio
 *  edge — ShotDirector bakes nothing, so we remember the target id instead. */
function setNodeWidget(node: any, name: string, value: unknown): boolean {
  const defs = (node.data?.widgetDefs ?? []) as { name: string }[]
  const i = defs.findIndex(w => w.name === name)
  if (i < 0) return false
  if (!Array.isArray(node.data.widgetsValues)) node.data.widgetsValues = []
  node.data.widgetsValues[i] = value
  return true
}

function handleShotDirectorGenerate(e: Event) {
  const detail = (e as CustomEvent<{ sourceNodeId: string }>).detail
  const studio = (nodes.value as any[]).find(n => String(n.id) === String(detail?.sourceNodeId))
  if (!studio) return
  if (!studio.data) studio.data = {}
  studio.data.shotError = null

  const sheet = hydrateShotSheet(studio.data?.properties?.comfynext_shotDirector)
  const result = compileShot(sheet, getProfile('seedance-2.0'))
  const errors = result.issues.filter(i => i.level === 'error')
  if (errors.length) {
    studio.data.shotError = errors[0]!.message
    return
  }

  const patch = buildFilmShotPatch(sheet, result)
  const lite = (nodes.value as any[]).map(n => ({ id: String(n.id), nodeType: n.data?.nodeType as string | undefined }))
  const liteEdges = (edges.value as any[]).map(e => ({ source: String(e.source), target: String(e.target) }))
  let targetId = findShotTarget(lite, liteEdges, String(studio.id), studio.data?.properties?.comfynext_shotDirectorTargetId)

  if (!targetId) {
    const pos = {
      x: (studio.position?.x ?? 0) + (studio.data?.size?.[0] ?? 280) + 80,
      y: studio.position?.y ?? 0,
    }
    const film = createNodeData('FilmShotNode', pos)
    nodes.value.push(film)
    targetId = String(film.id)
    if (!studio.data.properties) studio.data.properties = {}
    studio.data.properties.comfynext_shotDirectorTargetId = targetId
  }

  const film = (nodes.value as any[]).find(n => String(n.id) === targetId)
  if (!film) return
  for (const [name, value] of Object.entries(patch)) {
    if (!setNodeWidget(film, name, value)) {
      studio.data.shotError = `FilmShotNode has no '${name}' widget — is the backend catalog stale?`
      return
    }
  }
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', {
    detail: { targetIds: [targetId], direction: 'downstream' },
  }))
}
```

Register/unregister next to the existing `comfynext:openShotDirector` lines (:2949 / :2988):

```typescript
window.addEventListener('comfynext:shotDirectorGenerate', handleShotDirectorGenerate)
// ...and in the teardown block:
window.removeEventListener('comfynext:shotDirectorGenerate', handleShotDirectorGenerate)
```

- [ ] **Step 2: Add the Generate button + error line to ShotDirectorNode.vue**

Next to the existing Edit button (:114-121), following the same class idiom (emerald = run action, per the app's run-button convention):

```vue
<button
  class="rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
  title="Compile the shot and run Seedance"
  @click.stop="window.dispatchEvent(new CustomEvent('comfynext:shotDirectorGenerate', { detail: { sourceNodeId: props.id } }))"
>
  Generate
</button>
```

(If the SFC template can't reference `window` directly in this codebase's lint setup, add a `function generate() { window.dispatchEvent(...) }` in script setup and call `@click.stop="generate"` — match how the Edit button dispatches `comfynext:openShotDirector`.)

Below the footer, an error line bound to the transient flag:

```vue
<div v-if="data?.shotError" class="px-2 pb-1.5 text-[10px] leading-tight text-red-400/90">
  {{ data.shotError }}
</div>
```

- [ ] **Step 3: Typecheck + full unit suite**

Run: `cd frontend && npx vitest run && npx nuxi typecheck 2>&1 | tail -5`
Expected: vitest PASS; typecheck introduces no NEW errors (compare against `git stash`-free baseline if pre-existing errors exist).

- [ ] **Step 4: Manual smoke in the dev app (no cloud spend)**

With both servers running (`cd frontend && npm run dev`; ComfyUI already running): add a Shot Director from the Add menu, fill subject/action, click Generate on the card. Expected: a FilmShotNode appears to the right with prompt/model/duration widgets populated (`model = seedance-2.0`, `model_options` JSON visible in advanced), and the run starts (it will fail without a Replicate token — that's fine; this step verifies wiring, not generation). Clicking Generate again re-uses the SAME FilmShotNode (no duplicate spawn).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/ShotDirectorNode.vue
git commit -m "feat(shot-director): Generate wiring — patch + run a found-or-spawned FilmShotNode"
```

---

### Task 5: Surface — Generate + "New take" in the editor footer

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` (footer area; the component already computes the live `CompileResult` for the prompt preview — reuse that computed, do not recompile)
- Modify (only if needed): `frontend/app/composables/useShotDirector.ts` (expose a `rerollSeed()` helper if seed isn't already writable from the surface)

**Interfaces:**
- Consumes: the `comfynext:shotDirectorGenerate` event contract from Task 4; the surface's existing compiled-result computed and its node-id prop; `ShotSheet.format.seed`.
- Produces: `rerollSeed(): void` on `useShotDirector` — sets `sheet.format.seed = Math.floor(Math.random() * 2_147_483_646) + 1` (visible, reproducible, always > 0).

- [ ] **Step 1: Add `rerollSeed` to useShotDirector.ts**

```typescript
/** New take: a fresh visible seed so the same sheet renders a new variant. */
function rerollSeed() {
  sheet.value = { ...sheet.value, format: { ...sheet.value.format, seed: Math.floor(Math.random() * 2_147_483_646) + 1 } }
}
```

Export it from the composable's return object. (Match the composable's existing update idiom — if it mutates `sheet` fields directly instead of replacing, follow that.)

- [ ] **Step 2: Add the footer buttons to ShotDirectorSurface.vue**

In the surface footer (same row as the compiled-prompt word meter), two buttons gated on error-level issues from the existing compiled result:

```vue
<div class="flex items-center gap-2">
  <button
    class="rounded bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/70 hover:bg-white/10 disabled:opacity-40"
    :disabled="hasErrors"
    title="Reroll the seed and generate a new variant"
    @click="onNewTake"
  >
    New take
  </button>
  <button
    class="rounded bg-emerald-500/15 px-3 py-1.5 text-[12px] font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
    :disabled="hasErrors"
    @click="onGenerate"
  >
    Generate
  </button>
</div>
```

```typescript
const hasErrors = computed(() => compiled.value.issues.some(i => i.level === 'error'))
function onGenerate() {
  window.dispatchEvent(new CustomEvent('comfynext:shotDirectorGenerate', { detail: { sourceNodeId: props.nodeId } }))
}
function onNewTake() {
  rerollSeed()
  onGenerate()
}
```

(`compiled` and `props.nodeId` — use the surface's actual existing names for the compile computed and node-id prop; do not introduce a second compile path. If the surface persists the sheet to node properties on change with a debounce, flush/persist before dispatching so the canvas handler hydrates the fresh sheet — check how the surface saves and reuse that call synchronously in `onGenerate`.)

- [ ] **Step 3: Run unit suite + manual smoke**

Run: `cd frontend && npx vitest run`
Expected: PASS.
Manual: open the surface via Edit, click Generate → same behavior as the card button; click New take → the seed field visibly changes, then the run dispatches. With an empty subject (error-level issue), both buttons are disabled.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ShotDirectorSurface.vue frontend/app/composables/useShotDirector.ts
git commit -m "feat(shot-director): surface Generate + New take (seed reroll) footer actions"
```

---

### Task 6: Cost estimate — pure price table + display

**Files:**
- Create: `frontend/app/lib/shotdirector/price.ts`
- Modify: `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` (footer, next to the Generate button)
- Test: `frontend/tests/unit/shotdirector-price.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `ShotSheet` from `~/lib/shotdirector/types`.
- Produces: `function estimateShotUSD(sheet: ShotSheet): number` and `function formatShotUSD(sheet: ShotSheet): string` (e.g. `"~$0.90"`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/shotdirector-price.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { estimateShotUSD, formatShotUSD } from '~/lib/shotdirector/price'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

describe('estimateShotUSD', () => {
  it('prices 720p by duration', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    expect(estimateShotUSD(sheet)).toBeCloseTo(0.90)
  })

  it('prices 1080p higher', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '1080p'
    sheet.format.durationS = 5
    expect(estimateShotUSD(sheet)).toBeCloseTo(2.25)
  })

  it('applies the video-reference uplift', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    sheet.references.push({ kind: 'video', slot: 1, src: 'data:video/mp4;base64,x', role: 'motion-transfer' })
    expect(estimateShotUSD(sheet)).toBeCloseTo(1.10)
  })

  it('formats with a tilde and two decimals', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    expect(formatShotUSD(sheet)).toBe('~$0.90')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-price.unit.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement price.ts**

```typescript
/**
 * Replicate bytedance/seedance-2.0 list prices per output second (verified
 * 2026-07-01, docs/superpowers/specs/2026-07-01-costs-and-pricing-model.md).
 * Column 2 applies when any video reference is attached (`video_in` tier).
 * Provider COGS shown to the user as a "~$" estimate until the credit system
 * (accounts/billing spec §9.1) replaces it with a credit price.
 */
import type { ShotSheet } from '~/lib/shotdirector/types'

const PER_SECOND_USD: Record<string, [plain: number, videoRef: number]> = {
  '480p': [0.08, 0.10],
  '720p': [0.18, 0.22],
  '1080p': [0.45, 0.55],
  '4k': [1.00, 1.25],
}

export function estimateShotUSD(sheet: ShotSheet): number {
  const tier = PER_SECOND_USD[sheet.format.resolution.toLowerCase()] ?? PER_SECOND_USD['1080p']!
  const hasVideoRef = sheet.mode === 'reference' && sheet.references.some(r => r.kind === 'video')
  return (hasVideoRef ? tier[1] : tier[0]) * sheet.format.durationS
}

export function formatShotUSD(sheet: ShotSheet): string {
  return `~$${estimateShotUSD(sheet).toFixed(2)}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-price.unit.spec.ts`
Expected: PASS. (If `createDefaultShotSheet()` defaults `resolution` to something other than the test's explicit sets, the tests still pass — they set it explicitly.)

- [ ] **Step 5: Show it in the surface footer**

Next to the Generate button in `ShotDirectorSurface.vue`:

```vue
<span class="text-[11px] tabular-nums text-white/40" :title="'Estimated provider cost for this shot'">
  {{ formatShotUSD(sheet) }}
</span>
```

with `import { formatShotUSD } from '~/lib/shotdirector/price'` (bind `sheet` to the surface's live sheet ref).

- [ ] **Step 6: Run full suite + commit**

Run: `cd frontend && npx vitest run`
Expected: PASS.

```bash
git add frontend/app/lib/shotdirector/price.ts frontend/tests/unit/shotdirector-price.unit.spec.ts frontend/app/components/vue-canvas/ShotDirectorSurface.vue
git commit -m "feat(shot-director): per-shot cost estimate (~\$) in the editor footer"
```

---

### Task 7: Manual post-build spike — one real generation (HUMAN CHECKPOINT)

**Files:** none (verification only).

Per the design spec's testing section, this is a manual sanity check, not automation. **It spends real money (~$0.90 for a 720p/5s shot) and needs the Replicate token configured in Settings → AI.** Stop and ask the user before running it.

- [ ] **Step 1: Restart ComfyUI** (Task 1's Python change requires it): kill the running process, then `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`.
- [ ] **Step 2: With the user's go-ahead:** Shot Director → subject/action/lighting filled, one image reference attached (identity-lock), 720p / 5s → Generate.
- [ ] **Step 3: Verify:** run completes; a Video artifact materializes downstream of the FilmShotNode; the clip respects the reference and the compiled prompt's shot grammar; the result appears in Assets (type `output`).
- [ ] **Step 4: Verify "New take":** seed changes, second clip differs, SAME FilmShotNode reused.
- [ ] **Step 5:** Report results to the user with the compiled prompt + clip; get look sign-off before calling Phase 3 done.
