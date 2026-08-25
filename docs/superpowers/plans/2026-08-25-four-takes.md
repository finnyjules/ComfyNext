# Four Takes Implementation Plan (Milestone A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fast studios' describe bars return four labeled takes in a filmstrip (yours-first), hover-preview live, keep/undo/dismiss, two-stage diverge→converge, picks logged. Spec: `docs/superpowers/specs/2026-08-25-four-takes-design.md` (binding).

**Architecture:** Extend `/api/vibe` with `variants` (strict TAKES_SCHEMA; absent → byte-identical today-behavior). One shared TakeStrip component; per-studio thumbnail adapters over EXISTING bake/preview machinery; parametric neighbor-spread is pure seeded math; pick log is a bounded localStorage ring.

**Tech Stack:** Vue 3 + TS, vitest (+ @vue/test-utils/happy-dom infra), existing studio engines. Baselines: vue-tsc 420; pre-existing unit failures listed in .superpowers/sdd/progress.md; foreign WIP files (capabilities.ts, action-catalog, StudioRow.vue, ShaderStudioSurface.vue, routing spec + others) — own hunks only, never stash.

## Global Constraints

- Back-compat: `variants` absent ⇒ vibe request/response byte-identical (pin with a characterization test capturing today's request body + response handling).
- WebGL/canvas engines cannot run in node env: adapter unit tests cover contract (existence, wraps the studio's real bake fn — source-level pin, error-tile path); PIXEL proof happens in Task 5's live browser pass. State this honestly in test names.
- Guidance detector conventions; hover restore must be provably non-destructive (config identity/byte tests).
- TDD; explicit vitest paths; commit to main per task.

---

### Task 1: Multi-take API + prompt

**Files:** `frontend/server/api/vibe.post.ts` (TAKES_SCHEMA + `variants` branch), `frontend/app/lib/vibePrompt.ts` (multi-take instruction block appended when variants requested — studio-agnostic: named-dimension difference rule, ≤24-char angle labels, "closest: <look>" honesty rider referencing the existing clause), `frontend/tests/unit/vibe-takes.unit.spec.ts` (new).
**Interfaces:** Produces server contract `{takes:[{label,changes:[{key,value}],rationale}]}` (2–4) when `variants:4` sent; `runParamPatch`-compatible single shape otherwise. Client fetch seam unchanged for old callers.
- [ ] Failing tests: request WITHOUT variants → body/schema identical to a captured today-fixture; WITH variants → schema enforces 2–4 takes, label length, changes array. Prompt builder emits the block only when variants requested; detector: block names the honesty rider.
- [ ] Implement; run vibe/studio-tune related specs; commit `feat(agent): /api/vibe learns to answer in four takes`.

### Task 2: TakeStrip component + pick log + neighbor spread

**Files:** `frontend/app/components/vue-canvas/studio/TakeStrip.vue` (new), `frontend/app/lib/agent/takes.ts` (new: types, `spreadAroundTake(controls, baseConfigValues, take, seed)` → 4 parametric neighbors with generated captions; pick-log ring `logTakeEvent`/`readTakeLog` bounded 500), tests `frontend/tests/unit/take-strip.unit.spec.ts` + `frontend/tests/unit/takes-spread.unit.spec.ts`.
**Interfaces:** TakeStrip props: `{takes, thumbs (map take→canvas/dataURL/null), current (thumb), selected, busy}`; emits `hover(take|null)`, `select(take)`, `keep`, `dismiss`, `moreDirections`, `variationsOf(take)`. Spread: picks 2–3 keys with largest |Δ|/range vs base, ±spread within clamps, seeded (per seeded-randomness house rule — hash, no Math.random), captions honest-parametric.
- [ ] Failing tests: strip renders yours-first + divider + labels; hover emits; keep/dismiss/yours-click semantics; buttons gating (variations disabled until selected); error tile on null thumb. Spread: determinism by seed; clamped; key choice matches largest relative delta; 4 distinct outputs; caption strings contain the changed key labels.
- [ ] Implement (happy-dom mount tests per Task-1-era infra); commit `feat(studio): the take strip + parametric neighbors + pick log`.

### Task 3: Thumbnail adapters (5 studios)

**Files:** `frontend/app/lib/agent/takeThumbs.ts` (new registry: gradient/texture/shader/shape/vectortype adapters, each delegating to that studio's EXISTING render/bake fn at ~160px; async; throws → null (strip shows error tile)), test `frontend/tests/unit/take-thumbs.unit.spec.ts` (contract level per Global Constraints — registry completeness for the five ids, each adapter references the studio's real render entrypoint (source pin), null-on-throw).
- [ ] Find each studio's smallest real render seam (they exist: bakes/capsules/gallery); do NOT reimplement any renderer. Note per adapter which fn it wraps in a comment.
- [ ] Commit `feat(studio): take thumbnails ride each studio's own renderer`.

### Task 4: Wire the studios (four of the five — Pattern deferred, see the spec amendment)

**Files:** the in-studio agent seam (`frontend/app/composables/useStudioAgent.ts` / `useVibeControl.ts` — read first, choose the single choke-point so all five studios get the strip from ONE wiring change if possible; per-surface template additions only where the bar mounts), five surface files (mount point only — CAUTION ShaderStudioSurface.vue carries foreign WIP; keep its hunk minimal + own-hunks staging), plus `frontend/tests/unit/studio-agent-takes.unit.spec.ts`.
**Interfaces:** describe-bar submit → vibe with variants:4 → thumbs rendered async → strip shown; hover applies take config non-destructively (ORIGINAL config captured once; restore on unhover/dismiss/esc — byte-equality test); keep routes through the studio's existing apply/accept path (undo integration follows from that path); single-tune canvas path untouched (characterization: studioTune specs stay green, zero diffs).
- [ ] Failing tests at the composable seam (mock fetch): submit → strip state populated; hover→restore byte-identical; keep commits via the same writer the old accept used; variationsOf calls spread (no fetch); moreDirections refetches; log events appended.
- [ ] Commit `feat(studio): describe bars propose four takes`.

### Task 5: Live verification + docs

- [ ] Dev server :3002 via Browser pane. In Gradient + one more of the wired four (Shader / Shape / Vector Type) at minimum — **Pattern is NOT wired; it follows with its own task, see the spec amendment**: type a look → strip appears with 4 labeled takes + yours-first; hover swaps preview live and restores; keep commits; yours-click restores; ≈ variations spreads around pick; ↻ re-rolls; esc dismisses clean; console clean; screenshot each stage. Verify single-node canvas tune (prompt bar) still behaves exactly as before (no strip there).
- [ ] Docs: STATE.md entry + strategy doc note; dashboard — MERGE with the other session's live version (it republished twice: WebFetch the live artifact FIRST, apply masthead/Act-1 edits on top of THEIR content, republish); memory (four-takes-landed + pick-log pointer); ledger. Append verification record to this plan.
