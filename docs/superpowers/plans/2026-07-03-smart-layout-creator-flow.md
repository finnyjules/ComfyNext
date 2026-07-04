# Smart Layout Creator Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-editor "Turn into variable" for Smart Layout text/image elements; an LLM copy assistant (variations / brief / translate) whose results apply to the element or append as collection rows; an always-visible fine placement grid with columns/rows overlay.

**Architecture:** The editor (SmartLayoutEditorModal → GridEditorShell → useGridEditor → GridEditorCanvas, all DOM-rendered with `resolve()` token substitution) gains: (1) element context menus that tokenize content and dispatch a `comfynext:promoteLayoutElement` event handled in VueNodeCanvas beside the existing studio promote handler (find-or-create Collection + VARS edge + column + binding — SmartLayout is already in `VARS_TARGET_NODE_TYPES`); (2) a `mergedProps` layer so bound elements render RESOLVED collection values in the editor (preview-row via `resolveBindings`), with inspector edits writing through to the cell; (3) a pastel Copy assistant section in GridPropertyPanel calling a new `/api/copy-assist` Nitro route (vibe.post.ts pattern, haiku); (4) a fine-grid overlay drawn from `gridMetrics()` with persisted toggles.

**Tech Stack:** Nuxt 4 / Vue 3 / Vitest; Anthropic API via user key (`getLocalSetting('ComfyNext.AI.AnthropicApiKey')`); no new deps.

## Global Constraints

- Work on `main`, explicit `git add` paths only; pre-flight dirty-check every target file, BLOCKED if dirty (parallel sessions).
- Implementer dispatches FORBID sub-agents (delegation-spiral lesson).
- Pastel gradient = AI affordances ONLY (the Copy assistant section uses it; nothing else). No purple. Emerald = run. Dark tokens. Sentence case.
- Tests `frontend/tests/unit/*.unit.spec.ts`; suite baseline = 4 known failures (spacetype-palette ×2, video-model-adapt, gradientfx-mesh).
- Collections exports (Slice 1/2a): `~/lib/collection/types` (COLLECTION_PROP, BINDINGS_PROP, VARS_TYPE, VarBindings, CollectionData), `model` (addColumn, addRow, setCell, keyFromLabel, clampPreviewRow), `resolve` (resolveBindings, splitResolvedValues), `preview` (wiredTargets, pushVarPreview), `upload` (addMediaRows — copy-preview-row+override-column+append, generic despite the name), `varsInput` (ensureVarsInput, VARS_TARGET_NODE_TYPES).
- Editor internals (explorer-verified): template read/write `readLayout()`/`writeLayout()` in SmartLayoutEditorModal.vue:36-52; element ops via `useGridEditor` (`patchElement(id, patch)`); canvas token resolution `resolve()` in GridEditorCanvas.vue:101-108 from `initialProps` (modal :282-302); grid math `gridMetrics()`/`fineGridDims()` in shared/template-grid/grid.ts; drag/resize already snap via `dragRegion()`/`resizeRegion()`; element context menus DON'T exist yet; CanvasContextMenu.vue is reusable via Teleport; VueNodeCanvas promote plumbing from 2a (`comfynext:promoteControl` handler ~line 3200) is the model for the new handler.

---

### Task 1: layoutPromote pure lib (TDD)

**Files:** Create `frontend/app/lib/collection/layoutPromote.ts`; Test `frontend/tests/unit/layout-promote.unit.spec.ts`.

**Produces:**
- `nextFreeSocket(template: unknown, kind: 'text' | 'image'): string` — scans the template JSON for `{{ props.text_layer_N }}` / `{{ props.image_layer_N }}` tokens (regex over JSON.stringify like listSmartLayoutBindables) AND element `role` fields (`TEXT_LAYER_N`/`IMAGE_LAYER_N`), returns first free name (`text_layer_1`…).
- `tokenizeElementContent(el: { content?: string }, socketName: string): { priorContent: string }` — pure: returns prior content, caller patches content to `{{ props.<socketName> }}`.
- `columnLabelForElement(el: { name?: string; role?: string; content?: string }, priorContent: string): string` — element name → role (lowercased) → first 24 chars of priorContent slugged via keyFromLabel-style cleanup → socketName fallback. Never empty.
- `isBoundToken(content: string | undefined): string | null` — returns the socket name when content is EXACTLY one `{{ props.x }}` token (whole-match), else null.

**Tests:** socket scanning skips taken names incl. roles; whole-token detection rejects mixed content ("Hi {{ props.x }}" → null); label priority chain; tokenize round-trip.

