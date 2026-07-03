# Lip-Sync Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated Lip-Sync Studio that makes a character/image/video speak a specific voice clip (type-to-speak, upload, or existing), producing a lip-synced talking video via Fabric 1.0 (image) or sync/lipsync-2-pro (video).

**Architecture:** One new backend `LipSyncNode` fronts both lip-sync engines (auto: image→Fabric, video→sync); a `/api/lipsync/speech` route turns text+voice into an audio `/view` URL (MiniMax). A studio surface (Shot Director pattern) compiles state → patches the node → runFiltered. All models/voices already exist; this is composition.

**Tech Stack:** Python (ComfyUI nodes, pytest), TypeScript (Nuxt 4 / Vue 3, vitest), Replicate (`veed/fabric-1.0`, `sync/lipsync-2-pro`, `minimax/speech-02-turbo`).

## Global Constraints

- Work on `main`, commit directly, NO feature branches. Stage ONLY the files each task names (explicit paths); NEVER `git add -A` (unrelated user WIP is in the tree).
- Fabric input: `{image, audio, resolution}` → `veed/fabric-1.0` (ignores aspect/duration; framing from image, length from audio). Requires BOTH image and audio.
- sync input: `{video, audio, sync_mode}` → `sync/lipsync-2-pro`. `sync_mode ∈ {loop, bounce, cut_off, silence, remap}`, default `cut_off`. Requires video and audio.
- Engine auto-resolution: image/character present (no video) → `fabric`; video present → `sync`.
- Speech is uniform MiniMax: `minimax/speech-02-turbo` with `{text, voice_id}`. Built-in voices = `_MINIMAX_VOICES`; cloned = `/api/voices-local` ids. Both are valid `voice_id`s.
- Local refs (`/view?filename=…&type=input`) resolve to data URLs at execute via `_parse_view_ref` + `_local_ref_to_data_url` (module fns in `nodes_replicate.py`). Audio dicts encode via `_audio_dict_to_wav_data_url`.
- New API routes MUST be allowlisted in `frontend/server/middleware/comfyui-proxy.ts`.
- Studio state lives at `node.data.properties.comfynext_lipSync`. Registration mirrors ShotDirector (`ARTIFACT_NODE_COMPONENTS` in `useVueNodes.ts`; component map + node synthesis + open/generate handlers in `VueNodeCanvas.vue`).
- Known baselines (must not regress): frontend typecheck 396; vitest 3 known-unrelated failures (spacetype-palette ×2, gradientfx-mesh ×1); Python `tests-unit/comfy_api_test/` green.
- Backend changes require a ComfyUI restart to load (kill + relaunch).
- Run: pytest `.venv/bin/python -m pytest <path> -v`; frontend typecheck `cd frontend && npx nuxi typecheck`; frontend tests `cd frontend && npx vitest run <path>`.

---

### Task 1: `LipSyncNode` backend (pure helpers + node)

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (add pure helpers + `LipSyncNode` class; register in the node list where other use-case nodes register)
- Test: `tests-unit/comfy_api_test/lipsync_node_test.py`

**Interfaces:**
- Produces:
  - `_lipsync_resolve_engine(engine: str, has_image: bool, has_video: bool) -> str` — returns `"fabric"` or `"sync"`.
  - `_lipsync_build_input(engine: str, image: str|None, video: str|None, audio: str, resolution: str, sync_mode: str) -> tuple[str, dict]` — returns `(replicate_slug, input_dict)`.
  - `LipSyncNode` (node_id `"LipSyncNode"`).

- [ ] **Step 1: Write failing tests**

Create `tests-unit/comfy_api_test/lipsync_node_test.py`:

