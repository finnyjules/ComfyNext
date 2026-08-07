# Moodboards Plan B — Nano Refs, Every Generator, The Taste Wire

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete moodboard v1: the block reaches every generator, board references ride along on ref-capable models (Nano Banana Pro as the reference implementation), connecting a moodboard auto-switches the model-picker generator to the moodboard default, and the taste wire exists on the canvas backed by a Python twin node.

**Architecture:** Ordered by Julien's priority — the nano/refs marquee lands before the wire. The ref gate derives from the catalog's `multi-image` tag (fixed first — nano-banana-pro lacks it). Refs travel as an appended, optional, `force_input`-free hidden STRING widget carrying small JSON (`{folder, files[]}` — input-dir-relative paths, never data URLs, so saved projects don't bloat); the Python side reads the files from `input/` and widens `ModelInputBuilder` with an optional refs parameter. The Moodboard node gains a Python twin (STRING output compiled from a hidden widget) so the TASTE edge survives `stripFrontendOnlyNodes` and serializes through `graphToPrompt` untouched.

**Tech Stack:** Python (comfy_api_nodes), Nuxt/Vue/TS, vitest, pytest (`tests-unit/comfy_api_test/`), Playwright.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-06-moodboard-styles-design.md` (incl. the 2026-08-07 auto-switch amendment). Spec wins on conflict.
- **Schema inputs are APPENDED, never inserted** (`nodes_replicate.py:763-770` contract comment; guard tests exist and must be extended, not weakened). `force_input` STRING inputs occupy no `widgets_values` slot (`widgetOrder.ts:28`) — the safe shape for wire-only inputs.
- Refs payloads are file paths under `input/` (validated with `MOODBOARD_FOLDER_RE` + `safeImageFile`), never base64 — saved-project size is a contract.
- Model switches are legible, never silent; run cost stays on the Run button. No model re-switch after a manual user choice.
- Money explicit; nano generations are ~$0.15/img (Pro) — nothing in this plan spends without the user clicking Run, except the named paid-checklist steps which Julien runs.
- Zero NEW typecheck errors per task (baseline ~412); pytest suite for comfy_api_test must stay green; broken-control discipline throughout; commit per task with the Fable trailer.
- Parallel-session hygiene: `app/lib/scene3d/*` and `Scene3DStudioSurface.vue` belong to another session — never stage them.

---

### Task B1: Fix the ref-capability tags — TS + Python mirror + parity

**Files:**
- Modify: `frontend/app/data/image-models.ts` (nano-banana-pro gains `'multi-image'`)
- Modify: `comfy_api_nodes/image_models.py` (dataclass gains `tags: tuple[str, ...] = ()`; mirror tags for ALL models that have them TS-side)
- Modify: `frontend/tests/unit/catalog-parity.unit.spec.ts` (parity now covers tags)
- Test: `tests-unit/comfy_api_test/image_models_tags_test.py`

**Interfaces:**
- Produces: Python `ImageModel.tags`; `accepts_refs(spec) -> bool` helper (`'multi-image' in spec.tags`) exported from `image_models.py` for B3. TS side unchanged in shape — only the nano-banana-pro entry's tag list changes.

- [ ] **Step 1: Failing tests.** Python: `image_models_tags_test.py` asserts `IMAGE_MODELS_BY_ID['nano-banana-pro'].tags` contains `'multi-image'` and `accepts_refs` is True for exactly the set of TS-tagged models (load the TS file with a regex extraction of `id` + `tags` pairs, the way `catalog-parity.unit.spec.ts` reads across the boundary — read that spec first and mirror its technique in Python or keep the cross-check TS-side only and make the Python test self-referential: every model with `multi-image` in TS must have it in Python; the parity spec is the enforcer). TS: extend `catalog-parity.unit.spec.ts` to compare per-model tag sets between the two files.
- [ ] **Step 2:** Red → implement: add `tags` to the Python dataclass with default `()`, thread tags into every constructor call that has TS tags (mechanical; keep order identical to TS), add `'multi-image'` to nano-banana-pro in BOTH files, add `accepts_refs`.
- [ ] **Step 3:** `npx vitest run tests/unit/catalog-parity.unit.spec.ts` green; `python -m pytest tests-unit/comfy_api_test/image_models_tags_test.py -v` green. Broken control: remove nano-banana-pro's tag TS-side only → parity test reds → restore.
- [ ] **Step 4: Commit** — `fix(catalog): nano-banana-pro is ref-capable — tags mirrored into the Python catalog [B1]`.

---

### Task B2: Moodboard apply on the Generate-an-image node + block injection

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (`GenerateImageNode.define_schema`: APPEND optional STRING widget `style_block` (multiline, default `''`, `extra_dict={"sailor_widget": "internal"}`) and optional STRING widget `style_refs` (default `''`, internal) — both appended LAST; `execute` gains the params and prepends `style_block` to `prompt` when non-empty)
- Modify: `frontend/app/layouts/default.vue` (`injectLoraStyleIntoPrompt` → renamed concern: also handle `GenerateImageNode` by writing the composed block into its `style_block` widget BY NAME via the objectInfo widget order — never positional index 0; the FLUX nodes keep their existing prompt-prepend behavior)
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` + widgets (the GenerateImageNode face gains a compact moodboard chip row: pick from the gallery (`sailor:openLoraGallery` with a new kind `'moodboard'` and widgetName `'style_block'`), stored as `properties.sailor_moodboard` + `properties.aesthetic` via the existing `writeAesthetic` else-branch; chip shows name + thumb + ✕)
- Modify: `frontend/app/components/vue-canvas/LoraGalleryModal.vue` (`kind === 'moodboard'` opens directly on the Moodboards tab; confirm writes `properties.aesthetic` + `properties.sailor_moodboard` for non-slot targets)
- Test: extend `tests-unit/comfy_api_test/multilora_schema_order_test.py` (a `GenerateImageNode` order test: `style_block`/`style_refs` indices strictly after all pre-existing inputs), `frontend/tests/unit/graph-to-prompt.unit.spec.ts` (a workflow with `style_block` written by name lands in the API payload), new `frontend/tests/unit/generate-image-style-inject.unit.spec.ts` (the injection helper writes by widget NAME: feed a fake objectInfo where prompt is index 1 — a positional-index-0 implementation must fail)
- **Widget realign guard:** extend `frontend/tests/unit/multilora-widget-realign.unit.spec.ts`'s technique with a GenerateImageNode case: an old 6-value `widgets_values` array realigns with every old value on its own widget.

**Interfaces:**
- Produces: `GenerateImageNode` accepts `style_block: str` (prepended to prompt in `execute`) and `style_refs: str` (JSON, consumed in B3 — B2 only threads it to `execute` unused); client-side `applyMoodboardToGenerateNode(node, entry)` in `frontend/app/lib/graph/moodboardApply.ts` returning the property writes (pure, testable) used by both the chip picker and B4's wire materialization.

- [ ] **Steps:** failing tests (all four files) → red → implement Python schema append + execute prepend → implement client injection-by-name + chip UI → green, including the positional-index broken control and the realign round-trip. Live drive: add Generate-an-image node, apply a seeded moodboard via the chip, serialize, assert the API payload's `style_block` carries the block; run the existing A8 E2E unchanged-green (no regression on the FLUX path).
- [ ] **Commit** — `feat(moodboard): every generator — style_block on GenerateImageNode, apply chip, name-based injection [B2]`.

---

### Task B3: References ride along — nano as reference implementation + auto-switch

**Files:**
- Modify: `comfy_api_nodes/image_models.py` (`ModelInputBuilder` gains optional `refs: list[str] | None = None` (data URLs, built node-side); nano-banana-pro + nano-banana-2 + seedream builders emit `image_input`/`image_urls` per their live schemas when refs present — borrow the existing in-file nano `image_input` helper code; every other builder ignores the param)
- Modify: `comfy_api_nodes/nodes_replicate.py` (`GenerateImageNode.execute`: when `style_refs` JSON parses to `{folder, files[]}` AND `accepts_refs(spec)`, validate folder/files with the moodboard guards (port `MOODBOARD_FOLDER_RE` + safe-file rules to a small Python helper), read ≤3 files from `input/<folder>/`, base64 → data URLs, append the style-only instruction to the prompt (`"Use the attached reference images strictly as STYLE references — match their palette, light, grain and mood; do not copy their subjects or composition."`), pass refs to the builder)
- Modify: `frontend/app/lib/graph/moodboardApply.ts` (B2's helper also writes `style_refs` JSON when the node's model `tags` include `multi-image`; clears it otherwise)
- Modify: the apply/connect path (chip pick + B4 wire connect): **auto-switch** — if the node's current model lacks `multi-image`, set the model widget to `nano-banana-pro` (the moodboard default constant `MOODBOARD_DEFAULT_MODEL` in `moodboardApply.ts`), write a `properties.sailor_moodboard_switched = previousModelId` marker, show the node notice ("switched to Nano Banana for full style transfer") with one-click revert (restores the marker model, clears refs); a manual model change clears the marker and is never overridden
- Modify: the moodboard chip renders **"refs ✓"** when `style_refs` is set
- Test: `tests-unit/comfy_api_test/generate_image_refs_test.py` (builder emits `image_input` for nano with refs, omits without; non-ref model ignores refs — broken control: force refs into a FLUX builder and assert they do NOT appear in its input dict; folder guard rejects `lora_dataset_*` and traversal), `frontend/tests/unit/moodboard-apply.unit.spec.ts` (gate by tag; auto-switch writes model + marker; manual-choice-wins: applying with marker cleared does not re-switch; revert restores)

- [ ] **Steps:** failing tests both sides → red → implement → green with broken controls. Live drive (no paid run): apply moodboard to a Generate node on flux-schnell → assert model widget switched to nano-banana-pro + notice visible + "refs ✓" chip + `style_refs` JSON present; revert → model back, refs cleared; re-apply after manual model pick → no switch. Serialize and assert the API payload carries `style_refs`.
- [ ] **Commit** — `feat(moodboard): refs ride along — nano reference implementation, tag-gated, legible auto-switch [B3]`.

---

### Task B4: The Python twin + the TASTE wire

**Files:**
- Create: Python `MoodboardNode` in `comfy_api_nodes/nodes_replicate.py` (or a new `comfy_extras/nodes_moodboard.py` — follow where frontend-facing utility nodes live; register in the same node list): `define_schema` = one hidden STRING widget `reading_json` (internal) + optional STRING widget `moodboard_id` (internal); output: ONE `IO.String.Output("style")` — verify whether `IO.Custom("TASTE")` exists in `comfy_api/latest/_io.py` first (10-minute check); if yes use output type TASTE and input type TASTE on consumers, if no use STRING and give the frontend port the union type `'TASTE,STRING'` (`typeUnion` in `portTypes.ts` handles comma unions). `execute` compiles the block: a Python port of `moodboardStyleBlock` (same output string — parity test against three fixtures shared as JSON)
- Modify: `comfy_api_nodes/nodes_replicate.py` (`FluxMultiLoRARemoteNode` + `GenerateImageNode` gain APPENDED optional `style_in` (force_input STRING or TASTE) and `prompt_in` (force_input STRING — the Idea node's socket); execute: `prompt_in` non-empty replaces/joins the prompt widget value; `style_in` prepends before everything, ahead of `style_block`/slot blocks — wire first)
- Modify: `frontend/app/lib/agent/capabilities.ts` (Moodboard LEAVES the frontend-only set — it has a backend twin now and must survive the strip)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`createNodeData` Moodboard branch now synthesizes outputs `[{ name: 'style', type: <TASTE-or-union> }, { name: 'image', type: 'IMAGE' }]`; the image output resolves to nothing at run in this plan — a stub output whose link the strip… NO: with the twin the node isn't stripped, and Python `MoodboardNode` has no IMAGE output. DECISION: v1 ships the `style` output only; the `image` output moves to the deferred list with @refs — the spec's image-wiring is satisfied via @refs in B5.)
- Modify: `frontend/app/composables/useVueNodes.ts` (`TYPE_COLORS` gains `TASTE: '#d9a35c'`)
- Modify: MoodboardNode.vue / save path (on save AND on node reference change, write `reading_json` + `moodboard_id` into the node's `widgets_values` by name so `graphToPrompt` carries the payload; the modal's save already writes `properties.sailor_moodboard` — extend the write-back to sync the widget)
- Test: Python schema-order test extension (style_in/prompt_in appended, force_input flags asserted, widget COUNT unchanged for both generators — force_input adds no widgets); block-compile parity test (Python vs TS over shared fixtures); TS: graph-to-prompt spec case — a Moodboard node wired to a generator's style_in serializes to `inputs.style_in = [moodboardNodeId, 0]`; strip test — Moodboard no longer in `FRONTEND_ONLY_NODE_TYPES`

- [ ] **Steps:** failing tests → red → implement Python twin + generator inputs → frontend port/type/color/sync → green. Live drive: wire moodboard → generator style_in (drag between ports), assert the amber edge renders, serialize and assert the link in the prompt payload, run the A8 E2E unchanged-green.
- [ ] **Commit** — `feat(moodboard): Python twin + TASTE wire; prompt_in lands (Idea node socket) [B4]`.

---

### Task B5: @refs exposure + E2E + paid checklist

**Files:**
- Modify: moodboard save path (on save, `setRef` board images into the project's asset registry as `mb-<slug>-<i>` — read `useRefRegistry`/`lib/refs/registry.ts`; the `filename` must resolve in ComfyUI's input dir: verify a subpath `moodboard_<ms>/<file>` loads via the app's image widgets — if not, fall back to registering only a binding-compatible form and document it)
- Create: `frontend/tests/moodboard-wires.spec.ts` (Playwright E2E: seeded moodboard → Generate node → wire style_in → payload carries the link; apply-chip on schnell → auto-switch to nano + refs ✓ + style_refs in payload; revert works; @refs names listed)
- Modify: spec status block (Plan B shipped range) + `docs/STATE.md` gets a short moodboards entry (both plans, one paragraph, honest opens)
- **Paid checklist (Julien or a keyed session):** one real nano-banana-pro generation with a moodboard applied (the marquee moment, ~$0.15) + the Pro-vs-2 A/B pair (~$0.13) to settle the default; results recorded in the spec.

- [ ] **Steps:** implement @refs registration + verify the subpath question live → E2E written and green → docs updated → commit `feat(moodboard): @refs + wires E2E; Plan B shipped [B5]`.

---

## Deferred (named, not silent)
The node's `image` output port (superseded by @refs in v1 — revisit with Plan C if wiring pixels proves wanted); refs on `EditImageNode`; the kit-finish pass on generated outputs; Seedream ref verification beyond schema conformance (their `image_urls` shapes are coded to catalog schemas but get no paid verification in this plan).
