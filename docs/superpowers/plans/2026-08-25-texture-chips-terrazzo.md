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

**GPU handoff (from Task 2 — the CPU twin is on main at `d12586b8c`):**

- **FIRST, the hazard:** `renderer.ts`'s FS dispatches `if (u_mode > 2.5) { …shapes… }`, and
  chips is MODES index 4. Picking Chips today renders the SHAPES branch — a plausible-looking
  wrong tile, not a blank one. Re-gate that test (`u_mode > 3.5` → chips, `> 2.5 && < 3.5` →
  shapes) before anything else, or you will "verify" a pattern that never ran your code.
- **Import, never retype.** `pattern.ts` exports `CHIP_NEIGHBORHOOD`, `CHIP_R_MIN`,
  `CHIP_R_MAX`, `CHIP_INK_ROLES`, `CHIP_TONE_RANGE` and the five salts `CHIP_SALT_X/_Y/_R/
  _ROLE/_TONE` precisely so the FS template literal can interpolate them (`${CHIP_SALT_X}`).
  Retyped constants are how the twins drift.
- **The hash needs the per-lane vector**, not the file's existing scalar `cellHash`. Stock
  hash13 adds 33.33 to all three lanes, which makes it symmetric — `cellHash(1,2) ===
  cellHash(2,1)` — and mirrors every chip across the tile diagonal:
  ```glsl
  float chipHash(float cx, float cy, float salt){
    vec3 p = fract(vec3(cx, cy, salt) * 0.1031);
    p += dot(p, p.yzx + vec3(33.33, 41.17, 27.83));
    return fract((p.x + p.y) * p.z);
  }
  ```
- **Fixed 5×5 window** (`for (int dy = -2; dy <= 2; dy++)`), hashing the WRAPPED cell id
  (`mod`) but measuring to the UN-wrapped position `jx + f.x`. That split is what makes the
  tile seamless. 3×3 is not enough — the CPU spec fails at N=1.
- **F2 must come from a DIFFERENT cell id.** Track `(f1, id1)` and the best distance whose id
  differs; otherwise at low `chipCells` a chip grouts against its own wrapped image.
- **Colour:** role 0/1 = the two ink fills, role 2 = ground, resolved through the existing
  `evalFill(r, …)` path. Jitter is one mix, no clamp, no branch:
  `col = mix(col, vec3(step(0.5, tone)), abs(tone - 0.5) * u_jitter * ${CHIP_TONE_RANGE});`
- **Expect low-bit disagreement, not identity.** CPU `Math.hypot` (float64) vs GLSL `length()`
  (float32) differ in the last bits, so a handful of pixels on chip boundaries will flip. Diff
  GPU-vs-CPU tiles with a tolerance, the way `pattern-gallery.vue` already does; do not chase
  an exact match. That page enumerates families explicitly — add a chips group to it to get
  the parity thumbnails.
- **Recipe caveat:** chips have exactly TWO ink colours + ground (`CHIP_INK_ROLES = 2`,
  decided). Write the terrazzo recipe as two-tone-plus-jitter; a third chip colour needs
  `u_fillType[3]`/`u_fillStops[12]`/`u_strokeRole[3]` and the `r < 3` loop widened first.

### Task 4: live verification + docs

- Dev server via Browser pane on :3002 (never :3000). In the real canvas: type "make me a seamless terrazzo pattern" → confirm TextureStudio lands configured in chips mode, render READS as terrazzo (screenshot); check a no-op row never appears; check the studio panel shows the Chips section derived (no hand-written rows); tile the export 2x2 mentally/visually for seams. Then: STATE.md (Texture row + landed entry), ROADMAP Act 2 (family 1: started — first engine live), dashboard artifact, memory. Commit docs.
