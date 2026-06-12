# Node action-button hierarchy redesign

**Date:** 2026-06-11
**Status:** Approved design, ready for implementation plan
**Surface:** `frontend/app/components/vue-canvas/ComfyNode.vue` (node header action buttons, ~lines 1027–1062)

## Problem

Every generator / output / heavy-compute node renders two action buttons in its header row:

- **Reroll** (dice icon) — re-runs only this node with a new seed; upstream is cache-hit, so no recompute and no re-billing. The cheap, everyday "give me another take."
- **Run** (▶ Play icon) — re-randomizes **every seed in the chain** and recomputes everything upstream. The expensive, rare "regenerate the whole pipeline fresh."

Two problems with the current treatment:

1. **No hierarchy.** Both buttons are equal weight (`size-5`, `text-white/55`), so the cheap-and-common action and the expensive-and-rare action look identical. Reroll is the action users want ~80% of the time on an output node, but nothing signals that.
2. **Wrong primary signal + palette violation.** ▶ Play is the universal "primary action / start playback" glyph, yet here it marks the heavier, rarer button — an inversion. Separately, the reroll button's hover state uses `violet-300 / violet-400`, violating the project's no-purple-accents rule.

The timeline-vocabulary overlap (a transport-style glyph on a graph node, in an app that also has a real playback timeline) was considered and accepted as a non-issue for this surface.

## Decision

A **styling + icon change only — no behavior change.** Handlers (`rerollThisNode`, `runThisNode`), the `showRunButton` visibility logic, the filtered-run dispatch, button order (reroll left, run right), and tooltips are all untouched.

### 1. Reroll → visual primary

- Icon: unchanged (`Dices`).
- Resting: filled — `bg-white/[0.09]`, `ring-1 ring-white/10`, bright icon `text-white/90`.
- Hover: `bg-white/[0.15]`.
- Running (`data.running`): emerald — `text-emerald-300 bg-emerald-400/15`, showing the `Loader2` spinner. **The node's running indicator now lives here** (see Running state below).
- Disabled (muted / bypassed): `text-white/25 cursor-not-allowed`.

### 2. Run → visual secondary ("play-from-start")

- Icon: **swap `Play` for a custom bar+triangle "play-from-start" glyph** (inline SVG — lucide has no exact match). This reads as "play from the beginning → up to here," matching the run-the-whole-chain scope.
  ```html
  <svg viewBox="0 0 24 24" fill="currentColor" class="size-3">
    <rect x="3" y="4" width="3.5" height="16" rx="1.5" />
    <path d="M10 4l11 8-11 8z" />
  </svg>
  ```
- Resting: ghost — transparent background, muted icon `text-white/40`.
- Hover: `text-white/70 hover:bg-white/[0.06]`.
- Running / disabled: `text-white/25 cursor-not-allowed`, no spinner (the spinner is hosted by the primary button).

Both buttons stay `size-5` — hierarchy comes from fill/opacity, not size, so header layout is stable. Both buttons remain **always visible** (not hover-revealed); "demote" was chosen over "hide" to keep the action discoverable.

### 3. Remove violet

All `violet-*` classes on the reroll button are removed. Emerald remains reserved exclusively for the active running state.

### 4. Running state (the one nuance)

There is a single `data.running` flag per node; it cannot distinguish which button triggered the run. Today the `Loader2` spinner sits on the Run button. Under the new hierarchy the spinner **moves to the primary (reroll/dice) button**, and the secondary button goes disabled-muted while running. This keeps one running indicator, places it on the prominent button, and requires no new per-action state — so it remains behavior-preserving.

## Concrete edits (ComfyNode.vue)

**Reroll button (~1027–1041):**
- `:class` → drop the violet branch; add the primary filled/ring resting style, neutral hover, and an emerald running branch:
  ```
  :class="(isMuted || isBypassed)
    ? 'text-white/25 cursor-not-allowed'
    : data.running
      ? 'text-emerald-300 bg-emerald-400/15'
      : 'bg-white/[0.09] ring-1 ring-white/10 text-white/90 hover:bg-white/[0.15]'"
  ```
- Body → spinner when running, dice otherwise:
  ```html
  <Loader2 v-if="data.running" class="size-3 animate-spin" />
  <Dices v-else class="size-3" />
  ```
- Keep the existing `:disabled` and the muted/bypassed/running tooltip ladder ("Re-run only this node — new seed, everything upstream stays as-is").

**Run button (~1045–1062):**
- `:class` → ghost resting + muted hover, no emerald:
  ```
  :class="(isMuted || isBypassed || data.running)
    ? 'text-white/25 cursor-not-allowed'
    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]'"
  ```
- Body → replace `<Loader2 …>` / `<Play …>` with the single custom bar+triangle SVG above (no spinner here anymore).
- Keep the existing `:disabled` and tooltip ("Run this node and everything before it").

**Imports:** `Play` likely becomes unused — remove it from the lucide-vue-next import if so. `Dices` and `Loader2` stay.

## Out of scope

- No change to run/reroll behavior, seed-randomization scope, or which node types show the buttons.
- No hover-reveal / progressive disclosure.
- No button reordering or resizing.

## Testing / verification

- Visual check via the dev preview: a generator node shows a filled bright dice (primary) and a muted bar+triangle (secondary); hover states match; no violet anywhere.
- Running a node shows the emerald spinner on the dice; the secondary button is disabled.
- Muted / bypassed nodes show both buttons greyed and non-interactive.
- Confirm no remaining `violet-` reference on these buttons and no unused `Play` import.
