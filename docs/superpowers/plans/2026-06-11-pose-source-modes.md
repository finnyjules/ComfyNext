# Pose Source Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Pose Mannequin node re-pose a wired character three ways — pose a 3D mannequin (today), wire a pose reference image, or type a pose prompt — selected by a segmented toggle on the node.

**Architecture:** Pure prompt-building logic moves into a new dependency-light module (`comfy_extras/_pose_prompts.py`) so it is unit-testable without torch/network. The Python node gains a `pose_source` combo, an optional `pose_image` IMAGE input, and a `pose_prompt` string; `execute()` branches on the mode. The Vue node renders a 3-segment toggle and a per-mode body; image/prompt modes generate through the existing scoped-run path (`comfynext:runFiltered { targetIds, live: true }`) after ensuring a downstream image sink exists.

**Tech Stack:** Python (ComfyUI custom node, `comfy_api.latest.IO`), pytest, Vue 3 + TypeScript (`@vue-flow/core`), nano-banana-2 via Replicate.

---

## Background the engineer needs

- **The node today** ([comfy_extras/nodes_pose_mannequin.py](../../comfy_extras/nodes_pose_mannequin.py)): `PoseMannequinNode.execute()` takes `character` (IMAGE) + several editor-managed string widgets (`prompt`, `pose_state`, `mannequin_image`, `pose_cond_image`, `result_image`). It (1) returns the baked `result_image` if set, else (2) generates via nano-banana-2 from `character` + a normal-map conditioning render, else (3) passes the character through. The Replicate call uses helpers imported lazily from `comfy_api_nodes.nodes_replicate`: `_image_tensor_to_data_url(tensor) -> str`, `_run_prediction(model, input_dict) -> dict`, `_first_output_url(pred) -> str`, `download_url_to_image_tensor(url, cls=cls) -> tensor`.
- **The Vue node** ([frontend/app/components/vue-canvas/PoseMannequinNode.vue](../../frontend/app/components/vue-canvas/PoseMannequinNode.vue)): a custom renderer. Reads widgets by NAME via `widgetIdx`/`widgetStr` (order-independent), so appending widgets in Python is safe. Writes happen by mutating `props.data.widgetsValues[i] = v` directly (see [ArtifactTextNode.vue:87-89](../../frontend/app/components/vue-canvas/ArtifactTextNode.vue)).
- **Result routing** lives in [VueNodeCanvas.vue](../../frontend/app/components/vue-canvas/VueNodeCanvas.vue), NOT in the node component (the node has no access to the nodes/edges arrays). `handlePoseResult` (line ~1660) find-or-creates a downstream `Image` artifact node wired from the pose node's IMAGE output. `materializeAutoImageSinks` deliberately SKIPS PoseMannequin (it's in `ARTIFACT_NODE_COMPONENTS`), so a scoped run will NOT auto-create a sink — we must include the sink id in `targetIds` ourselves.
- **Scoped run:** `comfynext:runFiltered { targetIds: string[], live: true }` is handled in [default.vue](../../frontend/app/layouts/default.vue) `handleRunFiltered` — runs just the listed nodes (+ cached upstream), skipping the cost-confirm/watchdog. SmartLayout dispatches it on save ([SmartLayoutEditorModal.vue:372](../../frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue)).
- **Schema-change gotcha:** adding inputs shifts widget positions; existing canvas instances misalign and must be deleted + re-added. Python node changes require a ComfyUI restart (a supervisor relaunches it on 8188 when the pid is killed).

---

## File Structure