```python
"""Pure-logic tests for LipSyncNode: engine resolution + per-engine input shape.
Fabric (veed/fabric-1.0) takes {image,audio,resolution}; sync (sync/lipsync-2-pro)
takes {video,audio,sync_mode}. Auto picks fabric for an image, sync for a video.
"""
import pytest

# Pre-import the util shim so nodes_replicate imports cleanly (pre-existing
# utils/comfy.utils sys.path shadow; see fal_dispatch_test.py).
import utils.install_util  # noqa: F401
from comfy_api_nodes.nodes_replicate import _lipsync_resolve_engine, _lipsync_build_input

DATA = "data:image/png;base64,x"
AUD = "data:audio/wav;base64,y"


def test_resolve_engine_auto_image_is_fabric():
    assert _lipsync_resolve_engine("auto", has_image=True, has_video=False) == "fabric"


def test_resolve_engine_auto_video_is_sync():
    assert _lipsync_resolve_engine("auto", has_image=False, has_video=True) == "sync"


def test_resolve_engine_manual_override_wins():
    assert _lipsync_resolve_engine("sync", has_image=True, has_video=False) == "sync"
    assert _lipsync_resolve_engine("fabric", has_image=False, has_video=True) == "fabric"


def test_build_fabric_input():
    slug, inp = _lipsync_build_input("fabric", DATA, None, AUD, "720p", "cut_off")
    assert slug == "veed/fabric-1.0"
    assert inp == {"image": DATA, "audio": AUD, "resolution": "720p"}


def test_build_sync_input():
    slug, inp = _lipsync_build_input("sync", None, DATA, AUD, "720p", "loop")
    assert slug == "sync/lipsync-2-pro"
    assert inp == {"video": DATA, "audio": AUD, "sync_mode": "loop"}


def test_build_fabric_requires_image():
    with pytest.raises(RuntimeError, match="image"):
        _lipsync_build_input("fabric", None, None, AUD, "720p", "cut_off")


def test_build_requires_audio():
    with pytest.raises(RuntimeError, match="audio"):
        _lipsync_build_input("fabric", DATA, None, "", "720p", "cut_off")
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/lipsync_node_test.py -v`
Expected: FAIL — `_lipsync_resolve_engine` / `_lipsync_build_input` not defined.

- [ ] **Step 3: Add the pure helpers**

In `comfy_api_nodes/nodes_replicate.py`, near the other use-case helpers, add:

```python
def _lipsync_resolve_engine(engine: str, has_image: bool, has_video: bool) -> str:
    """Pick the lip-sync engine: explicit choice wins; else a video → sync
    (relip), an image → fabric (talking head)."""
    if engine in ("fabric", "sync"):
        return engine
    return "sync" if has_video else "fabric"


def _lipsync_build_input(engine, image, video, audio, resolution, sync_mode):
    """Shape the Replicate input per engine. Returns (slug, input_dict)."""
    if not audio:
        raise RuntimeError("Lip-sync requires an audio clip.")
    if engine == "sync":
        if not video:
            raise RuntimeError("sync/lipsync-2-pro requires a source video.")
        return "sync/lipsync-2-pro", {"video": video, "audio": audio, "sync_mode": sync_mode}
    if not image:
        raise RuntimeError("Fabric 1.0 requires an input image (face).")
    return "veed/fabric-1.0", {"image": image, "audio": audio, "resolution": resolution}
```

- [ ] **Step 4: Add the `LipSyncNode` class**

Add near the other use-case nodes (e.g. after `LipsyncRemoteNode`). It accepts a compiled `model_options` JSON from the studio plus optional wired `image`/`audio` ports; resolves `/view` refs itself; resolves the engine from the payload; dispatches.

