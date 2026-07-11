# Shot Director — Phase 2: Studio Surface — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the unit-tested tasks; the VISUAL tasks (marked 🖼️) are built inline with dev-server verification and require a screenshot-based look sign-off from the user before they count as done (project rule: never ship visual work on unit tests alone). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A working, on-canvas **Shot Director studio surface** — a structured editor that binds a `ShotSheet` (Phase 1) to a live-compiled Seedance prompt + input preview, persists to the node, and lets the user **copy the compiled prompt/input** to use with the existing Generate-a-video node. No backend dispatch yet (that's Phase 3).

**Architecture:** Follows the existing frontend-only studio pattern (Shader/Texture Studio): a canvas **node card** (`ShotDirectorNode.vue`) with an Edit button that opens a **full-screen editor surface** (`ShotDirectorSurface.vue`) via a `window` CustomEvent + a Teleport in `VueNodeCanvas.vue`. State lives at `node.data.properties.sailor_shotDirector` as a `ShotSheet`. A `useShotDirector` composable owns the reactive sheet, persistence, mutation helpers, and the live `compileShot` result. The surface is references-first (Phase 1 research), always shows the compiled prompt + word-budget meter, and never dispatches — it produces a copy-able artifact.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, Tailwind, Vue Flow canvas, Vitest (logic units), Nuxt dev server + browser preview (visual).

## Global Constraints

- **Reuse the Phase 1 core verbatim** — the surface must never re-implement prompt assembly or validation; it calls `compileShot(sheet, getProfile('seedance-2.0'))` from `frontend/app/lib/shotdirector/compile.ts` and renders `result.prompt`, `result.wordCount`, `result.issues`, `result.input`.
- **References-first layout** — the reference-role rail is the primary/most-prominent editing region, not a side panel (Seedance is reference-dominant).
- **One camera move** — the camera control is a single-select of the 8 canonical moves; never allow multiple.
- **No photography jargon in the UI** — no fps/lens/ISO controls. Pacing is the four words `slow | smooth | gradual | gentle`.
- **Live word-budget meter** — green ≤ 100 words, amber > 100, red at the > 600 hard cap (mirrors `word-budget-warning` / `word-budget-exceeded` issue codes). Always visible.
- **No purple/violet accents** — neutral white-opacity + type-color; emerald reserved for run/confirm actions (project rule).
- **Persistence** — every edit writes through to `node.data.properties.sailor_shotDirector`; reopening the surface restores exactly.
- **Studio config-node semantics** — `ShotDirector` is frontend-only (no `/object_info`); its `bakeOutput()` returns `null`. Register it exactly like Texture Studio in `ARTIFACT_NODE_COMPONENTS`, `VueNodeCanvas` node-types, `createNodeData` output-synthesis, `cascade.ts` STUDIO node set, and `capabilities.ts` STUDIOS.
- **Seedance option sets in the format bar** — durations `[3,5,10,15]` (+ an "Auto (-1)" choice), resolutions `['720p','1080p']`, aspect ratios `['16:9','9:16','1:1','4:3','3:4','21:9','adaptive']`.

---

## File Structure

- `frontend/app/lib/shotdirector/hydrate.ts` — `hydrateShotSheet(raw): ShotSheet` (defensive deep-merge over `createDefaultShotSheet()`), plus small mutation helpers that are worth unit-testing in isolation (`addRef`, `removeRef`, `nextSlot`).
- `frontend/app/composables/useShotDirector.ts` — reactive sheet ↔ node persistence + live compile + mutation methods. Thin Vue wiring over `hydrate.ts` + `compile.ts`.
- `frontend/app/components/vue-canvas/ShotDirectorNode.vue` 🖼️ — canvas card (summary + Edit button + `bakeOutput`/baker registration).
- `frontend/app/components/vue-canvas/ShotDirectorSurface.vue` 🖼️ — full editor modal (StudioModalShell): reference rail, shot fields, camera control, format bar, beat board, compiled-prompt preview + word meter + issues + Copy actions.
- `frontend/app/pages/dev/shot-director-harness.vue` 🖼️ — isolated preview route.
- Wiring edits (mechanical): `frontend/app/composables/useVueNodes.ts`, `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, `frontend/app/lib/studio/cascade.ts`, `frontend/app/lib/agent/capabilities.ts`.
- Tests: `frontend/tests/unit/shotdirector-hydrate.unit.spec.ts`, `frontend/tests/unit/shotdirector-registration.unit.spec.ts`.

Test command (from `frontend/`): `npm run test:unit -- <path>`. Dev server: `npm run dev` → preview at `http://127.0.0.1:3000/...` (use `127.0.0.1`, not `localhost`).