Commit: `feat(smart-layout): layout promote helpers — socket allocation, tokenize, labels`

---

### Task 2: promoteLayoutElement canvas plumbing

**Files:** Modify `frontend/app/components/vue-canvas/VueNodeCanvas.vue`; Create `frontend/app/lib/collection/layoutBinding.ts` (+ test).

**Produces:**
- `layoutBinding.ts`: `promoteLayoutElement(nodesAccessor, edgesAccessor, layoutNodeId, socketName, columnLabel, currentValue, kind: 'text' | 'image', createCollectionNode: () => any): { columnKey: string } | null` — mirror of useStudioVarBindings' `promoteControl` but: binding path `props.<socketName>`, column type `kind === 'image' ? 'image' : 'text'`, seeds the clamped preview-row cell with currentValue, sets `lastLiteral`. Reuse findWiredCollectionNode logic (import from useStudioVarBindings if exported, else replicate the small finder). TDD like promoteControl's tests (reuse wired collection; create when absent; seed + binding written).
- VueNodeCanvas: `comfynext:promoteLayoutElement` listener (detail `{ nodeId, socketName, columnLabel, currentValue, kind }`), registered/unregistered with siblings; body mirrors the studio promote handler: ensureVarsInput(target) → find-or-create Collection (position offset, seeded COLLECTION_PROP, VARS edge with `data.dataType: VARS_TYPE`, targetHandle from the vars input index) → `promoteLayoutElement(...)` → `pushVarPreview` → `comfynext:openCollection`. Factor the find-or-create-collection block into a shared function used by BOTH handlers if the existing handler's body allows a clean extraction (do it — two copies of node-creation logic is how drift starts).

Commit: `feat(smart-layout): promoteLayoutElement plumbing — shared collection find-or-create`

---

### Task 3: editor context menu, badges, resolved rendering, write-through

**Files:** Modify `frontend/app/components/templates/GridEditorCanvas.vue`, `frontend/app/components/templates/GridPropertyPanel.vue`, `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue`.