```python
class LipSyncNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LipSyncNode",
            display_name="Lip-sync a character",
            category="api node/video/Replicate",
            description=(
                "Make a face speak an audio clip. Image face → VEED Fabric 1.0 "
                "(talking head); video face → sync/lipsync-2-pro (relip). Driven "
                "by the Lip-Sync Studio; ~$1 per 30s."
            ),
            inputs=[
                IO.Image.Input("image", optional=True,
                               tooltip="Optional wired face image (else supplied via the studio)."),
                IO.Audio.Input("audio", optional=True,
                               tooltip="Optional wired voice clip (else supplied via the studio)."),
                IO.Combo.Input("engine", options=["auto", "fabric", "sync"], default="auto",
                               tooltip="auto = image→Fabric, video→sync."),
                IO.Combo.Input("resolution", options=["480p", "720p", "1080p"], default="720p",
                               tooltip="Fabric only; sync keeps the source framing."),
                IO.Combo.Input("sync_mode",
                               options=["cut_off", "loop", "bounce", "silence", "remap"],
                               default="cut_off", advanced=True,
                               tooltip="sync only — how to handle audio/video length mismatch."),
                IO.String.Input("model_options", multiline=True, default="{}",
                                tooltip="JSON from the Lip-Sync Studio: face_image / face_video / audio URLs."),
            ],
            outputs=[IO.Video.Output()],
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":1.00,"format":{"approximate":true,"suffix":"/30s"}}'),
        )

    @classmethod
    async def execute(cls, image=None, audio=None, engine="auto",
                      resolution="720p", sync_mode="cut_off", model_options="{}"):
        try:
            opts = json.loads(model_options or "{}")
            if not isinstance(opts, dict):
                opts = {}
        except json.JSONDecodeError:
            opts = {}

        def _resolve(src):
            if not src:
                return src
            name = _parse_view_ref(src)
            return _local_ref_to_data_url(name) if name else src

        # Wired ports win over studio-supplied URLs.
        face_image = _image_tensor_to_data_url(image) if image is not None else _resolve(opts.get("face_image"))
        face_video = _resolve(opts.get("face_video"))
        audio_url = _audio_dict_to_wav_data_url(audio, max_seconds=60) if audio is not None else _resolve(opts.get("audio"))
        resolution = opts.get("resolution", resolution)
        sync_mode = opts.get("sync_mode", sync_mode)
        engine = opts.get("engine", engine)

        eng = _lipsync_resolve_engine(engine, bool(face_image), bool(face_video))
        slug, input_dict = _lipsync_build_input(
            eng, face_image, face_video, audio_url, resolution, sync_mode)
        print(f"[LipSync] engine={eng!r} slug={slug!r} keys={list(input_dict)}", flush=True)
        pred = await _run_prediction(slug, input_dict, poll_deadline_sec=_VIDEO_POLL_DEADLINE_SEC)
        video = await download_url_to_video_output(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(video)
```

Register `LipSyncNode` in the module's node list (find where `LipsyncRemoteNode` / `GenerateVideoNode` are added to the returned node classes and add `LipSyncNode` alongside).

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/lipsync_node_test.py -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Full Python gate**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py tests-unit/comfy_api_test/lipsync_node_test.py
git commit -m "feat(lipsync): LipSyncNode fronting Fabric + sync engines"
```

---

### Task 2: `/api/lipsync/speech` route

**Files:**
- Create: `frontend/server/api/lipsync/speech.post.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (`NITRO_API_PREFIXES` — add `/api/lipsync`)

**Interfaces:**
- Produces: `POST /api/lipsync/speech` `{ text: string, voiceId: string }` → `{ viewUrl: string }` (a `/view?filename=…&type=input` URL to the generated mp3).

- [ ] **Step 1: Add the route**

Create `frontend/server/api/lipsync/speech.post.ts` (mirror `cloud-train/aesthetic.post.ts` for the Replicate call + `requireReplicateToken`; save to the ComfyUI input dir like the character-shot flow, return a `/view` URL):

```ts
/**
 * POST /api/lipsync/speech
 * Body: { text: string, voiceId: string }
 * Generates speech via MiniMax Speech-02 (built-in AND cloned voices are both
 * MiniMax voice_ids) and saves the mp3 into the ComfyUI input dir, returning a
 * '/view?filename=…&type=input' URL that FilmShotNode/LipSyncNode resolve at
 * execute. Must be allowlisted in server/middleware/comfyui-proxy.ts.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SPEECH_MODEL = 'minimax/speech-02-turbo'

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody(event) as { text?: string, voiceId?: string }
  const text = (body?.text || '').trim()
  const voiceId = (body?.voiceId || '').trim()
  if (!text) throw createError({ statusCode: 400, message: 'text is required' })
  if (!voiceId) throw createError({ statusCode: 400, message: 'voiceId is required' })

  // Official-model predictions endpoint (no version lookup needed).
  const res = await fetch(`https://api.replicate.com/v1/models/${SPEECH_MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { text, voice_id: voiceId } }),
  })
  if (!res.ok) throw createError({ statusCode: 502, message: `speech gen failed: ${res.status} ${await res.text()}` })
  const pred = await res.json() as { output?: string | string[], status?: string }
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output
  if (!url) throw createError({ statusCode: 502, message: 'speech gen returned no audio' })

  // Download the mp3 and drop it into the ComfyUI input dir.
  const audioRes = await fetch(url)
  if (!audioRes.ok) throw createError({ statusCode: 502, message: `could not fetch generated audio: ${audioRes.status}` })
  const buf = Buffer.from(await audioRes.arrayBuffer())
  const inputDir = path.resolve(process.cwd(), '..', 'input')
  await fs.mkdir(inputDir, { recursive: true })
  const filename = `lipsync-voice_${Date.now()}.mp3`
  await fs.writeFile(path.join(inputDir, filename), buf)

  return { viewUrl: `/view?${new URLSearchParams({ filename, type: 'input' })}` }
})
```

Note: `Prefer: wait` makes the MiniMax call synchronous (it's short). If the account requires polling instead, fall back to the poll loop used in `aesthetic.post.ts`. Confirm `requireReplicateToken` is the correct helper name used by sibling routes; match it.

- [ ] **Step 2: Allowlist the route**

In `frontend/server/middleware/comfyui-proxy.ts`, add `'/api/lipsync'` to `NITRO_API_PREFIXES`.

- [ ] **Step 3: Verify it's reachable (dev server)**

With the frontend dev server running, confirm the route is served (not proxied to ComfyUI):

Run: `curl -s -X POST http://127.0.0.1:3000/api/lipsync/speech -H 'Content-Type: application/json' -d '{"text":"","voiceId":"Wise_Woman"}' -o - -w '%{http_code}\n'`
Expected: `400` with the "text is required" message (proves the Nitro route handles it, not the proxy). Do NOT run a real (paid) generation here — the live smoke (Task 8) covers that.