---

### Task 1: `hydrateShotSheet` + reference helpers (`hydrate.ts`) — unit-tested

**Files:**
- Create: `frontend/app/lib/shotdirector/hydrate.ts`
- Test: `frontend/tests/unit/shotdirector-hydrate.unit.spec.ts`

**Interfaces:**
- Consumes: `createDefaultShotSheet`, `ShotSheet`, `Ref`, `RefKind` from `./types`.
- Produces:
  - `hydrateShotSheet(raw: unknown): ShotSheet` — returns a complete sheet: defaults for missing fields, carried-over values for present ones, arrays defaulting to `[]`, nested `camera`/`audio`/`format` merged field-by-field. Never returns `undefined` fields the compiler reads.
  - `nextSlot(refs: Ref[], kind: RefKind): number` — smallest unused 1-based slot for that kind.
  - `addRef(sheet: ShotSheet, kind: RefKind, src: string, role: Ref['role']): ShotSheet` — returns a new sheet with the ref appended at `nextSlot`.
  - `removeRef(sheet: ShotSheet, kind: RefKind, slot: number): ShotSheet` — returns a new sheet without that ref (other slots unchanged — no renumbering).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet } from '../../app/lib/shotdirector/types'
import { hydrateShotSheet, nextSlot, addRef, removeRef } from '../../app/lib/shotdirector/hydrate'

describe('hydrateShotSheet', () => {
  it('returns full defaults for empty/garbage input', () => {
    expect(hydrateShotSheet(undefined)).toEqual(createDefaultShotSheet())
    expect(hydrateShotSheet(null)).toEqual(createDefaultShotSheet())
    expect(hydrateShotSheet(42)).toEqual(createDefaultShotSheet())
  })

  it('carries over provided scalar + nested fields and defaults the rest', () => {
    const s = hydrateShotSheet({ subject: 'a cat', camera: { move: 'pan' }, format: { durationS: 10 } })
    expect(s.subject).toBe('a cat')
    expect(s.camera.move).toBe('pan')
    expect(s.camera.shotType).toBe('medium')   // default preserved
    expect(s.format.durationS).toBe(10)
    expect(s.format.resolution).toBe('1080p')   // default preserved
    expect(s.references).toEqual([])
    expect(s.beats).toEqual([])
  })

  it('defaults array fields when they are the wrong type', () => {
    const s = hydrateShotSheet({ references: 'nope', beats: null, constraints: undefined })
    expect(s.references).toEqual([])
    expect(s.beats).toEqual([])
    expect(s.constraints).toEqual([])
  })
})