- **Create** `comfy_extras/_pose_prompts.py` — the 3 base-prompt constants + `pose_instruction()`. No torch / comfy imports (dependency-light, like `comfy_api_nodes/replicate_refs.py`).
- **Create** `tests-unit/comfy_extras_test/pose_prompts_test.py` — unit tests for `pose_instruction()`.
- **Modify** `comfy_extras/nodes_pose_mannequin.py` — import the constants/helper from the new module; add `pose_source` / `pose_image` / `pose_prompt` to the schema; branch `execute()` on `pose_source`.
- **Modify** `frontend/app/components/vue-canvas/PoseMannequinNode.vue` — segmented toggle + per-mode body + Generate dispatch.
- **Modify** `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — `ensurePoseImageSink()` (refactored out of `handlePoseResult`) + `handlePoseGenerate()` + listener registration.

---

## Task 1: Extract pose-prompt constants + builder into a dependency-light module

**Files:**
- Create: `comfy_extras/_pose_prompts.py`
- Test: `tests-unit/comfy_extras_test/pose_prompts_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/pose_prompts_test.py`:

```python
"""Unit tests for pose-instruction building (comfy_extras._pose_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
prompt-selection logic that decides how a character gets re-posed stays fast
and importable in CI.
"""
from comfy_extras import _pose_prompts as pp


def test_mannequin_mode_uses_normal_map_base_prompt():
    out = pp.pose_instruction("mannequin", "", "")
    assert out == pp.MANNEQUIN_PROMPT


def test_image_mode_uses_image_base_prompt():
    out = pp.pose_instruction("image", "", "")
    assert out == pp.IMAGE_PROMPT


def test_prompt_mode_embeds_the_pose_description():
    out = pp.pose_instruction("prompt", "", "sitting cross-legged on the floor")
    assert "sitting cross-legged on the floor" in out
    assert "{pose}" not in out  # template was actually filled


def test_prompt_mode_blank_description_falls_back_to_a_default_pose():
    out = pp.pose_instruction("prompt", "", "   ")
    assert "{pose}" not in out
    assert len(out) > 0


def test_extra_direction_is_appended_when_present():
    out = pp.pose_instruction("image", "dramatic rim lighting", "")
    assert out.startswith(pp.IMAGE_PROMPT)
    assert "Additional direction: dramatic rim lighting." in out


def test_no_extra_direction_appended_when_blank():
    out = pp.pose_instruction("image", "   ", "")
    assert "Additional direction:" not in out


def test_unknown_source_defaults_to_mannequin():
    assert pp.pose_instruction("bogus", "", "") == pp.MANNEQUIN_PROMPT
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/pose_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._pose_prompts'`.

- [ ] **Step 3: Write the module**

Create `comfy_extras/_pose_prompts.py`:

```python
"""Pose-instruction text for the Pose Mannequin node's three pose sources.

Kept free of torch / comfy_api / network imports so the prompt-selection logic
is unit-testable in CI (mirrors comfy_api_nodes/replicate_refs.py). The Python
node imports these; the mannequin instant path in
frontend/server/api/inpaint/pose.post.ts keeps its own copy of MANNEQUIN_PROMPT.
"""
from __future__ import annotations

# Mannequin mode: the 2nd image is a SURFACE-NORMAL render (colours encode facing
# direction). Unchanged from the original node so mannequin output is identical.
MANNEQUIN_PROMPT = (
    "The first image is a character. The second image is a SURFACE-NORMAL render of "
    "a posed 3D mannequin: its colours encode the target body pose AND the exact 3D "
    "orientation — which way the body and each limb face. Redraw the EXACT SAME "
    "character from the first image — keep their face, hair, skin tone, body type, "
    "clothing and art style identical — but pose them to match the second image: "
    "limb positions, stance, head angle, AND the whole-body orientation/facing "
    "direction (front, three-quarter, side, or back). If the body is turned or facing "
    "away, turn the character the same way; do NOT default to a front-facing view. "
    "Full body, head to toe, plain neutral studio background, natural and photographic. "
    "Output only the character in that pose, never the normal-map render itself."
)

# Image mode: the 2nd image is a REAL photo/figure. Copy only its pose — not its
# identity, clothing, or background.
IMAGE_PROMPT = (
    "The first image is a character. The second image shows a person or figure in a "
    "TARGET body pose. Redraw the EXACT SAME character from the first image — keep "
    "their face, hair, skin tone, body type, clothing and art style identical — but "
    "re-pose them to match the SECOND image's body pose: stance, limb positions, head "
    "angle, and whole-body orientation/facing direction. Copy ONLY the pose from the "
    "second image — never its identity, clothing, or background. Full body, head to "
    "toe, plain neutral studio background, natural and photographic. Output only the "
    "re-posed character."
)

# Prompt mode: a single character image + a text pose description. {pose} is filled
# from the node's pose_prompt widget.
TEXT_PROMPT = (
    "The image is a character. Redraw the EXACT SAME character — keep their face, "
    "hair, skin tone, body type, clothing and art style identical — but re-pose their "
    "body as follows: {pose}. Full body, head to toe, plain neutral studio "
    "background, natural and photographic. Output only the re-posed character."
)

_DEFAULT_POSE = "a natural, relaxed standing pose"


def pose_instruction(pose_source: str, extra: str = "", pose_prompt: str = "") -> str:
    """Build the nano-banana-2 instruction for a given pose source.

    pose_source: "mannequin" | "image" | "prompt" (anything else → mannequin).
    extra:       optional free-text direction (lighting/outfit notes), appended.
    pose_prompt: the body-pose description, only used by "prompt" mode.
    """
    if pose_source == "image":
        base = IMAGE_PROMPT
    elif pose_source == "prompt":
        pose = (pose_prompt or "").strip() or _DEFAULT_POSE
        base = TEXT_PROMPT.format(pose=pose)
    else:
        base = MANNEQUIN_PROMPT

    extra = (extra or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/pose_prompts_test.py -v`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_pose_prompts.py tests-unit/comfy_extras_test/pose_prompts_test.py