- [ ] **Step 4: Commit**

```bash
git add frontend/server/api/lipsync/speech.post.ts frontend/server/middleware/comfyui-proxy.ts
git commit -m "feat(lipsync): /api/lipsync/speech — text+voice → audio /view URL (MiniMax)"
```

---

### Task 3: `lib/lipsync/` pure core

**Files:**
- Create: `frontend/app/lib/lipsync/types.ts`, `frontend/app/lib/lipsync/hydrate.ts`, `frontend/app/lib/lipsync/compile.ts`, `frontend/app/lib/lipsync/price.ts`
- Test: `frontend/tests/unit/lipsync-compile.unit.spec.ts`

**Interfaces:**
- Produces:
  - `LipSyncSheet` type (below).
  - `hydrateLipSyncSheet(raw: unknown): LipSyncSheet`.
  - `resolveEngine(sheet): 'fabric' | 'sync'` — image/character → fabric, video → sync, honoring `sheet.engine` override.
  - `compileLipSync(sheet): { modelOptions: Record<string, unknown>, engine: string, resolution: string, issues: ValidationIssue[] }`.
  - `estimateLipSyncCost(audioSeconds: number): number`.

- [ ] **Step 1: Write failing tests**

Create `frontend/tests/unit/lipsync-compile.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hydrateLipSyncSheet } from '~/lib/lipsync/hydrate'
import { resolveEngine, compileLipSync } from '~/lib/lipsync/compile'

const base = () => hydrateLipSyncSheet({})

describe('resolveEngine', () => {
  it('image face → fabric', () => {
    const s = { ...base(), face: { kind: 'image', src: '/view?filename=a.png&type=input' } }
    expect(resolveEngine(s as any)).toBe('fabric')
  })
  it('video face → sync', () => {
    const s = { ...base(), face: { kind: 'video', src: '/view?filename=v.mp4&type=input' } }
    expect(resolveEngine(s as any)).toBe('sync')
  })
  it('manual override wins', () => {
    const s = { ...base(), engine: 'sync', face: { kind: 'image', src: 'x' } }
    expect(resolveEngine(s as any)).toBe('sync')
  })
})

describe('compileLipSync', () => {
  it('image + audio → fabric model_options', () => {
    const s = {
      ...base(),
      face: { kind: 'image', src: '/view?filename=a.png&type=input' },
      voice: { kind: 'audio', src: '/view?filename=v.mp3&type=input' },
    }
    const out = compileLipSync(s as any)
    expect(out.engine).toBe('fabric')
    expect(out.modelOptions.face_image).toBe('/view?filename=a.png&type=input')
    expect(out.modelOptions.audio).toBe('/view?filename=v.mp3&type=input')
    expect(out.modelOptions.face_video).toBeUndefined()
    expect(out.issues.filter(i => i.level === 'error')).toHaveLength(0)
  })
  it('video + audio → sync model_options with sync_mode', () => {
    const s = {
      ...base(),
      face: { kind: 'video', src: '/view?filename=v.mp4&type=input' },
      voice: { kind: 'audio', src: '/view?filename=v.mp3&type=input' },
      syncMode: 'loop',
    }
    const out = compileLipSync(s as any)
    expect(out.engine).toBe('sync')
    expect(out.modelOptions.face_video).toBe('/view?filename=v.mp4&type=input')
    expect(out.modelOptions.sync_mode).toBe('loop')
  })
  it('no face → error issue', () => {
    const s = { ...base(), voice: { kind: 'audio', src: 'x' } }
    expect(compileLipSync(s as any).issues.some(i => i.level === 'error')).toBe(true)
  })
  it('no voice → error issue', () => {
    const s = { ...base(), face: { kind: 'image', src: 'x' } }
    expect(compileLipSync(s as any).issues.some(i => i.level === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/lipsync-compile.unit.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the core**

`frontend/app/lib/lipsync/types.ts`:

```typescript
export interface ValidationIssue { level: 'error' | 'warning'; code: string; message: string }

