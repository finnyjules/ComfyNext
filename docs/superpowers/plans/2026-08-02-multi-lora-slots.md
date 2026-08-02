# Multi-LoRA Slots (2 → 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `FluxMultiLoRARemoteNode` from two LoRA slots to four, with progressive disclosure so a fresh node still looks like today's two-slot node.

**Architecture:** The Replicate model `lucataco/flux-dev-multi-lora` already takes `hf_loras`/`lora_scales` as unbounded arrays, so this is a schema + UI change with no new node and no migration. Slot-collection logic moves out of `execute` into a pure, unit-testable helper in `replicate_refs.py`; slot visibility moves out of `ComfyNode.vue` into a pure, unit-testable module in `app/lib/graph/`.

**Tech Stack:** Python (ComfyUI custom node, pytest), Vue 3 + TypeScript (Nuxt 4, vitest).

## Global Constraints

- `lora_a` and `lora_b` keep their exact names, defaults, and `lora_kind` values. Saved workflows, `HERO_BY_DOMAIN`, and the agent capability must keep working unchanged.
- Slot A alone carries `extra_dict={"sailor_widget": "lora_picker", "lora_kind": "character"}`. Slots B, C, D carry `extra_dict={"sailor_widget": "lora_picker"}` (no `lora_kind` → Styles gallery).
- Scale defaults taper: A `0.9`, B `0.8`, C `0.7`, D `0.6`.
- URL override inputs (`lora_*_url`) are `advanced=True`.
- Scale widget names MUST follow `lora_X` → `scale_X`, or the existing fold in `ComfyNode.vue:904` silently stops pairing them.
- `HERO_BY_DOMAIN` is NOT modified (explicit non-goal in the spec).
- Python node changes require a ComfyUI restart to take effect — they are not hot-reloaded.
- Spec: `docs/superpowers/specs/2026-08-02-multi-lora-slots-design.md`

**Design refinement vs the spec:** the spec said the collection helper would be a module-level function in `nodes_replicate.py`. It goes in `comfy_api_nodes/replicate_refs.py` instead — that module is deliberately dependency-light and imports without ComfyUI's `server` chain, which is what makes its tests fast and shim-free. Same intent (pure + testable), better home. `nodes_replicate.py` re-imports it, as it already does for eleven other helpers.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `comfy_api_nodes/replicate_refs.py` | **Modify.** Add `_multilora_collect` — pure slot dedup/drop logic. |
| `comfy_api_nodes/nodes_replicate.py` | **Modify.** Import the helper; add C/D schema inputs; extend `execute`; update copy. |
| `tests-unit/comfy_api_test/multilora_slots_test.py` | **Create.** Pure tests for `_multilora_collect`. |
| `frontend/app/lib/graph/loraSlotVisibility.ts` | **Create.** Pure progressive-disclosure rule. |
| `frontend/tests/unit/lora-slot-visibility.unit.spec.ts` | **Create.** Tests for the rule. |
| `frontend/app/components/vue-canvas/ComfyNode.vue` | **Modify.** Register the rule in `WIDGET_VISIBILITY`. |
| `frontend/app/data/action-catalog.ts` | **Modify.** Copy: "two LoRAs" → "multiple". |
| `frontend/app/lib/agent/capabilities.ts` | **Modify.** Copy: title/summary. |

---

### Task 1: Pure slot-collection helper

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py` (append near the other LoRA helpers)
- Test: `tests-unit/comfy_api_test/multilora_slots_test.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_multilora_collect(resolved: list[tuple[str | None, float]]) -> tuple[list[str], list[float]]`. Takes already-resolved `(weights_ref_or_None, scale)` pairs in slot order; returns parallel `(loras, scales)` lists. Task 2 calls this.

Resolution stays in `execute` because `_autodetect_huggingface` is async; this helper is deliberately sync and pure so its tests need no event loop.

**Scope note (reconciles a spec test bullet):** the spec listed "a URL override beats the picker" among this task's tests. That precedence lives in `_resolve_slot`, an async closure inside `execute` — pre-existing, unchanged by this work, and not reachable from a pure sync helper without a refactor this plan doesn't justify. It is instead exercised live in Task 5 Step 3, which fills spare slots with HuggingFace URL overrides. Do not add a fake unit test for it here.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_api_test/multilora_slots_test.py`:

```python
"""Pure tests for multi-LoRA slot collection.

Lives against `replicate_refs` (not `nodes_replicate`) because that module is
dependency-light and imports without ComfyUI's `server` chain — no sys.path
shim needed, unlike lipsync_node_test.py / fal_dispatch_test.py.
"""
from comfy_api_nodes.replicate_refs import _multilora_collect


def test_drops_unresolved_slots_and_their_scales():
    loras, scales = _multilora_collect([("A", 0.9), (None, 0.8), ("C", 0.7)])
    assert loras == ["A", "C"]
    assert scales == [0.9, 0.7]


def test_keeps_scales_paired_to_their_own_slot():
    # The middle slot dropping must not shift C's scale onto A.
    loras, scales = _multilora_collect([(None, 0.9), ("B", 0.8), (None, 0.7), ("D", 0.6)])
    assert loras == ["B", "D"]
    assert scales == [0.8, 0.6]


def test_duplicate_refs_collapse_keeping_the_higher_scale():
    # Same LoRA in two slots would make the list a palindrome, defeating the
    # order-alternation cache defence in execute(). Collapse it.
    loras, scales = _multilora_collect([("X", 0.5), ("Y", 0.8), ("X", 0.9)])
    assert loras == ["X", "Y"]
    assert scales == [0.9, 0.8]


def test_duplicate_collapse_preserves_first_seen_order():
    loras, _ = _multilora_collect([("X", 0.9), ("Y", 0.8), ("X", 0.1)])
    assert loras == ["X", "Y"]


def test_all_empty_yields_empty_lists():
    # execute() relies on this to raise its "No LoRAs resolved" error.
    assert _multilora_collect([(None, 0.9), (None, 0.8)]) == ([], [])


def test_empty_string_ref_counts_as_unresolved():
    loras, scales = _multilora_collect([("", 0.9), ("B", 0.8)])
    assert loras == ["B"]
    assert scales == [0.8]


def test_deduped_list_is_never_a_palindrome():
    # The property the cache defence depends on: reversing a deduped list of
    # 2+ distinct entries always produces a different list.
    loras, _ = _multilora_collect([("X", 0.9), ("Y", 0.8), ("X", 0.7)])
    assert len(loras) >= 2
    assert list(reversed(loras)) != loras
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/multilora_slots_test.py -v`
Expected: FAIL — `ImportError: cannot import name '_multilora_collect'`

- [ ] **Step 3: Write minimal implementation**

Append to `comfy_api_nodes/replicate_refs.py`:

```python
def _multilora_collect(resolved):
    """Turn resolved (weights_ref, scale) slot pairs into parallel lists.

    Drops slots that resolved to nothing, taking their scale with them, and
    collapses duplicate refs onto their highest scale. Deduping matters beyond
    tidiness: nodes_replicate's warm-container cache defence works by REVERSING
    the LoRA list so consecutive requests never look identical, and a list with
    a repeat can be a palindrome (``[X, Y, X]``) that reverses to itself. Once
    every entry is distinct, a list of 2+ always differs from its reverse.
    """
    loras: list[str] = []
    scales: list[float] = []
    for ref, scale in resolved:
        if not ref:
            continue
        if ref in loras:
            i = loras.index(ref)
            scales[i] = max(scales[i], scale)
            continue
        loras.append(ref)
        scales.append(scale)
    return loras, scales
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/multilora_slots_test.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/multilora_slots_test.py
git commit -m "feat(replicate): pure multi-LoRA slot collection with duplicate collapse"
```

---