git commit -m "feat(pose): dependency-light pose-instruction builder + tests"
```

---

## Task 2: Add pose_source / pose_image / pose_prompt to the Python node and branch execute()

**Files:**
- Modify: `comfy_extras/nodes_pose_mannequin.py`

- [ ] **Step 1: Replace the module-level `_BASE_PROMPT` constant with an import**

Delete the `_BASE_PROMPT = (...)` block (lines ~29-45) and its preceding comment. Add to the imports near the top (after `from comfy_extras._live_preview import save_live_preview`):

```python
from comfy_extras._pose_prompts import pose_instruction
```

- [ ] **Step 2: Add the three new inputs to `define_schema`**

In `define_schema`, append these to the end of the `inputs=[...]` list (after the existing `result_image` input), keeping append-only ordering:

```python
                IO.Combo.Input("pose_source", options=["mannequin", "image", "prompt"],
                               default="mannequin", optional=True,
                               tooltip="Where the pose comes from: the 3D mannequin, a wired pose image, or a text prompt."),
                IO.Image.Input("pose_image", optional=True,
                               tooltip="A reference image whose body pose to copy (used when pose_source = image)."),
                IO.String.Input("pose_prompt", multiline=True, default="", optional=True,
                                tooltip="Describe the target pose in words (used when pose_source = prompt)."),
```

- [ ] **Step 3: Rewrite `execute()` to branch on `pose_source`**

Replace the whole `execute` method body with:

```python
    @classmethod
    async def execute(cls, character=None, prompt="", pose_state="",
                      mannequin_image="", pose_cond_image="", result_image="",
                      pose_source="mannequin", pose_image=None, pose_prompt="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        async def _generate(instruction: str, images: list) -> "IO.NodeOutput":
            # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
            from comfy_api_nodes.nodes_replicate import (
                _run_prediction, _image_tensor_to_data_url,
                _first_output_url, download_url_to_image_tensor,
            )
            input_dict = {
                "prompt": instruction,
                "image_input": [_image_tensor_to_data_url(t) for t in images],
                "resolution": "1K",
                "output_format": "png",
            }
            pred = await _run_prediction("google/nano-banana-2", input_dict)
            result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
            return IO.NodeOutput(result, ui=save_live_preview(result, uid))

        # Image mode: re-pose from a wired reference image.
        if pose_source == "image":
            if character is not None and pose_image is not None:
                return await _generate(pose_instruction("image", prompt, ""),
                                       [character, pose_image])

        # Prompt mode: re-pose from a text description (single character image).
        elif pose_source == "prompt":
            if character is not None and (pose_prompt or "").strip():
                return await _generate(pose_instruction("prompt", prompt, pose_prompt),
                                       [character])

        # Mannequin mode (default): baked result wins, else normal-map conditioning.
        else:
            baked = _load_input_image(result_image)
            if baked is not None:
                return IO.NodeOutput(baked, ui=save_live_preview(baked, uid))
            cond = _load_input_image(pose_cond_image) or _load_input_image(mannequin_image)
            if character is not None and cond is not None:
                return await _generate(pose_instruction("mannequin", prompt, ""),
                                       [character, cond])

        # Nothing to pose with — pass the character through (or a tiny blank).
        if character is not None:
            return IO.NodeOutput(character, ui=save_live_preview(character, uid))
        blank = torch.zeros(1, 16, 16, 3)
        return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))