export type FaceKind = 'character' | 'image' | 'video'
export type VoiceKind = 'tts' | 'audio'

export interface LipSyncSheet {
  face: { kind: FaceKind; src: string; characterSlug?: string }
  voice: { kind: VoiceKind; text?: string; voiceId?: string; src?: string }
  engine: 'auto' | 'fabric' | 'sync'
  resolution: '480p' | '720p' | '1080p'
  syncMode: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap'
}
```

`frontend/app/lib/lipsync/hydrate.ts`:

```typescript
import type { LipSyncSheet } from './types'

export function hydrateLipSyncSheet(raw: unknown): LipSyncSheet {
  const r = (raw && typeof raw === 'object') ? raw as Partial<LipSyncSheet> : {}
  return {
    face: r.face && typeof r.face === 'object' ? { kind: 'image', src: '', ...r.face } as LipSyncSheet['face']
                                               : { kind: 'image', src: '' },
    voice: r.voice && typeof r.voice === 'object' ? { kind: 'tts', ...r.voice } as LipSyncSheet['voice']
                                                  : { kind: 'tts', text: '', voiceId: 'Wise_Woman' },
    engine: r.engine ?? 'auto',
    resolution: r.resolution ?? '720p',
    syncMode: r.syncMode ?? 'cut_off',
  }
}
```

`frontend/app/lib/lipsync/compile.ts`:

```typescript
import type { LipSyncSheet, ValidationIssue } from './types'

export function resolveEngine(sheet: LipSyncSheet): 'fabric' | 'sync' {
  if (sheet.engine === 'fabric' || sheet.engine === 'sync') return sheet.engine
  return sheet.face.kind === 'video' ? 'sync' : 'fabric'
}

/** The resolved audio src: an uploaded/existing clip, or (for tts) filled in at
 *  Generate time after the speech route runs. Compile only reads voice.src. */
function voiceSrc(sheet: LipSyncSheet): string {
  return sheet.voice.src ?? ''
}