### Task 2: Four slots in the node schema and execute

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py:71-91` (import block), `:659-670` (schema header), `:717-721` (after `scale_b`), `:771-800` (execute)

**Interfaces:**
- Consumes: `_multilora_collect` from Task 1.
- Produces: node inputs `lora_c`, `lora_c_url`, `scale_c`, `lora_d`, `lora_d_url`, `scale_d`. Task 3's visibility rule keys off exactly these names.

- [ ] **Step 1: Import the helper**

In the `from comfy_api_nodes.replicate_refs import (` block (line 71), add `_multilora_collect` in alphabetical position — immediately before `_normalize_lora_ref`:

```python
    _multilora_collect,
    _normalize_lora_ref,
```

- [ ] **Step 2: Update the node's display name and description**

Replace lines 661-669:

```python
            node_id="FluxMultiLoRARemoteNode",
            display_name="Flux Dev + LoRAs (Replicate)",
            category="api node/image/Replicate",
            description=(
                "Stack up to FOUR LoRAs on Flux Dev in a single generation via "
                "Replicate's lucataco/flux-dev-multi-lora — e.g. a character "
                "LoRA + a style LoRA + accents, each with its own scale. Pick "
                "locally-trained LoRAs (uses the weights artifact from their "
                "sidecar) or override a slot with a HuggingFace / CivitAI / "
                ".safetensors reference. Empty slots are skipped. Requires "
                "REPLICATE_API_TOKEN."
            ),
```

- [ ] **Step 3: Update the prompt tooltip**

Replace the `prompt` input's tooltip (line ~675):

```python
                    tooltip="Text prompt. Include the trigger word of every LoRA you stack.",
```

- [ ] **Step 4: Add slots C and D**

Insert directly after the `scale_b` block (which closes at line 721) and before `IO.Combo.Input("aspect_ratio"...)`:

```python
                # ── Slot C (an accent — style, texture, lighting) ──
                IO.Combo.Input(
                    "lora_c",
                    options=lora_options,
                    default="[None]",
                    tooltip="Third LoRA — an accent on top of the character + style.",
                    extra_dict={"sailor_widget": "lora_picker"},
                ),
                IO.String.Input(
                    "lora_c_url",
                    default="",
                    multiline=False,
                    tooltip="Override for slot C (same forms as slot A). Wins over lora_c.",
                    advanced=True,
                ),
                IO.Float.Input(
                    "scale_c",
                    default=0.7, min=0.0, max=1.5, step=0.05,
                    tooltip="Strength of LoRA C. Lower than B — accents should not compete.",
                ),
                # ── Slot D (a second accent) ──
                IO.Combo.Input(
                    "lora_d",
                    options=lora_options,
                    default="[None]",
                    tooltip="Fourth LoRA — a second accent. Stacking this many adapters softens all of them.",
                    extra_dict={"sailor_widget": "lora_picker"},
                ),
                IO.String.Input(
                    "lora_d_url",
                    default="",
                    multiline=False,
                    tooltip="Override for slot D (same forms as slot A). Wins over lora_d.",
                    advanced=True,
                ),
                IO.Float.Input(
                    "scale_d",
                    default=0.6, min=0.0, max=1.5, step=0.05,
                    tooltip="Strength of LoRA D. The lightest slot by default.",
                ),
```

- [ ] **Step 5: Extend the execute signature**

Replace lines 771-779 (the signature). New slots take defaults so a stored workflow serialised before this change still calls cleanly:

```python
    @classmethod
    async def execute(
        cls,
        prompt: str,
        lora_a: str, lora_a_url: str, scale_a: float,
        lora_b: str, lora_b_url: str, scale_b: float,
        aspect_ratio: str, num_inference_steps: int, guidance: float,
        seed: int,
        image=None, prompt_strength: float = 0.8,
        lora_c: str = "[None]", lora_c_url: str = "", scale_c: float = 0.7,
        lora_d: str = "[None]", lora_d_url: str = "", scale_d: float = 0.6,
    ):
```

- [ ] **Step 6: Route slot collection through the helper**

Replace the inline loop (lines ~791-799, from `loras: list[str] = []` through the `scales.append(scale)` block) with:

```python
        resolved_slots = []
        for name, url, scale in (
            (lora_a, lora_a_url, scale_a),
            (lora_b, lora_b_url, scale_b),
            (lora_c, lora_c_url, scale_c),
            (lora_d, lora_d_url, scale_d),
        ):
            resolved_slots.append((await _resolve_slot(name, url), scale))

        loras, scales = _multilora_collect(resolved_slots)
```

Leave everything below untouched — the `if not loras: raise RuntimeError(...)`, the `_MULTILORA_ROTATE` alternation, the `_loaded` log check and retry, the img2img branch, and the alpha strip all still hold for 3–4 entries.

- [ ] **Step 7: Verify the module still imports and existing tests pass**

Run: `.venv/bin/python -c "import utils.install_util; from comfy_api_nodes.nodes_replicate import FluxMultiLoRARemoteNode as N; s=N.define_schema(); print([i.id for i in s.inputs if 'lora' in i.id or 'scale' in i.id])"`
Expected: `['lora_a', 'lora_a_url', 'scale_a', 'lora_b', 'lora_b_url', 'scale_b', 'lora_c', 'lora_c_url', 'scale_c', 'lora_d', 'lora_d_url', 'scale_d']`

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q`
Expected: all pass, no new failures

- [ ] **Step 8: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py
git commit -m "feat(replicate): four LoRA slots on FluxMultiLoRARemoteNode"
```

---

### Task 3: Progressive disclosure for slots C and D

**Files:**
- Create: `frontend/app/lib/graph/loraSlotVisibility.ts`
- Create: `frontend/tests/unit/lora-slot-visibility.unit.spec.ts`
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (import + `WIDGET_VISIBILITY` entry at `:490-543`)

**Interfaces:**
- Consumes: the widget names from Task 2.
- Produces: `isLoraSlotWidgetVisible(widgetName: string, values: any[], defs: any[]): boolean`, shaped to drop straight into `WIDGET_VISIBILITY` alongside the existing `isVisibleForModel` delegations.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/lora-slot-visibility.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isLoraSlotWidgetVisible } from '~/lib/graph/loraSlotVisibility'

/**
 * FluxMultiLoRARemoteNode has four slots but must look like a two-slot node at
 * rest. Slot N appears once every earlier slot is filled — or when N itself
 * already holds a value, so a workflow saved with C set but B cleared doesn't
 * hide a value that will still be submitted.
 */
const DEFS = [
  { name: 'prompt' },
  { name: 'lora_a' }, { name: 'lora_a_url' }, { name: 'scale_a' },
  { name: 'lora_b' }, { name: 'lora_b_url' }, { name: 'scale_b' },
  { name: 'lora_c' }, { name: 'lora_c_url' }, { name: 'scale_c' },
  { name: 'lora_d' }, { name: 'lora_d_url' }, { name: 'scale_d' },
]

// Values are positional, matching DEFS.
function values(over: Record<string, any> = {}) {
  return DEFS.map(d => {
    if (d.name in over) return over[d.name]
    if (d.name === 'prompt') return ''
    if (d.name.startsWith('scale_')) return 0.8
    if (d.name.endsWith('_url')) return ''
    return '[None]'
  })
}
const vis = (n: string, v: any[]) => isLoraSlotWidgetVisible(n, v, DEFS)

describe('isLoraSlotWidgetVisible', () => {
  it('leaves non-slot widgets alone', () => {
    expect(vis('prompt', values())).toBe(true)
    expect(vis('aspect_ratio', values())).toBe(true)
  })

  it('always shows slots A and B', () => {
    for (const n of ['lora_a', 'lora_a_url', 'scale_a', 'lora_b', 'lora_b_url', 'scale_b']) {
      expect(vis(n, values())).toBe(true)
    }
  })

  it('hides C and D on a fresh node', () => {
    for (const n of ['lora_c', 'lora_c_url', 'scale_c', 'lora_d', 'lora_d_url', 'scale_d']) {
      expect(vis(n, values())).toBe(false)
    }
  })

  it('reveals C once A and B are both filled', () => {
    const v = values({ lora_a: 'char.safetensors', lora_b: 'style.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('scale_c', v)).toBe(true)
    expect(vis('lora_c_url', v)).toBe(true)
    expect(vis('lora_d', v)).toBe(false)
  })

  it('does not reveal C when only A is filled', () => {
    expect(vis('lora_c', values({ lora_a: 'char.safetensors' }))).toBe(false)
  })

  it('counts a url override as filling its slot', () => {
    const v = values({ lora_a: 'char.safetensors', lora_b_url: 'huggingface.co/x/y' })
    expect(vis('lora_c', v)).toBe(true)
  })

  it('shows a slot that already holds a value even if an earlier one is empty', () => {
    // A workflow saved with C set, then B cleared. Hiding C would strand a
    // value that still gets submitted.
    const v = values({ lora_c: 'accent.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('scale_c', v)).toBe(true)
  })

  it('treats [None] and blanks as empty', () => {
    expect(vis('lora_c', values({ lora_a: '[None]', lora_b: '   ' }))).toBe(false)
  })

  it('reveals D only when A, B and C are all filled', () => {
    const abc = values({ lora_a: 'a.safetensors', lora_b: 'b.safetensors', lora_c: 'c.safetensors' })
    expect(vis('lora_d', abc)).toBe(true)
    const ab = values({ lora_a: 'a.safetensors', lora_b: 'b.safetensors' })
    expect(vis('lora_d', ab)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/lora-slot-visibility.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/graph/loraSlotVisibility`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/graph/loraSlotVisibility.ts`:

```ts
/**
 * Progressive disclosure for FluxMultiLoRARemoteNode's four LoRA slots.
 *
 * The node has slots A–D, but showing four empty pickers at rest would make a
 * two-LoRA job look like a four-LoRA chore. Slot N appears only once every
 * earlier slot is filled. A and B are always visible, so a fresh node is
 * indistinguishable from the two-slot node this replaced.
 */
const SLOTS = ['a', 'b', 'c', 'd'] as const

/** Slots always shown, however empty — the original A/B pair. */
const ALWAYS_SHOWN = 2

/** `lora_c` / `lora_c_url` / `scale_c` all map to slot 'c'. */
function slotOf(widgetName: string): string | null {
  const m = /^(?:lora_([a-d])(?:_url)?|scale_([a-d]))$/.exec(widgetName)
  return m ? (m[1] ?? m[2] ?? null) : null
}

function valueOf(name: string, values: any[], defs: any[]): unknown {
  const i = defs.findIndex(d => d?.name === name)
  return i >= 0 ? values[i] : undefined
}

/** A slot counts as filled by a real picker selection OR a url override. */
function slotFilled(slot: string, values: any[], defs: any[]): boolean {
  const pick = valueOf(`lora_${slot}`, values, defs)
  const url = valueOf(`lora_${slot}_url`, values, defs)
  const hasPick = typeof pick === 'string' && pick.trim() !== '' && pick.trim() !== '[None]'
  const hasUrl = typeof url === 'string' && url.trim() !== ''
  return hasPick || hasUrl
}

export function isLoraSlotWidgetVisible(widgetName: string, values: any[], defs: any[]): boolean {
  const slot = slotOf(widgetName)
  if (!slot) return true                       // not a slot widget → never our business

  const idx = SLOTS.indexOf(slot as typeof SLOTS[number])
  if (idx < ALWAYS_SHOWN) return true

  // Already carries a value — show it, or a saved workflow strands a value
  // that still gets submitted.
  if (slotFilled(slot, values, defs)) return true

  return SLOTS.slice(0, idx).every(s => slotFilled(s, values, defs))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/lora-slot-visibility.unit.spec.ts`
Expected: PASS, 9 passed

- [ ] **Step 5: Register the rule in ComfyNode.vue**

Add the import to the `~/lib/...` import run at the top of the `<script setup>` block (currently lines 6-13, ending with `capsuleMeta`):

```ts
import { isLoraSlotWidgetVisible } from '~/lib/graph/loraSlotVisibility'
```

Then add an entry to `WIDGET_VISIBILITY` (the map opening at `:490`), immediately before its closing `}` at `:543`:

```ts
  // Flux + LoRAs: four slots, but C and D stay hidden until the slots before
  // them are filled — a fresh node reads as the two-slot node it replaced.
  FluxMultiLoRARemoteNode: (name, values, defs) => isLoraSlotWidgetVisible(name, values, defs),
```

- [ ] **Step 6: Verify the component still compiles and the suite is clean**

Run: `cd frontend && npx vitest run tests/unit/lora-slot-visibility.unit.spec.ts && npx vue-tsc --noEmit -p tsconfig.json 2>/dev/null | grep -cE "loraSlotVisibility|ComfyNode.vue"`
Expected: tests PASS; the grep count for changed files is `0`

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/graph/loraSlotVisibility.ts frontend/tests/unit/lora-slot-visibility.unit.spec.ts frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "feat(canvas): reveal LoRA slots C and D only once earlier slots are filled"
```

---

### Task 4: Catalog and capability copy

**Files:**
- Modify: `frontend/app/data/action-catalog.ts:34`
- Modify: `frontend/app/lib/agent/capabilities.ts:142`

**Interfaces:**
- Consumes: nothing. Pure copy.
- Produces: nothing consumed by later tasks.

Both strings say "two LoRAs" and will read as a bug once the node takes four. `HERO_BY_DOMAIN` at `:116` is deliberately NOT touched.

- [ ] **Step 1: Update the action catalog entry**

Replace line 34 of `frontend/app/data/action-catalog.ts`:

```ts
  FluxMultiLoRARemoteNode: { useCase: 'Generate with multiple LoRAs', model: 'Flux Dev + LoRAs',                        intent: 'create' },
```

- [ ] **Step 2: Update the agent capability entry**

On line 142 of `frontend/app/lib/agent/capabilities.ts`, change the `title` and `summary` only — leave `nodeType`, `kind`, `inputs`, `outputs` and everything after untouched:

```ts
  { nodeType: 'FluxMultiLoRARemoteNode', kind: 'generator', title: 'Generate with multiple LoRAs', summary: 'Stack up to four LoRAs (character + style + accents) in one Flux generation.', inputs: [], outputs: IMG,
```

- [ ] **Step 3: Run the suites that assert over these tables**

Run: `cd frontend && npx vitest run tests/unit/action-catalog.unit.spec.ts tests/unit/agent-coverage-guard.unit.spec.ts tests/unit/agent-capability-routing.unit.spec.ts`
Expected: `action-catalog` and `agent-coverage-guard` PASS. `agent-capability-routing` has 2 pre-existing failures unrelated to this work (documented in commit `f021407db`) — confirm the count is still 2 and that neither names `FluxMultiLoRARemoteNode`.

- [ ] **Step 4: Run the full frontend suite for regressions**

Run: `cd frontend && npx vitest run 2>&1 | tail -5`
Expected: 4 failing files (`agent-capability-routing`, `gradientfx-frame-source`, `spacetype-palette`, `ticker-effect`) — the documented pre-existing set, unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/action-catalog.ts frontend/app/lib/agent/capabilities.ts
git commit -m "docs(canvas): multi-LoRA node takes four slots, not two"
```

---

### Task 5: Live verification (paid — user approved)

**Files:** none modified. This task produces evidence, not code.

**Interfaces:**
- Consumes: Tasks 1–4, all committed.

The failure mode being tested for is a **successful generation with fewer adapters than requested** — `lucataco/flux-dev-multi-lora` returns a perfectly good image when a warm container skips loading. So "an image came back" is not evidence. The assertion is on the prediction logs.

Cost ≈ $0.04 per generation, plus one retry if the cache defence trips.

- [ ] **Step 1: Restart ComfyUI so the new schema loads**

Python node changes are not hot-reloaded.

```bash
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188
```

- [ ] **Step 2: Confirm the schema is live**

Run:
```bash
curl -s http://127.0.0.1:8188/object_info/FluxMultiLoRARemoteNode | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s).FluxMultiLoRARemoteNode;console.log(Object.keys({...o.input.required,...o.input.optional}).filter(k=>/lora|scale/.test(k)))})"
```
Expected: all twelve slot inputs, `lora_a` … `scale_d`.

- [ ] **Step 3: Confirm at least three trained LoRAs have usable sidecars**

Run:
```bash
ls models/loras/*.json | head -5
```
Expected: at least three sidecar JSONs. Verify each has a `replicate_url`; a LoRA without one cannot resolve to a weights ref and will silently drop out of the stack. If fewer than three exist, use HuggingFace URL overrides in the spare slots instead (e.g. `huggingface.co/alvdansen/frosting_lane_flux`).

- [ ] **Step 4: Run a three-LoRA generation**

In the app: open a canvas, add **Flux Dev + LoRAs**, fill slot A (character) and slot B (style), confirm slot C appears, fill it, enter a prompt containing all three trigger words, and run.

- [ ] **Step 5: Assert three LoRAs actually loaded**

This is the whole point of the task. Fetch the prediction and count the load lines:

```bash
TOKEN=$(grep -oE '^NUXT_REPLICATE_TOKEN=.*' frontend/.env | cut -d= -f2-)
curl -s -H "Authorization: Token $TOKEN" "https://api.replicate.com/v1/predictions?limit=1" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).results[0];const logs=p.logs||'';console.log('status:',p.status);console.log('hf_loras:',p.input.hf_loras);console.log('lora_scales:',p.input.lora_scales);console.log('load lines:',(logs.match(/Downloading LoRA weights/g)||[]).length)})"
```

Expected:
- `status: succeeded`
- `hf_loras` — three distinct refs
- `lora_scales` — three numbers, paired to those refs
- `load lines: 3`

If `load lines` is `0`, the warm-container cache bug fired and the retry should have already re-run; check for a second prediction. If it is `1` or `2` with three refs requested, that is a **genuine new bug** — stop and investigate rather than accepting the image.

- [ ] **Step 6: Record the outcome**

Append the prediction id, the three refs, and the load-line count to the plan file as a verification note, then commit.

```bash
git add docs/superpowers/plans/2026-08-02-multi-lora-slots.md
git commit -m "docs(plan): record live 3-LoRA verification"
```

---

## Verification Summary

| Layer | Covered by |
|-------|-----------|
| Slot dedup / drop / scale pairing | Task 1 — 7 pure pytest cases |
| Schema shape (12 inputs, right order) | Task 2 Step 7 — schema introspection |
| Progressive disclosure | Task 3 — 9 vitest cases |
| No regressions | Task 3 Step 6 (typecheck), Task 4 Step 4 (full suite vs known-failing baseline) |
| Adapters genuinely load | Task 5 Step 5 — log-line count, the only real proof |

---

## Task 5 verification record (2026-08-02)

Live 3-LoRA run, ComfyUI restarted to load the new schema.

- **Schema live:** `display_name: Flux Dev + LoRAs (Replicate)`, 12 slot inputs in order,
  scale defaults `0.9/0.8/0.7/0.6`, `lora_kind: character` on slot A only.
- **Prediction:** `0z9kxgg3jsrp40czr659k635a0` — status `succeeded`.
- **3 distinct refs**, `lora_scales [0.7, 0.8, 0.9]`.
- **LOAD LINES: 3** — plus three independent `Loading LoRA took: 5.54 / 5.09 / 2.98 seconds`
  confirmations. All three adapters genuinely loaded.
- **Scale pairing survived the order reversal:** the cache defence reversed the list
  (C, B, A), and each scale stayed with its own ref — `0.7`↔Dotwork_Monochrome (slot C),
  `0.8`↔Azure_Bloom (slot B), `0.9`↔Cartoon_Character (slot A).
- **Visual corroboration:** output shows all three — cartoon creature, blue palette/blooms,
  and dotwork stipple texture.

**Measurement gotcha for future runs:** Replicate's LIST endpoint
(`/v1/predictions?limit=N`) returns predictions with **empty/truncated `logs`**. Counting
load lines there reports `0` on a perfectly good run and looks exactly like the bug this
test exists to catch. Always assert against the DETAIL endpoint
(`/v1/predictions/<id>`).

Progressive disclosure separately verified in a real browser (free, no generation):
visible slot count went `2 → 2 → 3 → 4` for fresh → A only → A+B → A+B+C, a url override
in D kept it at 4, and with B cleared while C held a value C stayed visible — the
stranded-value case.