```

- [ ] **Step 4: Verify the module imports cleanly**

Run: `.venv/bin/python -c "import comfy_extras.nodes_pose_mannequin as m; print(m.PoseMannequinNode.define_schema().node_id)"`
Expected: prints `PoseMannequin` with no ImportError or syntax error.

- [ ] **Step 5: Re-run the prompt unit tests (guards against a constant rename)**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/pose_prompts_test.py -v`
Expected: PASS — 7 passed.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_pose_mannequin.py
git commit -m "feat(pose): pose_source modes (mannequin/image/prompt) in execute()"
```

---

## Task 3: Refactor the downstream-sink find-or-create out of handlePoseResult

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`

**Why:** image/prompt Generate needs to ensure a downstream `Image` sink exists (and include it in the scoped run) so the result is displayed. That find-or-create logic already lives inside `handlePoseResult`; extract it so both callers share it. Pure refactor — no behavior change yet.

- [ ] **Step 1: Add `ensurePoseImageSink()` above `handlePoseResult` (after `handleOpenPose`, ~line 1658)**

```typescript
// Find (or create) the downstream artifact-image sink wired from a pose node's
// IMAGE output. Returns the sink node. Shared by handlePoseResult (editor path)
// and handlePoseGenerate (image/prompt graph-run path) — materializeAutoImageSinks
// skips PoseMannequin, so we wire the sink ourselves.
function ensurePoseImageSink(poseNode: any): any {
  const nodeId = String(poseNode.id)
  let outIdx = (poseNode.data?.outputs ?? []).findIndex((o: any) => String(o.type).toUpperCase() === 'IMAGE')
  if (outIdx < 0) outIdx = 0
  const handle = `output-${outIdx}`

  for (const ed of edges.value as any[]) {
    if (ed.source !== nodeId || ed.sourceHandle !== handle) continue
    const t = (nodes.value as any[]).find(n => n.id === ed.target)
    if (t && t.data?.nodeType === 'Image') return t
  }

  const srcPos = poseNode.position || { x: 0, y: 0 }
  const srcW = (poseNode.data?.size?.[0] ?? 200) as number
  const sink = createNodeData('Image', { x: srcPos.x + srcW + 80, y: srcPos.y })
  const ei = sink.data.widgetDefs?.findIndex((w: any) => w.name === 'export') ?? -1
  if (ei >= 0) sink.data.widgetsValues[ei] = true
  sink.data.size = [240, 280]
  nodes.value.push(sink)
  edges.value.push({
    id: `e-pose-${sink.id}`,
    source: nodeId, sourceHandle: handle,
    target: sink.id, targetHandle: 'input-0',
    type: 'comfy', data: { dataType: 'IMAGE' },
  } as any)
  return sink
}
```

- [ ] **Step 2: Replace the find-or-create block inside `handlePoseResult` with a call to it**

In `handlePoseResult`, replace everything from `let outIdx = ...` down through the `if (!sink) { ... }` block (the create branch ending with the `edges.value.push(...)`) with:

```typescript
  const sink: any = ensurePoseImageSink(poseNode)
```