export function compileLipSync(sheet: LipSyncSheet): {
  modelOptions: Record<string, unknown>; engine: string; resolution: string; issues: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []
  const engine = resolveEngine(sheet)
  const face = sheet.face.src.trim()
  const audio = voiceSrc(sheet).trim()

  if (!face) issues.push({ level: 'error', code: 'no-face', message: 'Pick a character, image, or video to drive.' })
  if (!audio) issues.push({ level: 'error', code: 'no-voice', message: 'Add a voice — type a line, or upload audio.' })
  if (sheet.face.kind === 'video' && sheet.engine === 'fabric') {
    issues.push({ level: 'warning', code: 'video-needs-sync', message: 'A video face uses the sync engine; Fabric is image-only.' })
  }

  const modelOptions: Record<string, unknown> = { engine, resolution: sheet.resolution, audio }
  if (engine === 'sync') { modelOptions.face_video = face; modelOptions.sync_mode = sheet.syncMode }
  else { modelOptions.face_image = face }

  return { modelOptions, engine, resolution: sheet.resolution, issues }
}
```

`frontend/app/lib/lipsync/price.ts`:

```typescript
/** Both engines bill ~$1.00 per 30s of output; length = the audio length. */
export function estimateLipSyncCost(audioSeconds: number): number {
  const secs = Number.isFinite(audioSeconds) && audioSeconds > 0 ? audioSeconds : 5
  return Math.max(0.05, (secs / 30) * 1.0)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/lipsync-compile.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/lipsync/ frontend/tests/unit/lipsync-compile.unit.spec.ts
git commit -m "feat(lipsync): pure compile core (types, hydrate, engine resolution, price)"
```

---

### Task 4: `useLipSync` composable

**Files:**
- Create: `frontend/app/composables/useLipSync.ts`
- Test: `frontend/tests/unit/lipsync-composable.unit.spec.ts`

**Interfaces:**
- Consumes: `hydrateLipSyncSheet`, `compileLipSync` (Task 3).
- Produces: `useLipSync(initial, persist)` → `{ sheet: Ref<LipSyncSheet>, result: ComputedRef<compile output>, update, setFace, setVoice }`.

- [ ] **Step 1: Write failing test**

Create `frontend/tests/unit/lipsync-composable.unit.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { useLipSync } from '~/composables/useLipSync'

describe('useLipSync', () => {
  it('recompiles on update and persists', () => {
    const persist = vi.fn()
    const { sheet, result, setFace, setVoice } = useLipSync({}, persist)
    expect(result.value.issues.some(i => i.level === 'error')).toBe(true) // empty → errors
    setFace({ kind: 'image', src: '/view?filename=a.png&type=input' })
    setVoice({ kind: 'audio', src: '/view?filename=v.mp3&type=input' })
    expect(result.value.engine).toBe('fabric')
    expect(result.value.issues.filter(i => i.level === 'error')).toHaveLength(0)
    expect(persist).toHaveBeenCalled()
    expect(sheet.value.face.src).toContain('a.png')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run tests/unit/lipsync-composable.unit.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `frontend/app/composables/useLipSync.ts`:

```typescript
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { hydrateLipSyncSheet } from '~/lib/lipsync/hydrate'
import { compileLipSync } from '~/lib/lipsync/compile'
import type { LipSyncSheet } from '~/lib/lipsync/types'

export function useLipSync(initial: unknown, persist: (s: LipSyncSheet) => void) {
  const sheet = ref<LipSyncSheet>(hydrateLipSyncSheet(initial))
  const result = computed(() => compileLipSync(sheet.value))

  const update = (mut: (s: LipSyncSheet) => LipSyncSheet) => { sheet.value = mut(sheet.value); persist(sheet.value) }
  const setFace = (face: LipSyncSheet['face']) => update(s => ({ ...s, face }))
  const setVoice = (voice: LipSyncSheet['voice']) => update(s => ({ ...s, voice }))

  return { sheet: sheet as Ref<LipSyncSheet>, result: result as ComputedRef<ReturnType<typeof compileLipSync>>, update, setFace, setVoice }
}
```

- [ ] **Step 4: Run to verify pass** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useLipSync.ts frontend/tests/unit/lipsync-composable.unit.spec.ts
git commit -m "feat(lipsync): useLipSync composable"
```

---

### Task 5: Studio surface + node card + registration (VISUAL — browser-verified)

**Naming (avoid the studio/target collision):** the FRONTEND studio node is nodeType `'LipSyncStudio'` (card `LipSyncStudioNode.vue`, surface `LipSyncSurface.vue`, component key `'lip-sync'`); it dispatches to the BACKEND render node whose class_type is `'LipSyncNode'` (Task 1). This mirrors ShotDirector (studio `'ShotDirector'` → target `FilmShotNode`) — the studio and its render target must have distinct names.

**Files:**
- Create: `frontend/app/components/vue-canvas/LipSyncStudioNode.vue`, `frontend/app/components/vue-canvas/LipSyncSurface.vue`
- Modify: `frontend/app/composables/useVueNodes.ts` (`ARTIFACT_NODE_COMPONENTS` — add `LipSyncStudio: 'lip-sync'`), `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (import both components; add to the `markRaw` component map keyed `'lip-sync'`; add `'LipSyncStudio'` to the studio-output synthesis list at ~line 1398; add an "add node" menu entry + `handleOpenLipSync` open handler mirroring `handleOpenShotDirector`)

**Interfaces:**
- Consumes: `useLipSync` (Task 4), `useCharacters` (existing, for the character face picker), `uploadRefFile`/`viewRefUrl` from `~/lib/shotdirector/refUpload` (existing), the voice gallery (`VoiceGalleryModal`/`voiceCatalog`, existing).
- Produces: a working editing surface writing `node.data.properties.comfynext_lipSync`. (Generate wiring is Task 6.)

Follow `ShotDirectorNode.vue` / `ShotDirectorSurface.vue` as the exact structural template (node card with an Open button + the modal shell, sections, the `StudioSection` primitive). Build:

- [ ] **Step 1: Node card** `LipSyncStudioNode.vue` — mirror `ShotDirectorNode.vue`: a titled card with a one-line description and an "Open Lip-Sync" button that emits the open event. (Generate button added in Task 6.)

- [ ] **Step 2: Surface shell + Face panel** `LipSyncSurface.vue` — modal shell (reuse the Shot Director modal chrome). A first-open instructions block ("Pick a face, add a voice, Generate"). **Face panel** with three tabs:
  - **Character**: list from `useCharacters().characters`; clicking one sets `face = { kind:'character', src: coverUrl(character), characterSlug }` (use `useCharacters().coverUrl`).
  - **Image**: file input → `uploadRefFile(file)` → `setFace({ kind:'image', src: viewRefUrl(name) })`; show a thumbnail.
  - **Video**: file input (accept video) → `uploadRefFile` → `setFace({ kind:'video', src })`; or a URL text field.

- [ ] **Step 3: Voice panel** — three tabs:
  - **Type to speak**: a textarea (the line) + a voice picker (reuse `VoiceGalleryModal` or a compact select over `voiceCatalog` + cloned voices from `/api/voices-local`) → stores `voice = { kind:'tts', text, voiceId }`. (The actual TTS call happens at Generate, Task 6.)
  - **Upload audio**: file input → `uploadRefFile` → `voice = { kind:'audio', src }`.
  - **Existing clip**: URL text field → `voice = { kind:'audio', src }`.

- [ ] **Step 4: Engine + format row** — engine select (auto/fabric/sync) bound to `sheet.engine`; resolution select; `sync_mode` select shown only when the resolved engine is `sync`. Show the compile `issues` (errors red, warnings amber — no purple) and the resolved engine label.

- [ ] **Step 5: Register** — `ARTIFACT_NODE_COMPONENTS.LipSyncStudio = 'lip-sync'`; import `LipSyncStudioNode.vue` + `LipSyncSurface.vue` and map keyed `'lip-sync'` in `VueNodeCanvas.vue`; add `'LipSyncStudio'` to the studio-output-synthesis condition (~line 1398, so a canvas-created `LipSyncStudio` node gets a wildcard output); add the add-node menu entry and a `handleOpenLipSync(e)` that opens the surface for the node id (mirror `handleOpenShotDirector`). State key `comfynext_lipSync`.

- [ ] **Step 6: Verify (browser, controller)** — via the running dev server (127.0.0.1:3000, NOT localhost): add a Lip-Sync node, open it, switch face tabs (character list loads, image upload thumbnails), switch voice tabs (voice picker lists built-in + cloned), engine auto-label flips image→Fabric / video→sync, issues show for empty state. No Generate yet.

- [ ] **Step 7: Typecheck + commit**

Run: `cd frontend && npx nuxi typecheck 2>&1 | tail -3` → 396 baseline (no new errors from these files).

```bash
git add frontend/app/components/vue-canvas/LipSyncStudioNode.vue frontend/app/components/vue-canvas/LipSyncSurface.vue frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(lipsync): studio surface (face + voice panels) + node card + registration"
```

---

### Task 6: Generate wiring (VISUAL — browser-verified)

**Files:**
- Modify: `frontend/app/components/vue-canvas/LipSyncSurface.vue` (footer: cost + Generate + New take), `frontend/app/components/vue-canvas/LipSyncStudioNode.vue` (card Generate button), `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`handleLipSyncGenerate` — mirror `handleShotDirectorGenerate`)

**Interfaces:**
- Consumes: `compileLipSync` result (Task 3), `estimateLipSyncCost` (Task 3), `/api/lipsync/speech` (Task 2), `LipSyncNode` target (Task 1).

- [ ] **Step 1: Generate handler** `handleLipSyncGenerate` in `VueNodeCanvas.vue`, mirroring `handleShotDirectorGenerate`:
  1. Read the sheet; if `voice.kind === 'tts'`, POST `{ text: voice.text, voiceId: voice.voiceId }` to `/api/lipsync/speech`; set the returned `viewUrl` as the effective audio. If `voice.kind === 'audio'`, use `voice.src`.
  2. Recompile with the resolved audio (or pass the audio into the compiled `model_options.audio`).
  3. Find-or-spawn a `LipSyncNode` (remember its id in `node.data.properties.comfynext_lipSyncTargetId`, like Shot Director's target), patch its widgets (`engine`, `resolution`, `sync_mode`, `model_options` = JSON of the compiled options incl. `audio`), then `runFiltered` on it. Use `mintNodeId()` for any spawned node id (collision-safe).
  4. Guard: if compile `issues` has an error, do not dispatch (button disabled).

- [ ] **Step 2: Footer** in `LipSyncSurface.vue` — a cost estimate (`estimateLipSyncCost`; audio length unknown pre-gen → show "~$1 / 30s" or estimate from a known clip length if available), an emerald **Generate** button (disabled when errors present), and a **New take** button (re-dispatch). Wire Generate/New take to emit events handled by `handleLipSyncGenerate`.

- [ ] **Step 3: Card Generate button** in `LipSyncStudioNode.vue` — mirror the Shot Director node card's Generate/Open split.

- [ ] **Step 4: Verify (browser, controller — NON-paid parts)** — Generate with an empty sheet stays disabled; with a face + uploaded audio, clicking Generate spawns/patches a `LipSyncNode` with correct `model_options` (inspect the node's widget) and triggers a run. Do NOT confirm the paid render here — that's Task 8. Confirm the graph wiring (node spawned, widgets patched, run queued).

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend && npx nuxi typecheck 2>&1 | tail -3` → 396 baseline.

```bash
git add frontend/app/components/vue-canvas/LipSyncSurface.vue frontend/app/components/vue-canvas/LipSyncStudioNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(lipsync): Generate wiring — voice TTS resolve, compile → LipSyncNode → run"
```

---

### Task 7: Full-suite gate

**Files:** none (verification).

- [ ] **Step 1: Python** — `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q` → all pass.
- [ ] **Step 2: Frontend typecheck** — `cd frontend && npx nuxi typecheck 2>&1 | tail -3` → 396 (baseline).
- [ ] **Step 3: Frontend units** — `cd frontend && npx vitest run 2>&1 | tail -15` → only the 3 known-unrelated failures; all lipsync suites green.
- [ ] **Step 4: Ledger note** — record gate numbers in the SDD ledger (no commit; verification only).

---

### Task 8: Live smoke — paid two-engine sign-off (controller)

**Files:** none (manual, paid ~$2).

- [ ] **Step 1: Restart ComfyUI** to load `LipSyncNode`:

```bash
pkill -f "main.py --listen" ; sleep 3
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfynext-comfyui.out.log 2>&1 &
```
Wait for `curl -s http://127.0.0.1:8188/system_stats` to return JSON.

- [ ] **Step 2: Fabric path (image + type-to-speak)** — in the studio: pick a character (e.g. Vera), type a line, pick a voice, Generate (~$1). Confirm the ComfyUI log shows `[LipSync] engine='fabric' slug='veed/fabric-1.0'`, a video returns, the character's lips articulate the line, and the audio track carries the voice.

- [ ] **Step 3: sync path (video + audio)** — supply a short source video + an audio clip (or a type-to-speak voice), engine auto → sync, Generate (~$1). Confirm `[LipSync] engine='sync' slug='sync/lipsync-2-pro'`, the output preserves the source video framing, and the lips resync to the audio.

- [ ] **Step 4: Sign-off** — save both clips under `output/video/`, note results in `[[project_shot_director]]`/a new lip-sync memory, mark the plan complete.

---

## Notes for the executor

- **Order:** T1→T2 backend (independent of frontend); T3→T4 pure core; T5→T6 UI (T6 depends on T1/T2/T3); T7 gate; T8 last (restart + all prior). T5/T6 are VISUAL — build then browser-verify at 127.0.0.1:3000 (NOT localhost — the middleware 426s localhost).
- **Reuse, don't reinvent:** `refUpload.ts` (image/video/audio all go through `/upload/image`), `useCharacters` (face picker), `VoiceGalleryModal`/`voiceCatalog` (voice picker), the ShotDirector node/surface as the structural template, `mintNodeId()` for spawned ids.
- **Do not** re-integrate the models — Fabric and sync are already wired; LipSyncNode composes them.
- **Audio length for cost:** unknown before TTS; a "~$1 / 30s" estimate is acceptable for v1 (the price badge on the node already states it).
