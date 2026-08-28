# Compositor Toolbar Regroup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Single task.

**Goal:** Collapse the modal toolbar's five shape buttons into a last-used-face flyout, fold Import SVG into the Insert menu and the three AI flows into one menu — 17 buttons → 10, zero behavior change to the tools themselves.

**Architecture:** All in `frontend/app/components/vue-canvas/CompositorModal.vue`'s bottom toolbar (~:4580-4660). Menus reuse the zoom menu's existing idiom (state ref + `@click.stop` cluster wrapper + stage click-away + Escape). Menu contents data-driven where cheap.

**Spec:** docs/superpowers/specs/2026-08-28-compositor-toolbar-regroup-design.md (binding, including the Non-goals and the split-face-vs-whole-button implementer choice).

## Global Constraints

- No tool behavior changes; every current action stays reachable; all shortcuts unchanged.
- Follow the zoom menu's exact menu idiom (it is the reference; grep `zoomMenuOpen`).
- Plain-language labels; no new colors; separators after Redo and after Brush.
- vue-tsc baseline 417; only errors naming your symbols are yours. Vitest suites stay green.

### Task 1: Toolbar regroup

**Files:** Modify `frontend/app/components/vue-canvas/CompositorModal.vue`. Optional small pure module if the menu lists are extracted. Test: extend an existing compositor unit spec only if a pure seam is created; otherwise the live pass is the gate.

- [ ] Step 1: Shapes flyout per spec §5 (last-used face, Rectangle default; document the face/chevron choice in the report).
- [ ] Step 2: Insert ▾ absorbs Import SVG; AI ✦ ▾ absorbs AI vector / Generate in region / Smart select (disabled row + hint when no image selected).
- [ ] Step 3: Separators + order per spec; remove the six retired buttons.
- [ ] Step 4: `npx vue-tsc --noEmit` (417) + compositor unit suites.
- [ ] Step 5: Live Playwright pass on /dev/frame-lab per spec Testing section; screenshots.
- [ ] Step 6: Commit `feat(frame): toolbar regroup — shapes flyout + insert/AI menus`.
