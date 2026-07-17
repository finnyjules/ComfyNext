# Timeline Slice 2 — Junction Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (being executed inline in the authoring session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The five schema transition kinds (crossfade, wipe_left/right, slide_up/down) render identically in the WebGL preview and both Python paths, with junction chips in the editor to add/edit/remove them.

**Architecture:** One shared resolution module per language pins the math — `frontend/shared/timeline/transitions.ts` (windows, weight, per-frame modulation) and its Python twin (`_transition_windows` / `_transition_mod` in nodes_timeline.py). Renderers stay dumb: the WebGL compositor applies the modulation in `buildDrawList` (alpha multiply for crossfade, y-offset for slides, a wipe uniform pair for wipes — the only GLSL change), and both Python paths apply the same modulation around `_transform_and_alpha`/`_transform`. The UI is chips at exact junctions + a kind/duration popover dispatching the existing `add/update/remove_transition` commands.

**Pinned semantics** (mirrored tests + golden fixture 05-transitions enforce):
- Window: `d` frames centered on the cut — `pre = floor(d/2)` before, `d-pre` after; head clamped to the outgoing clip's start, tail to the incoming clip's end; the cut never moves; stale (non-adjacent/missing) transitions are ignored.
- Weight `w(g) = (g - startF + 1) / (windowLen + 1)` — strictly inside (0,1).
- Outgoing keeps rendering through the window (source clamped to its last local frame); incoming appears from the window start (source clamped to its head) and paints on top.
- crossfade: incoming alpha × w · wipes: incoming visible where canvas-x < w (left) / > 1-w (right), boundary at pixel centers (`floor(w·W + 0.5)` columns) · slides: incoming y-offset ±(1-w) canvas heights, applied before quantization.

## Tasks

- [x] **Shared TS module + unit tests** — `shared/timeline/transitions.ts` (resolveTransitionWindows / transitionWeight / indexTransitionWindows / transitionModAt), `tests/unit/timeline-transitions.unit.spec.ts`.
- [x] **WebGL wiring** — `compositor.ts` buildDrawList applies modulation + paint-order post-pass; `DrawEntry.wipe`; `shaders.ts` u_wipeMode/u_wipeW mask; `glRenderer.ts` uniform plumbing.
- [x] **Python twin** — `_transition_windows` / `_index_transition_windows` / `_transition_mod` / `_apply_wipe_np` / `_order_for_transitions`; wired into `render_frame_np` (+ `_adapt_edit_state` carries clip ids, resolved windows, ordering) and the graph composite in `TimelineNode.execute` (extended per-layer ranges, torch wipe mask); mirror tests in `tests-unit/comfy_extras_test/timeline_transitions_test.py`.
- [x] **Editor UI** — junction chips on video tracks (exact adjacency), popover with None + 5 kinds + duration (seconds); store gains addTransition/updateTransition/removeTransition.
- [ ] **Golden fixture 05-transitions** — 3 tracks (crossfade / wipe_left / slide_up pairs), frames [4, 9, 12, 15]; regenerate goldens (existing dirs must stay bit-identical), eyeball, commit.
- [ ] **Gates** — vitest (transitions + compositor suites), Python mirror tests, timeline-golden.spec.ts (server + webgl), timeline.spec.ts regression, in-browser chip click-through.

## Notes / accepted edges

- Fades and transitions on the same junction compose (both twins use the same clamped local frame for fade math) — consistent, if visually odd.
- Chained transitions on one clip resolve in `state.transitions` array order in both twins.
- Wipe reveal sweeps normalized canvas-x (classic full-frame behavior); for scaled/offset clips the sweep still crosses the clip within the window.
- Audio has no transition rendering (junction chips only appear on video tracks).