**Behavior:**
- **Context menu:** `@contextmenu.prevent` on canvas elements → select element → CanvasContextMenu (Teleport) with, for text/image elements: unbound → `Turn into variable` (uses Task 1 helpers: nextFreeSocket from the CURRENT template, tokenize via `patchElement(id, { content: token })`, then dispatch `comfynext:promoteLayoutElement` with prior content + label + kind; then `writeLayout` flow as any other edit); bound (isBoundToken + binding exists on node) → `Go to collection`, `Unbind` (patchElement content back to the RESOLVED current value; delete `comfynext_varBindings['props.<socket>']` on the node). Shape elements: no variable items.
- **Badges:** bound elements render a small chip (`bg-white/15 rounded-full text-[9px] px-1`) in their top-right corner in the editor canvas (same v-if pattern as existing selection chrome), title = bound column key.
- **Resolved rendering:** SmartLayoutEditorModal's `initialProps` computed merges in binding-resolved values: from props.nodes/edges find the wired collection (VARS edge targeting this node), `resolveBindings(collection, node's BINDINGS_PROP, previewRow)` → `splitResolvedValues().props` → spread OVER upstream socket values. Editor now shows live collection text/images for bound sockets. (Scrub reactivity: the modal re-computes when the collection object mutates — computed reads reactive node properties, verify.)
- **Inspector "Variable" row (text + image elements):** when bound — column key, `Go to collection` link (dispatch openCollection), `Unbind` button. When bound, the TEXT content field edits the CELL (write-through): label flips to "Text (from <column>)" and input value = resolved cell value; on input → `setCell(collection, previewRow row id, columnKey, value)` + `pushVarPreview`. Unbound elements keep today's behavior.

Commit: `feat(smart-layout): in-editor Turn into variable — menu, badges, resolved preview, cell write-through`

---

### Task 4: /api/copy-assist endpoint

**Files:** Create `frontend/server/api/copy-assist.post.ts`, `frontend/server/lib/copyAssist.ts` (+ test `frontend/tests/unit/copy-assist-prompt.unit.spec.ts`); Modify `frontend/server/middleware/comfyui-proxy.ts` (NITRO_API_PATHS + `/api/copy-assist`).

**Contract:** Request `{ apiKey, mode: 'variations' | 'brief' | 'translate', text, brief?, languages?: string[], count?, context?: { brandTone?, otherTexts?: string[] } }`. Response `{ options: { text: string, language?: string }[] }`. Model `claude-haiku-4-5`, structured output JSON schema (vibe.post.ts pattern verbatim: raw fetch, x-api-key, output_config json_schema, error handling with createError). Prompt rules in `copyAssist.ts` `buildCopyAssistPrompt(req)` (PURE, unit-tested): per-mode instructions; ALWAYS: "each option ≈ the original's length (±20%), ad-copy register, no quotes/numbering"; variations: preserve intent/tone, vary hook; brief: use `brief` + optional brandTone/otherTexts for coherence; translate: one option per requested language, marketing-localized not literal, set `language` per option; count default 5 clamp 1-8 (translate: languages array wins).

**Tests:** prompt contains the length rule + mode-specific lines; translate maps languages; count clamps; schema shape.

Commit: `feat(smart-layout): /api/copy-assist — variations, brief copy, translation (haiku)`

---

### Task 5: Copy assistant UI + add-as-rows

**Files:** Modify `frontend/app/components/templates/GridPropertyPanel.vue`; Create `frontend/app/composables/useCopyAssist.ts`.

**Behavior:**
- Text-element inspector gains a **Copy assistant** section styled with the app's `gen-pastel` AI affordance (find the existing pastel class/gradient used by AI chips — grep `gen-pastel` — and match): three compact mode buttons (`Variations`, `Write from brief…`, `Translate…`). Brief mode reveals a small textarea; translate reveals language checkboxes (EN/FR/DE/ES/IT/PT/NL/JA) + free-text input.
- `useCopyAssist()` composable: `run(mode, payload)` → reads the key via the same `getLocalSetting('ComfyNext.AI.AnthropicApiKey')` pattern as useVibeControl (grep exact helper) → POST /api/copy-assist → `options` ref + `loading` + `error` (no key → inline "Add your Anthropic key in settings" message).
- Results list: each option row → click applies (`patchElement(id, { content })` for unbound; `setCell` write-through for bound). Footer actions: **`Add all as rows`** when bound (addMediaRows(collection, boundColumnKey, options.map(o => o.text)) → pushVarPreview → openCollection dispatch); when unbound: **`Make variable + add as rows`** (runs the Task 3 promote flow, waits a tick for the binding, then adds rows). Translate options show their language tag.
- Respect `running` state? (drawer batch) — rows-append goes through the same guards pattern: check the collection isn't mid-batch by reading the drawer? Not reachable from here — acceptable; addMediaRows is a plain model call; note in report.

Commit: `feat(smart-layout): copy assistant — variations/brief/translate with add-as-rows`

---

### Task 6: fine grid overlay + toggles

**Files:** Modify `frontend/app/components/templates/GridEditorCanvas.vue`, `frontend/app/components/templates/GridEditorShell.vue` (toolbar).

**Behavior:**
- New overlay layer (absolutely-positioned div/svg above the page background, below elements, pointer-events none) drawing the FINE lattice from `gridMetrics()` (v3: baseline cells; v2: its cols/rows): vertical + horizontal hairlines `rgba(255,255,255,0.06)` with every 4th line at `0.12` (rhythm without noise). Recompute on format/metrics change. CSS-size aware (scale factor from metrics).
- The existing coarse column/section guides become the second layer ("Columns" toggle), unchanged visually.
- Toolbar toggles: `Grid` (fine, DEFAULT ON) and `Columns` (existing guides, keep current default); persisted via the same local-setting helper the app uses (`getLocalSetting`/`setLocalSetting` — grep exact names) under `ComfyNext.SmartLayout.FineGrid` / `.ColumnGuides`.
- Verify (and note in report) that v3 drag/resize snapping already lands on fine cells via `dragRegion()`; if snapping is coarser than a fine cell in v3, fix the snap to fine granularity.

Commit: `feat(smart-layout): always-on fine placement grid + layered column guides`

---

### Task 7: browser verification (controller)

- Full unit suite baseline; then in-app: open Smart Layout editor → right-click a text element → Turn into variable (collection auto-created, badge appears, editor still renders the same text) → edit text in inspector (cell write-through) → Copy assistant: variations on the bound element → Add all as rows → drawer shows rows → scrub → editor text follows → translate to 3 languages → rows → Generate batch → localized results. Fine grid visible; toggles persist. Screenshots throughout.

## Self-Review Notes

- Task ordering: 1→2→3 build the promote path bottom-up; 4→5 the assistant; 6 independent (can slot anywhere); 7 gates.
- The one cross-feature contract: `props.<socketName>` binding paths — identical to what the drawer's listSmartLayoutBindables already produces, so the drawer strip, autoAlign, and batch renderItem all work with promoted elements with ZERO changes.
- Deliberate scope cuts per design doc §6 (no auto-fit, no campaign mode, no image AI, no grid-metric changes).
