# Multi-LoRA image generation: 2 → 4 slots

**Date:** 2026-08-02
**Status:** Approved, ready for planning
**Node:** `FluxMultiLoRARemoteNode` (`comfy_api_nodes/nodes_replicate.py:659`)

## Problem

The trainer can produce many LoRAs — characters and styles — but a single
generation can only combine **two** of them. `FluxMultiLoRARemoteNode` exposes
exactly two slots: A (character) and B (style). Users who want a character in a
style with an additional accent LoRA have no way to express it.

This is a schema limit, not a model limit. The underlying Replicate model
`lucataco/flux-dev-multi-lora` declares both LoRA inputs as unbounded arrays:

```
hf_loras    array<string>   (no maxItems)
lora_scales array<number>   (no maxItems)
```

Confirmed against the live model schema on 2026-08-02.

## Non-goals

- **Not** a new node. The existing one is mature and carries a hard-won
  workaround (below) that must not be re-derived.
- **Not** unbounded slots. A dynamic row editor was considered and rejected —
  several times the cost, and it discards the picker/scale folding that already
  works. Four is the practical ceiling before stacked adapters visibly fight.
- **Not** a hero-tier promotion. `HERO_BY_DOMAIN.image` already pins four
  actions; a fifth dilutes it and the single-LoRA node remains the more common
  entry point.
- **Not** a migration. `lora_a` / `lora_b` keep their names and meanings.

## Existing machinery this relies on

Three mechanisms already in the codebase make this cheap. Each was verified by
reading the source, not assumed.

1. **Scale folding is convention-based.** `scaleNameForPicker`
   (`frontend/app/components/vue-canvas/ComfyNode.vue:904`) maps `lora_X` →
   `scale_X` generically. New slots fold their strength slider into the picker
   card with **zero** frontend changes.
2. **`WIDGET_VISIBILITY`** (`ComfyNode.vue:490`) is a per-node rule
   `(name, values, defs) => boolean`, applied to both the normal and the
   `advanced` widget loops. This is the progressive-disclosure hook.
3. **`execute` already loops over slots**, resolving each and skipping the
   unresolved ones. Extending the tuple list is the whole change.

Precedent for many optional slots: `Compositor` declares **16** layer slots with
grouped, collapsible widgets (`ComfyNode.vue` `WIDGET_GROUPS`).

## Design

### 1. Schema (`nodes_replicate.py`)

Add three inputs per new slot, mirroring A/B exactly:

| Slot | Picker | URL override | Scale default |
|------|--------|--------------|---------------|
| A | `lora_a` (`lora_kind: character`) | `lora_a_url` | 0.9 |
| B | `lora_b` | `lora_b_url` | 0.8 |
| **C** | **`lora_c`** | **`lora_c_url`** | **0.7** |
| **D** | **`lora_d`** | **`lora_d_url`** | **0.6** |

C and D carry no `lora_kind`, so they browse Styles. Only A browses Characters.

Scale defaults **taper deliberately**. Later slots are accents, and a descending
default is the cheapest defence against adapters overpowering each other.

URL overrides stay `advanced=True`, as A/B's are.

Copy changes:
- `display_name`: `"Flux Dev + 2 LoRAs (Replicate)"` → `"Flux Dev + LoRAs (Replicate)"`
- `description`: "Stack TWO LoRAs" → "Stack up to FOUR LoRAs"
- `prompt` tooltip: "Include BOTH LoRAs' trigger words" → "Include every LoRA's trigger word"

### 2. Progressive disclosure

New `WIDGET_VISIBILITY.FluxMultiLoRARemoteNode` rule. A slot's three widgets are
visible when:

- it is slot A or B (always visible — preserves today's appearance), **or**
- every earlier slot has a value, **or**
- the slot itself already has a value.

The third clause matters: a workflow saved with C set but B cleared must still
render C, or the user loses access to a value that will still be submitted.

At rest, a fresh node looks exactly like today's two-slot node.

### 3. Execute

Extract the inline slot loop into a pure, importable module-level helper —
matching the convention in `tests-unit/comfy_api_test/lipsync_node_test.py`,
which tests `_lipsync_build_input` with no network:

```python
def _multilora_collect(
    slots: list[tuple[str, str, float]],   # (lora_name, lora_url, scale)
    resolve: Callable[[str, str], str | None],
) -> tuple[list[str], list[float]]:
    """Resolve each slot to a weights ref, dropping empties and duplicates."""
```

Rules:
- An unresolved slot is dropped, taking its scale with it.
- A URL override wins over the picker for that slot (unchanged).
- **Duplicate weights refs collapse, keeping the higher scale.**

`execute` passes four tuples instead of two. Everything downstream —
`hf_loras`, `lora_scales`, the img2img branch, the alpha strip — is unchanged.

### 4. The duplicate-slot bug this fixes

`execute` defends against a real defect in the shared public model: it only
(re)loads LoRAs when a request differs from the last one a given warm container
saw, and its no-LoRA branch unloads adapters *without* resetting that memory. So
a stranger's no-LoRA request can leave our next identical request running
vanilla Flux with no error.

The defence alternates LoRA **order** each call so consecutive requests never
look identical, then verifies from the logs that a load happened and retries once
with the order flipped if not.

Reversal only produces a difference when the list is not a palindrome. Today,
with the same LoRA picked into both slots, `[X, Y, X]` reverses to itself — the
defence silently no-ops and the user can get vanilla Flux with no error. Adding
slots C and D widens that window.

Deduping in `_multilora_collect` closes it: once every entry is distinct, a list
of length ≥ 2 always differs from its reverse, so the alternation is guaranteed
to change the request. Deduping is also correct on its own — sending the same
weights twice is meaningless. The retry-on-missing-load check stays as the
backstop for the cold-cache cases dedupe cannot address.

### 5. Registration and copy

| File | Change |
|------|--------|
| `frontend/app/data/action-catalog.ts:34` | useCase → "Generate with multiple LoRAs"; model → "Flux Dev + LoRAs" |
| `frontend/app/lib/agent/capabilities.ts:142` | title/summary → "multiple"/"up to four" |
| `frontend/app/data/generator-icons.ts` | unchanged |
| `HERO_BY_DOMAIN` | unchanged (explicit non-goal) |

## Testing

### Python unit tests (`tests-unit/comfy_api_test/`)

Against `_multilora_collect` with a stub resolver — no network:

- empty slots are skipped, and their scales go with them
- a URL override beats the picker in the same slot
- scales stay paired to their own slot after drops
- duplicate refs collapse to one entry at the higher scale
- all-empty yields `([], [])` so `execute` still raises its "No LoRAs resolved" error

### Frontend unit tests (`frontend/tests/unit/`)

The visibility rule, extracted so it is importable:

- C and D hidden on a fresh node
- C shown once B has a value
- C shown when C itself has a value even if B is empty
- A and B always shown

### Live verification (paid, approved)

One real generation stacking **three** LoRAs, asserting the prediction logs
contain **three** `Downloading LoRA weights` lines. This is the only evidence
that the model loaded all three rather than silently dropping one — a returned
image proves nothing, since the failure mode is a successful generation with
fewer adapters than requested.

Cost ≈ $0.04 per run, plus one retry if the cache workaround trips.

## Risks

| Risk | Mitigation |
|------|------------|
| Quality degrades past ~3 stacked adapters | Tapered defaults; disclosure makes slots 3–4 deliberate rather than default |
| Log-sniffing for `"Downloading LoRA weights"` depends on a third-party string | Pre-existing; unchanged by this work. If it breaks, the retry simply never fires |
| A saved workflow with C set but B empty | Explicitly handled by the third visibility clause |
| Users expect >4 | Documented ceiling; the row-editor approach stays available if demand appears |