Leave the rest of `handlePoseResult` (the `sink.data.images = ...` display/persist block) unchanged.

- [ ] **Step 3: Type-check the touched file**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep VueNodeCanvas | wc -l`
Expected: the count is unchanged from the pre-edit baseline (capture it first with `git stash` if unsure; known spurious VueFlow VLS errors exist — your refactor adds none).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "refactor(pose): extract ensurePoseImageSink from handlePoseResult"
```

---

## Task 4: Add handlePoseGenerate (ensure sink + scoped run) and register it

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`

- [ ] **Step 1: Add `handlePoseGenerate` right after `handlePoseResult`**

```typescript
// Image/Prompt pose modes generate via the normal graph-run path. Ensure a
// downstream image sink exists, then scope-run the pose node + that sink so the
// result lands on a visible artifact-image node (live = skip cost-confirm).
function handlePoseGenerate(e: Event) {
  const detail = (e as CustomEvent).detail
  const nodeId = detail?.nodeId ? String(detail.nodeId) : null
  if (!nodeId) return
  const poseNode = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!poseNode) return
  const sink = ensurePoseImageSink(poseNode)
  nextTick(() => {
    window.dispatchEvent(new CustomEvent('comfynext:runFiltered', {
      detail: { targetIds: [nodeId, String(sink.id)], live: true },
    }))
  })
}
```

(`nextTick` lets a newly-created sink + edge commit to the graph before the run reads canvas state. `nextTick` is already auto-imported in this Nuxt project; if a lint flags it, add it to the existing `vue` import.)

- [ ] **Step 2: Register the listener (mount, ~line 2030)**

After `window.addEventListener('comfynext:poseMultiResult', handlePoseMultiResult)` add:

```typescript
  window.addEventListener('comfynext:poseGenerate', handlePoseGenerate)
```

- [ ] **Step 3: Unregister the listener (unmount, ~line 2056)**

After `window.removeEventListener('comfynext:poseMultiResult', handlePoseMultiResult)` add:

```typescript
  window.removeEventListener('comfynext:poseGenerate', handlePoseGenerate)
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep VueNodeCanvas | wc -l`
Expected: unchanged from baseline.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(pose): handlePoseGenerate scoped run for image/prompt modes"
```

---

## Task 5: Segmented toggle + per-mode body in the Vue node

**Files:**
- Modify: `frontend/app/components/vue-canvas/PoseMannequinNode.vue`

- [ ] **Step 1: Add mode state + writers to `<script setup>`**

After the existing `mannequinUrl`/`hasPose` computeds, add:

```typescript
type PoseMode = 'mannequin' | 'image' | 'prompt'

const poseSource = computed<PoseMode>(() => {
  const v = widgetStr('pose_source')
  return (v === 'image' || v === 'prompt') ? v : 'mannequin'
})

function setWidget(name: string, v: any) {
  const i = widgetIdx(name)
  if (i < 0) return
  if (!Array.isArray(props.data.widgetsValues)) props.data.widgetsValues = []
  props.data.widgetsValues[i] = v
}

function setMode(m: PoseMode) { setWidget('pose_source', m) }

const posePrompt = computed<string>({
  get: () => widgetStr('pose_prompt'),
  set: (v: string) => setWidget('pose_prompt', v),
})

const poseImageInIdx = computed(() => { const i = inputIdx('pose_image'); return i >= 0 ? i : 1 })
const poseImageLinked = computed(() => {
  const i = inputIdx('pose_image')
  return i >= 0 ? props.data.inputs?.[i]?.link != null : false
})

const MODES: { id: PoseMode; label: string }[] = [
  { id: 'mannequin', label: 'Mannequin' },
  { id: 'image', label: 'Image' },
  { id: 'prompt', label: 'Prompt' },
]

function generate() {
  window.dispatchEvent(new CustomEvent('comfynext:poseGenerate', { detail: { nodeId: props.id } }))
}
```

- [ ] **Step 2: Add a second (pose_image) input handle, always present but de-emphasized outside image mode**

