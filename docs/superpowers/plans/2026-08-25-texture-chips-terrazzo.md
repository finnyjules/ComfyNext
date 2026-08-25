# Texture Chips / Terrazzo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `chips` content mode in Texture Studio (Worley-cell terrazzo family), tuner honesty for out-of-vocabulary looks, and a no-op proposal filter — ending with the live prompt "make me a seamless terrazzo pattern" producing actual terrazzo.

**Architecture:** Spec `docs/superpowers/specs/2026-08-25-texture-chips-terrazzo-design.md`. texturefx = WebGL2 fragment shader mirroring pure-TS math in pattern.ts (see renderer.ts header; truchetStates is the shared-source precedent). Controls are factory-derived from controls.ts — no hand-written panel/agent code.

**Tech Stack:** Vue 3 + TS, vitest, WebGL2 GLSL (no new deps). Baselines: vue-tsc 420; known pre-existing unit failures in .superpowers/sdd/progress.md; agent-capability-routing has 1 failure owned by another session's WIP.

## Global Constraints

- Only declaration site for new controls = TEXTURE_CONTROLS. Panel/agent/sweeps derive.
- CPU twin is the tested truth; shader mirrors it (constants shared, not copied, where the codebase's existing pattern allows).
- New controls are a DELIBERATE agent grant (opt-out model) — one snapshot/characterization update, called out in its own commit line.
- Working tree carries other sessions' WIP (capabilities.ts, action-catalog.ts, routing spec, StudioRow.vue, ShaderStudioSurface.vue, ComfyNode.vue + specs). Stage own hunks only, never revert theirs.
- vue-tsc: no new errors naming touched files. Vitest by explicit path. Commit to main.

---

### Task 1: No-op proposal filter + tuner honesty clause

**Files:**
- Modify: `frontend/app/composables/useCanvasAgent.ts` (~line 183, where `tuneBuilt = res.changes` lands — filter there or in the tuner that produces ProposedChange rows; find where `from`/old value is known and drop rows with `from === to` by value equality incl. number/string coercion the rows actually carry)
- Modify: the texture command-surface prompt seam (`frontend/app/lib/agent/studioTune.ts` — the TextureStudio tuner's describe/hint text): add the honesty clause — "if the requested look is not achievable with the available modes/controls, configure the closest approximation AND state in the message that it approximates <look>; never present an approximation as an exact match."
- Test: unit spec for the filter at whatever pure seam builds ProposedChange rows (follow the file's existing test coverage; new spec file if none).

**Steps:** failing test (a change list containing `{key:'lattice', from:'square', to:'square'}` yields no row; a real change survives) → implement → covering runs (the composable's existing specs + your new one) → commit `fix(agent): drop no-op tune proposals; texture tuner admits approximations`.

### Task 2: `chips` mode — CPU math + controls

**Files:**
- Modify: `frontend/app/lib/texturefx/types.ts` (MODES + any mode-label map), `frontend/app/lib/texturefx/pattern.ts` (the pure-TS chip math: for uv + params → colour-role index or ground, via wrapped-grid Worley — hash cell → feature point + per-cell radius scale from sizeVar; F1/F2 metric; grout when F2−F1 < groutWidth), `frontend/app/lib/texturefx/controls.ts` (Chips group entries per spec; extend `jitter`'s `when` to chips), `frontend/app/lib/texturefx/roles.ts` (chips family roles: N ink roles cycling + ground role; follow rolesFor's existing shape)
- Test: `frontend/tests/unit/texturefx-chips.unit.spec.ts` — determinism (same seed twice → identical role field on a sample grid); seamlessness (sample ring at u=0 vs u=1, v=0 vs v=1 → identical); input correlation (groutWidth 0.02 vs 0.2 → ground share strictly rises; sizeVar 0 → cell-area variance near zero vs sizeVar 1 large); roles respected (only declared role indices appear). Also extend whatever characterization pins TEXTURE_CONTROLS/agent vocabulary — deliberate grant, one commit.

**Steps:** failing tests → CPU implementation → controls → green → commit(s) (`feat(texture): chips mode — CPU cell math + factory controls (deliberate agent grant)`).

### Task 3: shader branch + terrazzo recipe

**Files:**
- Modify: `frontend/app/lib/texturefx/renderer.ts` (fragment-shader chips branch mirroring pattern.ts math; uniforms for the new params; follow the file's uniform-plumbing conventions), `frontend/app/lib/agent/studioTune.ts` texture guidance (terrazzo recipe per spec; also "mosaic/pebbles/stained glass" one-liners)
- Test: shader-source assertions in the chips spec if that's the house style (grep how other modes pin their shader branch); the CPU twin remains the behavioural truth.

**Steps:** implement → unit runs + vue-tsc → commit `feat(texture): chips on the GPU + terrazzo vocabulary for the tuner`.

### Task 4: live verification + docs

- Dev server via Browser pane on :3002 (never :3000). In the real canvas: type "make me a seamless terrazzo pattern" → confirm TextureStudio lands configured in chips mode, render READS as terrazzo (screenshot); check a no-op row never appears; check the studio panel shows the Chips section derived (no hand-written rows); tile the export 2x2 mentally/visually for seams. Then: STATE.md (Texture row + landed entry), ROADMAP Act 2 (family 1: started — first engine live), dashboard artifact, memory. Commit docs.