describe('reference helpers', () => {
  it('nextSlot returns the smallest unused 1-based slot per kind', () => {
    const refs = [
      { kind: 'image', slot: 1, src: 'a', role: 'identity-lock' },
      { kind: 'image', slot: 3, src: 'b', role: 'style-transfer' },
      { kind: 'video', slot: 1, src: 'c', role: 'camera-copy' },
    ] as const
    expect(nextSlot([...refs], 'image')).toBe(2)
    expect(nextSlot([...refs], 'video')).toBe(2)
    expect(nextSlot([], 'audio')).toBe(1)
  })

  it('addRef appends at nextSlot without mutating the input', () => {
    const s0 = createDefaultShotSheet()
    const s1 = addRef(s0, 'image', 'data:x', 'identity-lock')
    expect(s0.references).toEqual([])            // input untouched
    expect(s1.references).toEqual([{ kind: 'image', slot: 1, src: 'data:x', role: 'identity-lock' }])
  })

  it('removeRef drops the matching ref and leaves other slots unrenumbered', () => {
    let s = createDefaultShotSheet()
    s = addRef(s, 'image', 'a', 'identity-lock')   // slot 1
    s = addRef(s, 'image', 'b', 'style-transfer')  // slot 2
    const s2 = removeRef(s, 'image', 1)
    expect(s2.references).toEqual([{ kind: 'image', slot: 2, src: 'b', role: 'style-transfer' }])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- tests/unit/shotdirector-hydrate.unit.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `hydrate.ts`**

```ts
// frontend/app/lib/shotdirector/hydrate.ts
// Defensive hydration of a persisted ShotSheet (node.data.properties.sailor_shotDirector)
// and pure reference-list helpers. Mirrors the shaderstudio hydrateConfig pattern.

import { createDefaultShotSheet, type Ref, type RefKind, type ShotSheet } from './types'

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}

export function hydrateShotSheet(raw: unknown): ShotSheet {
  const d = createDefaultShotSheet()
  const r = obj(raw)
  const cam = obj(r.camera), aud = obj(r.audio), fmt = obj(r.format)
  return {
    intent: str(r.intent, d.intent),
    mode: r.mode === 'firstLastFrame' ? 'firstLastFrame' : 'reference',
    subject: str(r.subject, d.subject),
    action: str(r.action, d.action),
    environment: str(r.environment, d.environment),
    lighting: str(r.lighting, d.lighting),
    style: str(r.style, d.style),
    camera: {
      shotType: str(cam.shotType, d.camera.shotType) as ShotSheet['camera']['shotType'],
      move: str(cam.move, d.camera.move) as ShotSheet['camera']['move'],
      pacing: str(cam.pacing, d.camera.pacing) as ShotSheet['camera']['pacing'],
    },
    constraints: arr<string>(r.constraints),
    references: arr<Ref>(r.references),
    firstFrame: typeof r.firstFrame === 'string' ? r.firstFrame : undefined,
    lastFrame: typeof r.lastFrame === 'string' ? r.lastFrame : undefined,
    beats: arr(r.beats),
    audio: {
      generate: typeof aud.generate === 'boolean' ? aud.generate : d.audio.generate,
      dialogue: Array.isArray(aud.dialogue) ? aud.dialogue as ShotSheet['audio']['dialogue'] : undefined,
      sfxNote: typeof aud.sfxNote === 'string' ? aud.sfxNote : undefined,
    },
    format: {
      aspectRatio: str(fmt.aspectRatio, d.format.aspectRatio),
      durationS: typeof fmt.durationS === 'number' ? fmt.durationS : d.format.durationS,
      resolution: str(fmt.resolution, d.format.resolution),
      seed: typeof fmt.seed === 'number' ? fmt.seed : undefined,
    },
  }
}

export function nextSlot(refs: Ref[], kind: RefKind): number {
  const used = new Set(refs.filter(r => r.kind === kind).map(r => r.slot))
  let s = 1
  while (used.has(s)) s++
  return s
}

export function addRef(sheet: ShotSheet, kind: RefKind, src: string, role: Ref['role']): ShotSheet {
  const slot = nextSlot(sheet.references, kind)
  return { ...sheet, references: [...sheet.references, { kind, slot, src, role }] }
}

export function removeRef(sheet: ShotSheet, kind: RefKind, slot: number): ShotSheet {
  return { ...sheet, references: sheet.references.filter(r => !(r.kind === kind && r.slot === slot)) }
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS (7 tests).
- [ ] **Step 5: Commit** — `git add frontend/app/lib/shotdirector/hydrate.ts frontend/tests/unit/shotdirector-hydrate.unit.spec.ts && git commit -m "feat(shot-director): ShotSheet hydration + reference helpers"`

---

### Task 2: `useShotDirector` composable — logic-tested

**Files:**
- Create: `frontend/app/composables/useShotDirector.ts`
- Test: `frontend/tests/unit/shotdirector-composable.unit.spec.ts`

**Interfaces:**
- Consumes: `hydrateShotSheet`, `addRef`, `removeRef` from `~/lib/shotdirector/hydrate`; `compileShot` from `~/lib/shotdirector/compile`; `getProfile` from `~/lib/shotdirector/profiles`; Vue `ref`/`computed`/`watch`.
- Produces:
  - `useShotDirector(initial: unknown, persist: (sheet: ShotSheet) => void)` returning `{ sheet: Ref<ShotSheet>, result: ComputedRef<CompileResult>, profile, update(mutator: (s: ShotSheet) => ShotSheet): void, addReference(kind, src, role): void, removeReference(kind, slot): void }`.
  - `update` replaces `sheet.value` with `mutator(sheet.value)` and calls `persist(sheet.value)`; the composable also `watch`es `sheet` deep and persists.

Notes for the implementer: keep it thin. `initial` is `node.data.properties.sailor_shotDirector`. `persist` is a callback the surface supplies that writes back to the node. The profile is fixed to `getProfile('seedance-2.0')` for Phase 2. `result` is `computed(() => compileShot(sheet.value, profile))`. Unit test can import the composable directly (it only needs `vue`, which the repo's Vitest environment already provides — see existing composable tests) and assert that `addReference` grows `result.value.input.reference_images` and that `persist` is called. If the repo has no precedent for unit-testing a composable outside a component, implement the testable parts as plain functions in `hydrate.ts`/here and note it; do not add heavy test scaffolding.

- [ ] **Step 1–5:** Follow TDD: test that `addReference('image', 'x', 'identity-lock')` makes `result.value.prompt` contain `[Image1]` and `result.value.input.reference_images` equal `['x']`, and that `persist` was invoked; test that `update` toggling `mode` to `'firstLastFrame'` clears the reference tags from `result.value.prompt`. Implement the composable. Commit: `git commit -m "feat(shot-director): useShotDirector reactive composable"`.

---

### Task 3: Registration wiring — mechanical + smoke-tested

**Files (all Modify):**
- `frontend/app/composables/useVueNodes.ts` — add `ShotDirector: 'shot-director'` to `ARTIFACT_NODE_COMPONENTS`.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — (a) import `ShotDirectorNode`; (b) add `'shot-director': markRaw(ShotDirectorNode)` to the node-types object; (c) add `'ShotDirector'` to the `createNodeData` output-synthesis condition (~line 1371); (d) add the open-handler state + `window` listener for `'sailor:openShotDirector'` mirroring `shaderStudioOpenForId`; (e) add the `<Teleport to="body">` block rendering `ShotDirectorSurface` when open.
- `frontend/app/lib/studio/cascade.ts` — add `'ShotDirector'` to the STUDIO node-type set used by `planStudioCascade` (so its baker is recognized).
- `frontend/app/lib/agent/capabilities.ts` — add the `ShotDirector` entry to `STUDIOS` (frontendOnly, title "Shot Director", optional `reference` IMAGE input, wildcard output, intents incl. "seedance", "direct a video", "shot director").
- Test: `frontend/tests/unit/shotdirector-registration.unit.spec.ts`

**Interfaces:**
- Consumes: `getVueFlowType` from `~/composables/useVueNodes`; the `STUDIOS`/capability lookup from `~/lib/agent/capabilities`.
- Produces: `ShotDirector` is a registered, addable studio node type.

- [ ] **Step 1: Write the failing test** (the mechanical, assertable part):

```ts
import { describe, it, expect } from 'vitest'
import { getVueFlowType, ARTIFACT_NODE_COMPONENTS } from '../../app/composables/useVueNodes'

describe('ShotDirector registration', () => {
  it('maps the ShotDirector node type to the shot-director vue-flow component', () => {
    expect(ARTIFACT_NODE_COMPONENTS.ShotDirector).toBe('shot-director')
    expect(getVueFlowType('ShotDirector')).toBe('shot-director')
  })
})
```

- [ ] **Step 2: Run → FAIL** (`ShotDirector` not yet in the map).
- [ ] **Step 3: Apply the wiring edits** listed above. For the `VueNodeCanvas.vue` open-handler + Teleport, copy the exact `shaderStudioOpenForId` pattern (state ref, `addEventListener('sailor:openShotDirector', ...)` in the mount hook + matching `removeEventListener` in cleanup, and the `<Teleport to="body"><VueCanvasShotDirectorSurface v-if="shotDirectorOpenForId" :node-id="shotDirectorOpenForId" :nodes="nodes as any[]" @close="shotDirectorOpenForId = null" /></Teleport>`). The Surface component is created in Task 5 — until then, import it and accept that the canvas won't compile the Teleport branch at runtime unless the file exists; create an empty stub `ShotDirectorSurface.vue` (root `<div/>`) first so the import resolves, then flesh it out in Task 5.
- [ ] **Step 4: Run → PASS.** Also run the whole shot-director suite to confirm no regressions.
- [ ] **Step 5: Commit** — stage the five wiring files + the test: `git commit -m "feat(shot-director): register ShotDirector studio node type"`.

---

### Task 4 🖼️: `ShotDirectorNode.vue` card — visual

**Files:** Create `frontend/app/components/vue-canvas/ShotDirectorNode.vue`

Mirror `TextureStudioNode.vue`:
- Props `{ id: string; data: { nodeType; title?; properties?; studioBusy? } }`.
- `const config = computed(() => hydrateShotSheet(props.data?.properties?.sailor_shotDirector))`.
- Card body: title "Shot Director", a compact summary — model chip ("Seedance 2.0"), the subject line (or "Untitled shot"), reference-count chips (e.g. "3 img · 1 vid"), and the live word count from `compileShot(config, getProfile('seedance-2.0')).wordCount` with the green/amber/red dot. Keep it small (the card is ~220px).
- `onMounted(() => registerStudioBaker(props.id, bakeOutput))`, `onBeforeUnmount(() => unregisterStudioBaker(props.id))`, with `async function bakeOutput() { return null }`.
- Edit button → `window.dispatchEvent(new CustomEvent('sailor:openShotDirector', { detail: { nodeId: props.id } }))`.
- Respect the no-purple rule; emerald only if you add a run affordance (none in Phase 2).

**Acceptance (visual):** node renders on the canvas, summary reflects persisted config, Edit opens the surface. Verified via the harness/canvas in Task 6.

- [ ] Build the component. (No unit test — visual gate in Task 6.) Commit: `git commit -m "feat(shot-director): canvas node card"`.

---

### Task 5 🖼️: `ShotDirectorSurface.vue` — the editor (visual, the core of Phase 2)

**Files:** Create/replace `frontend/app/components/vue-canvas/ShotDirectorSurface.vue`

Props `{ nodeId: string; nodes: any[] }`, emit `close`. On setup: find the node in `nodes`, build `const { sheet, result, addReference, removeReference, update } = useShotDirector(node?.data?.properties?.sailor_shotDirector, persist)` where `persist(s)` writes `node.data.properties.sailor_shotDirector = s`.

Wrap in `StudioModalShell` (title "Shot Director", esc/close → emit `close`). Two-column layout:

**Left column — the editing surface (references-first):**
1. **Reference rail (primary, top, most prominent):** a mode toggle (Reference ⇄ First/Last frame). In Reference mode: three groups (Images ≤9, Videos ≤3, Audio ≤3). Each slot shows a thumbnail/file chip, a **role dropdown** (options from `ROLES_BY_KIND[kind]`, labels humanized), and a remove button; an "Add" control per group (accepts a data URL — a file input reading to base64 for images/video/audio; for Phase 2, a URL/file picker is fine). In First/Last-frame mode: two image slots (first, last).
2. **Shot fields:** text inputs for Subject, Action, Environment; a prominent **Lighting** field with preset chips (golden hour, rim light, backlit, neon, soft daylight); Style field. Camera control: shot-type select + **single-select** camera-move (the 8 moves) + pacing select. Constraints: a chip editor (add/remove tokens like "jitter", "bent limbs").
3. **Beat board (optional, collapsible):** "Add beat" (disabled when `format.durationS === -1`, cap 3); each beat = start/end (numeric, within duration), action, optional shot-type/move/pacing overrides. Keep simple (no drag in Phase 2 — ordering by start time is fine; drag is a later polish).
4. **Format bar:** aspect ratio, duration (incl. "Auto"), resolution selects; audio "Generate audio" toggle + dialogue lines editor (speaker optional + line); seed (optional number).

**Right column — the always-visible compiled preview:**
- The compiled `result.prompt` in a readonly, monospace block.
- A **word-budget meter**: `result.wordCount` with green ≤100 / amber >100 / red if a `word-budget-exceeded` issue is present.
- The `result.issues` list (errors red, warnings amber) with their messages.
- **Copy actions:** "Copy prompt" (copies `result.prompt`) and "Copy input JSON" (copies `JSON.stringify(result.input, null, 2)`) — this is Phase 2's output path (paste into the existing Generate-a-video node). A disabled "Render (Phase 3)" placeholder is NOT added — omit it to avoid dead UI.

All edits go through `update`/`addReference`/`removeReference` so persistence + live recompile happen automatically.

**Acceptance (visual):** editing any field updates the compiled prompt live; the word meter changes color past 100; switching to First/Last-frame mode drops `[ImageN]` tags; invalid states (audio ref with no visual ref; 4th beat blocked; beat past duration) surface as issues; Copy actions place the right text on the clipboard; closing + reopening restores state.

- [ ] Build the surface against the composable. Commit: `git commit -m "feat(shot-director): editor surface (references-first, live compiled preview)"`.

---

### Task 6 🖼️: Dev harness + visual verification + look sign-off

**Files:** Create `frontend/app/pages/dev/shot-director-harness.vue` (`definePageMeta({ layout: false })`) mounting `ShotDirectorSurface` with a mock node (id + `data.properties.sailor_shotDirector = {}`) and a mock `nodes` array, per the studio-map harness pattern.

- [ ] Start the dev server (`npm run dev`), open `http://127.0.0.1:3000/dev/shot-director-harness`.
- [ ] Verify the acceptance criteria from Tasks 4–5 in the browser: live recompile, word meter colors, mode switch dropping tags, issues surfacing, Copy actions, persistence round-trip (also test on a real canvas node: add a "Shot Director" node, edit, reload).
- [ ] Capture screenshots (default state, a filled-in shot with references, an over-budget/invalid state) and **present them to the user for look sign-off.** Do not mark Phase 2 done until the user approves the look. Record any restyle requests as a follow-up polish pass (a later slice, consistent with the project's separate "UI restyle" passes).
- [ ] Commit the harness: `git commit -m "chore(shot-director): dev harness page for the editor surface"`.

---

## Self-Review

**1. Spec coverage (Phase 2 surface scope):** references-first rail (Task 5.1) ✓; shot fields + single camera move + lighting-forward (5.2) ✓; bounded beat board (5.3) ✓; format bar with real Seedance sets (5.4) ✓; always-visible compiled prompt + word meter + issues (5, right column) ✓; persistence (Tasks 2,5) ✓; node card + registration + addable node (Tasks 3,4) ✓; live compile reuse of Phase 1 (Task 2) ✓. Backend dispatch + AI accelerators (seed-from-intent, director bar) are **out of scope** — Phase 3. Copy-to-clipboard is the Phase 2 output bridge. ✓

**2. Placeholder scan:** logic tasks (1–3) carry complete code + assertions; visual tasks (4–6) carry explicit acceptance criteria and a hard look-sign-off gate rather than fake unit tests — deliberate, per the project's visual-verification rule.

**3. Type consistency:** `hydrateShotSheet`, `addRef`/`removeRef`/`nextSlot`, `useShotDirector` return shape, and `compileShot`/`getProfile`/`ROLES_BY_KIND` usages match the Phase 1 exports. The composable's `persist` callback + `update` mutator names are used identically in Tasks 2 and 5.

## Dependency note for Phase 3

The eventual one-click **Render** needs a backend path: extend `_b_seedance_2_0` (`comfy_api_nodes/video_models.py`) for `reference_images/videos/audios` + `last_frame_image` + `generate_audio` and drop `camera_fixed`/`fps`, then either add a companion `ShotDirector` Python node that reads the compiled input, or route `result.input` through the existing video-run plumbing. Phase 2 deliberately stops at the copy-able compiled artifact so it ships value without that backend work.