Inside the root `<div class="pose-mannequin-node ...">`, right after the existing character input `<Handle>`, add:

```vue
    <Handle
      :id="`input-${poseImageInIdx}`" type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a] transition-opacity"
      :class="poseSource === 'image' ? 'opacity-100' : 'opacity-25'"
      :style="{ borderColor: imageColor, top: '72%' }"
      title="Pose reference image"
    />
```

(Always rendered so any wired edge stays valid when the user switches modes; visually dimmed unless image mode is active.)

- [ ] **Step 3: Add the segmented toggle under the header**

Immediately after the header `</div>` (the `flex items-center gap-1.5 px-2 py-1.5 border-b` block), add:

```vue
      <!-- Mode toggle -->
      <div class="flex gap-0.5 p-1 bg-black/20">
        <button
          v-for="m in MODES" :key="m.id"
          class="nopan nodrag flex-1 h-6 rounded text-[10px] font-medium cursor-pointer transition-colors"
          :class="poseSource === m.id ? 'bg-violet-500/90 text-white' : 'text-white/45 hover:text-white/70 hover:bg-white/5'"
          @click.stop="setMode(m.id)">
          {{ m.label }}
        </button>
      </div>
```

- [ ] **Step 4: Make the preview body mode-aware**

Replace the existing mannequin preview block (the `<div class="relative bg-checker aspect-[3/4] ...">` … `</div>`) with:

```vue
      <!-- Mannequin: posed-figure preview -->
      <div v-if="poseSource === 'mannequin'" class="relative bg-checker aspect-[3/4] flex items-center justify-center overflow-hidden cursor-pointer" @dblclick.stop="openEditor">
        <img v-if="mannequinUrl" :src="mannequinUrl" class="absolute inset-0 w-full h-full object-contain" draggable="false" />
        <div v-else class="flex flex-col items-center justify-center gap-1.5 text-white/35 pointer-events-none">
          <PersonStanding class="size-8" :stroke-width="1.5" />
          <span class="text-[10px]">No pose yet</span>
        </div>
      </div>

      <!-- Image: wired pose-reference status -->
      <div v-else-if="poseSource === 'image'" class="relative bg-checker aspect-[3/4] flex flex-col items-center justify-center gap-1.5 overflow-hidden text-center px-3">
        <Image class="size-8" :class="poseImageLinked ? 'text-violet-400' : 'text-white/35'" :stroke-width="1.5" />
        <span class="text-[10px]" :class="poseImageLinked ? 'text-white/70' : 'text-white/35'">
          {{ poseImageLinked ? 'Pose image connected' : 'Wire a pose image →' }}
        </span>
        <span class="text-[9px] text-white/30 leading-tight">Connect any image to the lower-left port; its body pose is copied onto your character.</span>
      </div>

      <!-- Prompt: describe the pose -->
      <div v-else class="relative bg-checker aspect-[3/4] p-2 flex flex-col">
        <textarea
          v-model="posePrompt"
          class="nopan nodrag flex-1 w-full resize-none rounded-md bg-black/40 border border-white/10 text-[11px] text-white/85 p-2 leading-snug placeholder:text-white/30 focus:outline-none focus:border-violet-400/60"
          placeholder="Describe the pose — e.g. 'sitting cross-legged, leaning back on both hands, looking up'"
          @pointerdown.stop @dblclick.stop
        />
      </div>
```

- [ ] **Step 5: Make the footer button mode-aware**

Replace the footer action button block (the `<button ...>{{ hasPose ? 'Edit pose' : 'Pose & Generate' }}</button>`) with:

```vue
        <button
          v-if="poseSource === 'mannequin'"
          class="nopan nodrag flex-1 h-7 rounded-md bg-violet-500/90 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
          title="Open the 3D pose editor" @click.stop="openEditor">
          <Wand2 class="size-3.5" /> {{ hasPose ? 'Edit pose' : 'Pose & Generate' }}
        </button>
        <button
          v-else
          class="nopan nodrag flex-1 h-7 rounded-md bg-violet-500/90 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="poseSource === 'image' && !poseImageLinked"
          title="Re-pose the character" @click.stop="generate">
          <Wand2 class="size-3.5" /> Generate
        </button>
```

