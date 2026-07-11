# Character Unification + Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One character system — LoRA-canonical with draft states, per-character look variants with generated reference sheets, dual dispatch (image gen + video cast) from a pure-library panel, style removed from the panel.

**Architecture:** The registry record grows `variants: CharacterVariant[]` (legacy `refImages` migrates to a Default variant at parse time). Status is derived: draft (no `loraName`) / training (matching training-queue job) / ready. The panel collapses to one list; trained-LoRA characters absorb into the registry idempotently on load, and absorbed empties auto-render their Default sheet through their own LoRA (sanctioned one-time spend). Sheet generation extracts from CharacterSheetNode into a shared `useSheetGeneration` composable that takes an optional variant descriptor. Cast plumbing carries `variantId` end-to-end (picker → chips → CharacterNode → edge-sync → resolution); everything below `materializeCast` is untouched.

**Tech Stack:** Vue 3 / Nuxt 4 / TypeScript, Vitest; Nitro server routes. **No ComfyUI Python changes** (FluxLoRARemoteNode and ConsistentFaceNode are consumed as-is).

## Global Constraints

- Work directly on `main`; NO branches. Stage files with explicit paths only; NEVER `git add -A` (user has parallel WIP).
- Frontend tests: `cd frontend && npx vitest run <files>`; known unrelated failures: spacetype-palette ×2, gradientfx-mesh ×1. Typecheck: `cd frontend && npx nuxi typecheck 2>&1 | grep -c "error TS"` ≤ 396.
- No violet/purple; emerald = run/generate actions; amber = warnings/character accent; `text-[11px]`/`text-[10px]` white-opacity idioms; no `border-left` accent stripes; no gradient text.
- Money: every generation behind an explicit `~$` button — EXCEPT the sanctioned merge auto-gen (spec §Unification): fires only when a just-absorbed ready character's Default variant has zero refs, once, with banner + per-character retry, never a loop. **Verification must not click paid buttons; the absorb auto-gen MAY fire once against the user's 4 real LoRA characters (~$0.48 total, explicitly accepted).**
- Variant sheet prices: LoRA render `~$0.12` (4 × ~$0.03), ideogram (draft) `~$0.32` (4 × $0.08).
- Event naming `sailor:<name>`; mutating registry paths dispatch `sailor:charactersChanged`.
- Node ids ONLY via `mintNodeId()` in VueNodeCanvas (never bare `Date.now()`).
- Ref URLs: `viewRefUrl(name)` = `/view?filename=<enc>&type=input`; ref files live in the ComfyUI input dir; `validRefFilename` guards all filename writes.
- The dev canvas iframe handshake is currently flaky in this environment — UI verification uses `/dev/shot-director-harness`, the panel mounted in the app shell, and curl; skip canvas-iframe-dependent smokes with a note rather than fighting boot loops.

---

### Task 1: Registry model — `CharacterVariant`, parse-time migration, variant healing

**Files:**
- Modify: `frontend/server/utils/characterRegistry.ts`
- Test: `frontend/tests/unit/character-registry.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `validRefFilename`.
- Produces (Tasks 2/3 rely on exact names):
  - `interface CharacterVariant { id: string; label: string; descriptor: string; refImages: string[]; coverIndex: number }`
  - `CharacterRecord` REPLACES top-level `refImages`/`coverIndex` with `variants: CharacterVariant[]` (other fields unchanged).
  - `parseCharacterRecord(raw, slug)`: legacy records (top-level `refImages`) hydrate to `variants: [{ id: 'default', label: 'Default', descriptor: '', refImages, coverIndex }]`; records with neither get one empty Default variant. Variant hygiene: drop invalid ref filenames per variant, clamp coverIndex, drop variants with non-string id/label, ALWAYS ensure a `default` variant exists (index 0).
  - `healRefImages(record, exists)` heals across ALL variants (dropped = total across variants).
  - `defaultVariant(record: CharacterRecord): CharacterVariant` helper (the `id === 'default'` entry, else `variants[0]`).

- [ ] **Step 1: Write the failing tests** (append to the existing spec file; update the existing `rec()` helper and any test touching `refImages` to the variant shape)

```typescript
const V = (over: Partial<CharacterVariant> = {}): CharacterVariant => ({
  id: 'default', label: 'Default', descriptor: '', refImages: ['a.png'], coverIndex: 0, ...over,
})