- [ ] **Step 6: Add `Image` to the lucide import**

Change the icon import line to:

```typescript
import { Image, PersonStanding, Wand2 } from 'lucide-vue-next'
```

- [ ] **Step 7: Type-check the node component**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep PoseMannequinNode | wc -l`
Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/vue-canvas/PoseMannequinNode.vue
git commit -m "feat(pose): segmented mode toggle + per-mode body and Generate button"
```

---

## Task 6: In-browser verification (manual, real generation)

**Files:** none (verification only).

**Prereqs:** Python schema changed → restart ComfyUI. Per the dev-environment note, KILL the ComfyUI pid (the supervisor relaunches it on 8188). Then hard-reload the frontend and DELETE + RE-ADD any existing Pose Mannequin node on the canvas (widget positions shifted).

- [ ] **Step 1: Restart backend + reload**

Kill the ComfyUI process so the supervisor relaunches it with the new schema. Confirm `object_info` for `PoseMannequin` now lists `pose_source`, `pose_image`, `pose_prompt`:

Run: `curl -s 127.0.0.1:8188/object_info/PoseMannequin | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d['PoseMannequin']['input']['optional'].keys()))"`
Expected: includes `pose_source`, `pose_image`, `pose_prompt`.

- [ ] **Step 2: Verify the toggle**

In the browser (use `127.0.0.1:PORT`, not `localhost`): add a Pose Mannequin node, wire a character image into the character port. Click each toggle segment — body switches between mannequin preview / image-status / prompt textarea. Confirm the selection persists across a node deselect/reselect (it's written to `pose_source`).

- [ ] **Step 3: Prompt mode — real generation (~$0.05)**

Toggle to Prompt, type "sitting cross-legged on the floor, hands on knees", click Generate. Expected: a downstream Image node is created and, after the run, shows the same character sitting cross-legged (identity preserved). Check the browser console / network for a `runFiltered` run and no errors.

- [ ] **Step 4: Image mode — real generation (~$0.05)**

Add a second image (any photo of a person in a distinct pose) and wire it into the lower-left `pose_image` port. Toggle to Image (button enables once connected). Click Generate. Expected: the character re-posed into the reference image's pose; the reference's identity/clothing are NOT copied.

- [ ] **Step 5: Mannequin regression**

Toggle back to Mannequin → "Edit pose" still opens the 3D editor and an in-editor generate still routes to the sink. Confirms the refactor didn't break the existing path.

- [ ] **Step 6: Record the result**

Append a short "Verification" note (pass/fail per mode + any output-quality observations) to `docs/superpowers/plans/2026-06-11-pose-source-modes.md` and commit:

```bash
git add docs/superpowers/plans/2026-06-11-pose-source-modes.md
git commit -m "docs(pose): record in-browser verification results"
```

---

## Self-review notes

- **Spec coverage:** `pose_source` toggle (Task 5) ✓; wired-only `pose_image` input (Tasks 2, 5) ✓; image + prompt base prompts distinct from the mannequin normal-map prompt (Task 1) ✓; scoped-run generation via `runFiltered` with a materialized sink (Tasks 3–5) ✓; mannequin path + `/api/inpaint/pose` untouched (Task 2 keeps the else-branch; route not modified) ✓; unit tests for branch/prompt selection (Task 1) ✓; in-browser real-generation verification (Task 6) ✓.
- **Naming consistency:** `pose_instruction`, `ensurePoseImageSink`, `handlePoseGenerate`, `comfynext:poseGenerate`, widget names `pose_source`/`pose_image`/`pose_prompt` are used identically across Python, the canvas, and the node component.
- **Guard rails:** image mode with no wired image and prompt mode with empty text fall through to character passthrough in `execute()` (Task 2); the Image-mode Generate button is `:disabled` until a pose image is connected (Task 5).