describe('variant migration', () => {
  it('legacy top-level refImages hydrate into a Default variant', () => {
    const raw = JSON.stringify({ name: 'X', refImages: ['a.png', 'b.png'], coverIndex: 1 })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants).toEqual([{ id: 'default', label: 'Default', descriptor: '', refImages: ['a.png', 'b.png'], coverIndex: 1 }])
    expect(r).not.toHaveProperty('refImages')
  })
  it('records with neither shape get one empty Default variant', () => {
    expect(parseCharacterRecord('{"name":"X"}', 'x')!.variants).toEqual([
      { id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 },
    ])
  })
  it('variant refs are hygiene-filtered and coverIndex clamped per variant', () => {
    const raw = JSON.stringify({ name: 'X', variants: [
      { id: 'default', label: 'Default', descriptor: '', refImages: ['ok.png', '../evil.png'], coverIndex: 5 },
      { id: 'v1', label: 'Raincoat', descriptor: 'yellow raincoat', refImages: ['r.png'], coverIndex: 0 },
    ] })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants[0]!.refImages).toEqual(['ok.png'])
    expect(r.variants[0]!.coverIndex).toBe(0)
    expect(r.variants[1]!.label).toBe('Raincoat')
  })
  it('a default variant is always present and first', () => {
    const raw = JSON.stringify({ name: 'X', variants: [{ id: 'v1', label: 'B', descriptor: '', refImages: [], coverIndex: 0 }] })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants[0]!.id).toBe('default')
    expect(r.variants).toHaveLength(2)
  })
})

describe('healRefImages across variants', () => {
  it('drops vanished refs in every variant and reports the total', () => {
    const record = parseCharacterRecord(JSON.stringify({ name: 'X', variants: [
      V({ refImages: ['a.png', 'b.png'], coverIndex: 1 }),
      V({ id: 'v1', label: 'Alt', refImages: ['c.png'] }),
    ] }), 'x')!
    const { record: healed, dropped } = healRefImages(record, f => f === 'b.png')
    expect(healed.variants[0]!.refImages).toEqual(['b.png'])
    expect(healed.variants[0]!.coverIndex).toBe(0)
    expect(healed.variants[1]!.refImages).toEqual([])
    expect(dropped).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run tests/unit/character-registry.unit.spec.ts` → FAIL (no `variants`).

- [ ] **Step 3: Implement** — in `characterRegistry.ts`:

```typescript
export interface CharacterVariant {
  id: string
  label: string
  /** Look descriptor folded into sheet-generation prompts ("short bob, yellow raincoat"). */
  descriptor: string
  refImages: string[]
  coverIndex: number
}
```

`CharacterRecord`: remove `refImages`/`coverIndex`, add `variants: CharacterVariant[]`. In `parseCharacterRecord`:

```typescript
  const hygiene = (v: Record<string, unknown>): CharacterVariant | null => {
    if (typeof v.id !== 'string' || !v.id || typeof v.label !== 'string' || !v.label) return null
    const refImages = (Array.isArray(v.refImages) ? v.refImages : [])
      .filter((f): f is string => validRefFilename(f as string))
    const cover = typeof v.coverIndex === 'number' ? v.coverIndex : 0
    return {
      id: v.id, label: v.label,
      descriptor: typeof v.descriptor === 'string' ? v.descriptor : '',
      refImages,
      coverIndex: Math.min(Math.max(0, cover), Math.max(0, refImages.length - 1)),
    }
  }
  let variants = (Array.isArray(r.variants) ? r.variants : [])
    .map(v => hygiene(v as Record<string, unknown>))
    .filter((v): v is CharacterVariant => !!v)
  if (!variants.length && Array.isArray(r.refImages)) {
    // Legacy single-sheet record → Default variant (migration is parse-time;
    // the next write persists the new shape).
    const legacy = hygiene({ id: 'default', label: 'Default', descriptor: '', refImages: r.refImages, coverIndex: r.coverIndex ?? 0 })
    if (legacy) variants = [legacy]
  }
  if (!variants.some(v => v.id === 'default')) {
    variants.unshift({ id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 })
  } else {
    variants = [...variants.filter(v => v.id === 'default'), ...variants.filter(v => v.id !== 'default')]
  }
```

`healRefImages`: map variants, filter each `refImages` by `exists`, clamp each coverIndex, sum dropped, fast-path when total dropped is 0. Add `export function defaultVariant(record: CharacterRecord): CharacterVariant { return record.variants.find(v => v.id === 'default') ?? record.variants[0]! }`.

- [ ] **Step 4: Run to verify pass** — same command; ALL tests in the file pass (including updated legacy ones).
- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/characterRegistry.ts frontend/tests/unit/character-registry.unit.spec.ts
git commit -m "feat(characters): variant data model — parse-time migration of legacy sheets to a Default variant"
```

---

### Task 2: Registry API — variant CRUD, legacy alias, absorb endpoint

**Files:**
- Modify: `frontend/server/api/characters-local.get.ts` (heal path unchanged apart from Task 1 types)
- Modify: `frontend/server/api/characters-local.patch.ts`
- Create: `frontend/server/api/characters-local/absorb.post.ts`

**Interfaces:**
- Consumes: Task 1 (`CharacterVariant`, `defaultVariant`); loras-local dir conventions (`path.resolve(process.cwd(), '..', 'models', 'loras')`, sidecar `<base>.json` with `kind`/`trigger` — parse via `parseSidecar` from `~~/server/utils/loraPrompt`).
- Produces:
  - PATCH body grows: `{ slug, …existing…, variants?: CharacterVariant[] }` — full-array replace, each variant validated (`validRefFilename` on every ref, non-empty id/label, exactly one `default` preserved; 400 otherwise). **Legacy alias kept:** `refImages?`/`coverIndex?` at top level write through to the Default variant (existing callers — save-as-character, CharacterSheetNode, panel uploads — keep working until updated).
  - `POST /api/characters-local/absorb` (no body) → scans `models/loras/*.json` for `kind === 'character'`, creates a registry record for each with no existing record (matched by `loraName === <weights filename>` OR same slugified name): `{ name: sidecar name or filename stem, loraName: <weights filename>, trigger: sidecar trigger, variants: [empty Default] }`. Idempotent. Returns `{ created: string[], existing: string[] }`.
- Note: the loras dir lists sidecars as `<base>.json` next to `<base>.safetensors`; mirror `loras-local.get.ts`'s filename derivation. If no weights file exists for a sidecar, skip it.

- [ ] **Step 1: Implement PATCH variant support + legacy alias** (validation exactly as stated; on `variants` replace, run each through the same hygiene as Task 1's parse — reuse `parseCharacterRecord` by round-tripping the candidate record and 400 if a variant was dropped by hygiene).
- [ ] **Step 2: Implement absorb.post.ts** (shape above; `slugifyCharacterName` for new slugs; collision with an existing record of the same slug but different loraName → treat as existing, do not overwrite).
- [ ] **Step 3: Verify** — typecheck ≤ 396; curl smoke: `POST /api/characters-local/absorb` twice → second returns `created: []`; PATCH a variant array with a traversal filename → 400; PATCH legacy `refImages` on a migrated record → e.g. `GET` shows it in the Default variant. Clean up any curl-created test records (absorb-created records for REAL loras stay — that IS the migration).
- [ ] **Step 4: Commit**

```bash
git add frontend/server/api/characters-local.get.ts frontend/server/api/characters-local.patch.ts frontend/server/api/characters-local/absorb.post.ts
git commit -m "feat(characters): variant CRUD + legacy alias + idempotent LoRA absorb endpoint"
```

---

### Task 3: `useCharacters` — variants, status, variant-aware resolution

**Files:**
- Modify: `frontend/app/composables/useCharacters.ts`
- Test: `frontend/tests/unit/characters-composable.unit.spec.ts` (extend/update)

**Interfaces:**
- Consumes: Task 2's GET shape (records now carry `variants`); `GET /api/training-queue` → `{ jobs: [{ status, loraKind, displayName, outputName }] }`.
- Produces (Tasks 4/6/7 rely on):
  - `CharacterClient` gains `variants: CharacterVariant-shaped[]` and `loraName/trigger` (kept); local `CharacterVariantClient` interface mirrors the server shape.
  - `resolveVariantRefs(picks: { slug: string; variantId?: string }[]): Record<string, string[]>` — keyed by slug; picks the named variant (fallback: default variant) and maps to `viewRefUrl`s. The old `resolveRefs(slugs)` becomes a thin wrapper (`picks` with no variantId) and stays exported (surface/generate-path update to the new fn in Task 4).
  - `coverUrl(c, variantId?)` — cover of the named variant, default variant fallback.
  - `characterStatus(c, jobs): 'draft' | 'training' | 'ready'` — pure export: ready if `c.loraName`; training if any job with `status in (queued|starting|processing)`, `loraKind === 'character'`, and (`displayName === c.name` or `outputName === slugifyish(c.name)` — compare case-insensitively on both fields); else draft.
  - `useTrainingJobs()` mini-composable in the same file: module-level `jobs` ref + `refreshJobs()` fetching `/api/training-queue` (offline-safe), 15s polling ONLY while a consumer sets `pollingEnabled` true (panel does).

- [ ] **Step 1: Failing tests** — update existing tests for the variant shape; add: `resolveVariantRefs` picks the named variant and falls back to default for unknown ids; `characterStatus` for all three states (feed synthetic jobs).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS** (whole file).
- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCharacters.ts frontend/tests/unit/characters-composable.unit.spec.ts
git commit -m "feat(characters): variant-aware client — resolveVariantRefs, status derivation, training-jobs poll"
```

---

### Task 4: Cast plumbing carries `variantId` end-to-end

**Files:**
- Modify: `frontend/app/lib/shotdirector/types.ts` (`CastMember` + hydrate already filters shape — extend), `frontend/app/lib/shotdirector/hydrate.ts`, `frontend/app/lib/shotdirector/castEdges.ts`
- Modify: `frontend/app/components/vue-canvas/CharacterPickerModal.vue`, `ShotDirectorSurface.vue`, `CharacterNode.vue`, `VueNodeCanvas.vue` (generate handler + edge-sync lite mapping)
- Test: extend `frontend/tests/unit/shotdirector-cast.unit.spec.ts` + `shotdirector-cast-edges.unit.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`resolveVariantRefs`, `coverUrl(c, variantId?)`).
- Produces:
  - `CastMember { slug; name; via; variantId?: string }` (hydrate keeps string variantIds, drops others).
  - `CharacterPickerModal` emits `pick: [slug: string, name: string, variantId?: string]`: cards with >1 variant expand a variant chip row on click instead of picking immediately; single-variant cards pick directly (variantId omitted).
  - Surface: `addCastMember(slug, name, via?, variantId?)` (composable param appended); chips render `Vera · Raincoat` when a non-default variant; `castRefRows` uses `resolveVariantRefs` with each member's variantId; zero-ref error message names the variant (in `materializeCast`'s issue: append variant label when the pick had one — pass variant labels via the resolved map? NO — keep pure: the surface/handler resolves; `materializeCast` keeps its message; the surface's cast strip already shows "no photos yet" per row. Only change the strip copy to include the variant label).
  - `CharacterNode.vue`: variant `<select>` shown when the picked character has >1 variant; writes `properties.sailor_characterVariantId`; dispatches `sailor:castEdgesChanged` on change.
  - `castEdges.ts`: `CastNodeLite` gains `characterVariantId?: string | null`; `wireCastFor` copies it to `variantId`; `syncCast` treats a variantId change on a wire member as a change (update the member, not a dupe).
  - Generate handler (`VueNodeCanvas.handleShotDirectorGenerate`): builds `picks` from `sheet.cast` (`{ slug, variantId }`) and resolves the fetched registry accordingly (inline variant selection mirroring `resolveVariantRefs` semantics — default fallback).

- [ ] **Step 1: Failing tests** — cast spec: hydrate keeps `variantId`; `materializeCast` unchanged behavior with variant-resolved maps (existing tests still green). castEdges spec: wireCastFor carries `characterVariantId` → `variantId`; syncCast detects a variant change (same slug, different variantId → returns updated array, not null).
- [ ] **Step 2: Run → FAIL** on the new assertions.
- [ ] **Step 3: Implement across the listed files** (each change is small; follow the exact property names above).
- [ ] **Step 4: Run cast + cast-edges + composable + dispatch suites → ALL PASS.** Typecheck ≤ 396.
- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/types.ts frontend/app/lib/shotdirector/hydrate.ts frontend/app/lib/shotdirector/castEdges.ts frontend/app/components/vue-canvas/CharacterPickerModal.vue frontend/app/components/vue-canvas/ShotDirectorSurface.vue frontend/app/components/vue-canvas/CharacterNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/composables/useShotDirector.ts frontend/tests/unit/shotdirector-cast.unit.spec.ts frontend/tests/unit/shotdirector-cast-edges.unit.spec.ts
git commit -m "feat(characters): variantId through the whole cast pipeline (picker, chips, node, edges, generate)"
```

(If `useShotDirector.ts` needs the extra param it's in the staged list; if untouched, drop it from the add.)

---

### Task 5: `useSheetGeneration` — shared sheet/variant generation composable

**Files:**
- Create: `frontend/app/composables/useSheetGeneration.ts`
- Modify: `frontend/app/components/vue-canvas/CharacterSheetNode.vue` (refactor onto it; behavior identical)
- Test: `frontend/tests/unit/sheet-generation.unit.spec.ts` (pure prompt builder)

**Interfaces:**
- Consumes: `CHARACTER_SHEET_CANONICAL`, `useInpaint().loraGen(loraFilename, prompt, aspectRatio)` (mirror CharacterSheetNode's current call exactly), `POST /api/cloud-train/character-shot`.
- Produces:
  - `interface SheetShot { dataUrl: string | null; scene: CharacterShotScene; loading: boolean; error: boolean }`
  - `buildScenePrompt(scene: CharacterShotScene, opts: { trigger?: string | null; descriptor?: string }): string` — pure: `[trigger, descriptor, scene.prompt].filter(Boolean).join(', ')`.
  - `useSheetGeneration()` → `{ shots: Ref<SheetShot[]>, reset(), runShot(idx, source: SheetSource), expandAll(source): Promise<void> }` where `SheetSource = { mode: 'photo'; referenceImageDataUrl: string; descriptor?: string } | { mode: 'lora'; loraFilename: string; trigger: string | null; descriptor?: string }`. `expandAll` runs sequentially and **breaks after the first failed shot** (money guard — preserve the exact semantics CharacterSheetNode has today).
- CharacterSheetNode refactor: delete its local `Shot`/`shots`/`generatePhotoShot`/`generateLoraShot`/`runShot`/expand loop; consume the composable (photo mode passes no descriptor). No template/UX changes.

- [ ] **Step 1: Failing test** — `buildScenePrompt` goldens: trigger+descriptor+scene; descriptor only; trigger only; scene only.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement composable + refactor the node.**
- [ ] **Step 4: Run new spec + full vitest (known 3 unrelated failures) + typecheck ≤ 396.**
- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useSheetGeneration.ts frontend/app/components/vue-canvas/CharacterSheetNode.vue frontend/tests/unit/sheet-generation.unit.spec.ts
git commit -m "refactor(characters): extract shared sheet generation (descriptor-aware) from the sheet node"
```

---

### Task 6: Panel rebuild — one list, variants, status; style leaves

**Files:**
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (major rework)

**Interfaces:**
- Consumes: Tasks 3 (`characters`, `characterStatus`, `useTrainingJobs`, `coverUrl`), 5 (`useSheetGeneration`, `buildScenePrompt`), 2 (PATCH variants).
- Produces: the panel per spec §Panel redesign:
  - DELETE: the "CHARACTER" trained-LoRA section, the STYLE section (search + None + Your styles + Library), the strength sliders, the Add-to-canvas composer + `generate()`, "Make castable", and the castable/LoRA split headers. The panel's only list is the registry.
  - Card: cover (default variant), name, status badge — `Draft` (amber text chip + "Train identity" button → Task 8's event), `Training… <pct>%` (from jobs), ready → small LoRA chip (filename stem, white/40).
  - Expanded: variant chips row (label + ref-count; select → that variant's sheet grid with the EXISTING upload/remove/cover controls now writing via variant-aware PATCH `{ variants }`), `+ New variant` (name + descriptor inputs → creates the variant via PATCH, then "Generate sheet · ~$0.12" (ready, LoRA source) / "· ~$0.32" (draft, photo source using the default variant's cover as `referenceImageDataUrl` — fetch → dataURL) via `useSheetGeneration`; tiles render with per-tile re-roll; on completion uploads dataURLs via `uploadRefFile` and PATCHes the variant's refImages), "Regenerate sheet" on existing variants (same button/flow, replaces refs), delete variant (`default` undeletable), delete character (existing confirm).
  - Actions row per character: **Use in image** / **Cast in shot** → dispatch Task 7's events with `{ slug, variantId: selectedVariantId }`.
  - All mutations `.ok`-checked with toasts (house pattern from the toast-polish commit).
- Keep `New` (create character) and the toast idioms. This is the biggest UI task — read the whole current file first; the sections to delete are at (approx, current file): trained-LoRA section ~340–423, STYLE ~425–488, scales ~490–507, composer ~511–528.

- [ ] **Step 1: Implement** per above.
- [ ] **Step 2: Verify** — typecheck ≤ 396; full vitest unchanged; browser (app shell — the panel opens from the dock even when the canvas iframe is flaky): one list only, no style section anywhere in the panel, draft/ready badges correct for real data (Vera = draft, absorbed LoRAs = ready after Task 9 runs — before Task 9 they may not exist yet: verify with Vera + any curl-created ready fixture, then clean the fixture), variant create + upload + cover + delete round-trips, **no paid button clicked**.
- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/CharacterLibraryPanel.vue
git commit -m "feat(characters): unified library panel — variants UI, status badges; style and composer removed"
```

---

### Task 7: Dual dispatch — `Use in image` / `Cast in shot` canvas handlers

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (two new listeners + teardown, beside the shot-director pair)
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (wire the two action buttons)

**Interfaces:**
- Consumes: `mintNodeId`, `createNodeData`, `nodes/edges` refs, `viewRefUrl`; Task 3's registry cache (`useCharacters`).
- Produces window events:
  - **`sailor:addCharacterImageGen`** `{ slug: string }`: look up the character (fetch `/api/characters-local` fresh, like the generate handler). Ready → `nodes.value.push(createNodeData('FluxLoRARemoteNode', pos, { prompt: (c.trigger ? c.trigger + ', ' : ''), lora_name: c.loraName, lora_scale: 1.0 }))`. Draft → push `createNodeData('Image', pos, { image: <default variant cover filename> })` AND `createNodeData('ConsistentFaceNode', posRight)` and wire Image.output-0 → ConsistentFaceNode's `reference_image` input (find its input index by name from the created node's `data.inputs`; edge push mirrors the existing spacetype wiring block — `{ id: 'e-' + mintNodeId(), source, sourceHandle: 'output-0', target, targetHandle: 'input-<idx>', type: 'comfy', data: { dataType: 'IMAGE' } }`). Draft with zero default refs → toast error "Add a photo to <name> first".
  - **`sailor:addCharacterCastNode`** `{ slug: string, name: string, variantId?: string }`: `nodes.value.push(createNodeData('Character', pos, undefined, { sailor_characterSlug: slug, sailor_characterName: name, ...(variantId ? { sailor_characterVariantId: variantId } : {}) }))` then dispatch `sailor:castEdgesChanged`.
  - Position: `project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })` like `handleSpaceTypeOutput`'s fallback.
- Panel: **Use in image** button dispatches the first event; **Cast in shot** the second (with the selected variant).

- [ ] **Step 1: Implement both handlers + teardown + panel buttons.**
- [ ] **Step 2: Verify** — typecheck ≤ 396. Browser IF the canvas mounts (known flaky): Use in image on a ready character adds a FluxLoRARemoteNode with lora_name+trigger prefilled; on Vera (draft) adds a wired Image→ConsistentFaceNode pair; Cast in shot adds a picked Character node. If the canvas won't mount, verify the event payloads via a window listener probe and note the skip.
- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/CharacterLibraryPanel.vue
git commit -m "feat(characters): panel dispatch — use-in-image (LoRA node / wired ideogram pair) and cast-in-shot"
```

---

### Task 8: Trainer seeding — "Train identity" from a draft

**Files:**
- Create: `frontend/app/composables/usePendingTrainerSeed.ts`
- Modify: `frontend/app/components/LoraTrainerSurface.vue` (consume on mount)
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` ("Train identity" action)
- Modify: `frontend/app/layouts/default.vue` ONLY if opening a train tab needs a helper (check how the Train menu opens one — `openTab({ type: 'train', … })` — and reuse; do not restructure tabs).

**Interfaces:**
- Produces: `usePendingTrainerSeed()` → `{ set(seed: TrainerSeed), consume(): TrainerSeed | null }` (module-level singleton; consume clears). `TrainerSeed = { kind: 'character'; name: string; trigger?: string | null; refViewUrls: string[] }`.
- Panel "Train identity" (drafts only): `set({ kind: 'character', name: c.name, trigger: c.trigger, refViewUrls: defaultVariant refs as viewRefUrl(...) })` then open a train tab exactly the way the app's Train menu does (read `default.vue` for the exact `openTab` call and reuse it verbatim).
- Trainer `onMounted`: `const seed = consume(); if (seed) { trainingKind.value = 'character'; form.outputName = seed.name; form.triggerWord = seed.trigger ?? suggested; for (const url of seed.refViewUrls) { fetch → blob → File(named from url filename) } then addFiles(files) }`. If a draft has <3 photos, show the existing-style inline warning ("More photos train a stronger identity — the dataset builder below can expand from one.").

- [ ] **Step 1: Implement the three pieces** (read the trainer's `form` field names first — `form.outputName`, `form.triggerWord` per the grounding; adapt if they differ).
- [ ] **Step 2: Verify** — typecheck ≤ 396; browser: click Train identity on Vera → Train tab opens in character mode with name/trigger prefilled and her 5 photos in the dataset (uploads visible). **Do NOT start a training run.**
- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/usePendingTrainerSeed.ts frontend/app/components/LoraTrainerSurface.vue frontend/app/components/vue-canvas/CharacterLibraryPanel.vue frontend/app/layouts/default.vue
git commit -m "feat(characters): Train identity — trainer opens pre-seeded from a draft's photos"
```

(Drop `default.vue` from the add if untouched.)

---

### Task 9: Trainer finalize links the registry; absorb + sanctioned auto-gen orchestration

**Files:**
- Modify: `frontend/server/api/cloud-train/status.get.ts` (or wherever the character sidecar finalize writes `kind` — locate the finalize block that writes the sidecar; the grounding says status.get.ts writes `kind` into the sidecar)
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (absorb-on-load + auto-gen banner)

**Interfaces:**
- Finalize: after the sidecar write for a `loraKind === 'character'` job, create-or-update the registry record (server-side, direct fs using `characterRegistry` helpers — same dir conventions as characters-local): match by slugified `displayName`; set `loraName` = final weights filename, `trigger` = job trigger; create the record (empty Default variant) if missing. A matching DRAFT flips to ready without touching its variants.
- Panel on mount (once per app session — module-level flag): `POST /api/characters-local/absorb` → `refresh()` → for each READY character whose default variant has 0 refs AND that was in `created` (plus any ready-empty existing ones ONLY if they came from this absorb — restrict to `created` to avoid re-firing forever), run `useSheetGeneration.expandAll({ mode: 'lora', … })` sequentially per character, uploading + PATCHing each finished sheet; banner: `Rendering reference sheets for N merged characters… (~$0.12 each)`; per-character failure → banner row with Retry, no auto-retry. In-flight guard: module-level Set of slugs.
- **This is the one place auto-spend is sanctioned** (~$0.48 for the user's 4 LoRA characters, once).

- [ ] **Step 1: Implement finalize linking** (server); typecheck.
- [ ] **Step 2: Implement absorb + auto-gen orchestration** (panel).
- [ ] **Step 3: Verify** — browser with the panel open: absorb creates records for Millie/Sheila/Jene/Reva (ready, LoRA chips), the banner appears and the four Default sheets render (REAL SPEND ~$0.48, sanctioned), second panel open creates/renders nothing. If any sheet generation fails, the retry row shows — retry once; if it fails again, leave it and note it. Vera stays draft. Finalize linking: unit-test the pure match helper if extracted; otherwise verify by inspection + note (no real training run).
- [ ] **Step 4: Commit**

```bash
git add frontend/server/api/cloud-train/status.get.ts frontend/app/components/vue-canvas/CharacterLibraryPanel.vue
git commit -m "feat(characters): LoRA absorb on load + one-time sheet auto-gen; training finalize links the registry"
```

---

### Task 10: Full-suite gate + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-02-character-unification-variants-design.md` (Status line)
- Modify: `docs/superpowers/specs/2026-07-01-character-cast-shot-director-design.md` (add one line under Status: entity model superseded by the 2026-07-02 spec)

- [ ] **Step 1:** `cd frontend && npx vitest run` (3 known unrelated failures only); `npx nuxi typecheck 2>&1 | grep -c "error TS"` ≤ 396; `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q` all pass (zero Python changes proven).
- [ ] **Step 2:** Update both spec status lines.
- [ ] **Step 3:**

```bash
git add docs/superpowers/specs/2026-07-02-character-unification-variants-design.md docs/superpowers/specs/2026-07-01-character-cast-shot-director-design.md
git commit -m "docs(characters): mark unification spec implemented; note superseded entity model"
```
