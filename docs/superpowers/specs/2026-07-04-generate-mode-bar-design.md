# Generate mode in the prompt bar — deterministic fast path

**Date:** 2026-07-04
**Status:** Approved direction, pending spec review
**Scope:** Frontend only. The canvas prompt bar (`app/components/agent/CanvasPromptBar.vue`) gains a deterministic "generate mode". The Generate toolbar door's BEHAVIOR is unchanged (click still drops a bare node); its options list is refactored onto the shared module in §2.

## 1. Purpose & decided constraints

Typing "a cat wearing a hat" today goes through the full agent planner (sonnet round-trip, ~2k-token prompt, ghost proposal, Keep & Run) even though the planner's own rules resolve it to `addNode GenerateImageNode {prompt}`. This adds a deterministic gear **in front of** the agent for declared generation intent — no model call, no ghost, no ambiguity — without touching the agent path at all.

Decided in design discussion:
- **The Generate toolbar door keeps dropping bare nodes** (click = node on canvas, consistent with the Add/Studios doors' grammar). The mode selector lives in the bar itself — the door and the bar are parallel paths (click vs type), not redundant ones.
- **Never auto-run.** Enter places a configured node; running (spending) is always the user's explicit act on the node.
- **Freeform bar behavior is byte-identical to today** — no chip means the agent planner, ghost proposals, review loop, all unchanged. No changes to `useCanvasAgent.ask()`, the planner prompt, or `/api/agent-plan`.

## 2. Shared data — `GENERATE_OPTIONS`

New module `app/data/generate-options.ts` (same never-drift pattern as `studio-options.ts`):

```ts
export interface GenerateOption {
  label: string            // 'Image' | 'Styled image' | 'Video' | 'Music' | 'Speech'
  icon: Component
  nodeType: string         // GenerateImageNode | FluxLoRARemoteNode | GenerateVideoNode | GenerateMusicNode | GenerateSpeechNode
  promptWidget: string     // the node's primary prompt/text widget name (verified against the Python schemas at plan time; 'prompt' expected for image/video/music, TBD-verify for speech which may be 'text')
  placeholder: string      // bar placeholder while chip active, e.g. 'Describe the image…'
}
export const GENERATE_OPTIONS: GenerateOption[]
```

The toolbar door (`generateOptions` + `generateAudioOptions` in `default.vue`) is refactored to render from this module (labels/icons/nodeTypes identical to today, including the Audio→Music/Speech inline expand). Door behavior unchanged: click still calls `addLoadNode(nodeType)`.

## 3. Mode state — `useGenerateMode()`

New composable `app/composables/useGenerateMode.ts`: a module-level singleton `ref<GenerateOption | null>`, with `set(opt)`, `clear()`. Written by the bar's own selector; read by the bar. (Toolbar door does NOT write it — decided. Homepage cards deferred.)

## 4. Bar UI & behavior (`CanvasPromptBar.vue`)

- **Selector:** a small button at the bar's left edge carrying the pastel treatment (gen-pastel dot, matching the Generate toolbar icon — this stages a billed action). Click opens a compact popup listing `GENERATE_OPTIONS` (five rows, flat — no Audio submenu needed here). Picking one sets the mode.
- **Chip:** while mode is active, the button is replaced by a chip showing the option label + ✕. Placeholder switches to the option's `placeholder`. The agent's glimm/proposal UI is untouched (it simply won't trigger in chip mode).
- **Enter with chip active:** deterministic placement —
  1. dispatch the existing `comfynext:addNode` event extended with `widgetOverrides: { [promptWidget]: typedText }` (the canvas's `handleAddNode` must honor `widgetOverrides`; if it doesn't today, extend it — `spliceAfterNode`/`applyEffect` already flow overrides through the same node-creation internals, so the seam exists),
  2. `fitView` to the new node (reuse the focus pattern from `handleApplyEffect`),
  3. clear the chip and the input (one-shot; the bar returns to freeform/agent mode),
  4. **do not run anything.**
- **Empty Enter with chip active:** no-op (don't place a node with an empty prompt).
- **Escape** (input focused) or chip ✕: clear the mode, keep the bar. Escape without a chip behaves as today.
- **No chip:** submit goes to `ask(phrase)` exactly as today.

## 5. Out of scope / deferred

- Toolbar Generate door changes — none (explicitly decided against making it a mode-setter).
- Homepage "Create an image" cards seeding the mode on project open (slice 2 — mount-timing fiddliness).
- Freeform-prompt heuristic (approach B) — revisit only with evidence that users type descriptions without picking the mode; the agent handles those correctly today, just slower.
- `/image`-style slash shortcuts in the bar.
- Auto-run in any form.
- Styled-image LoRA picking: the fast path prefills the prompt only; LoRA selection stays whatever the node's defaults/widgets provide (the agent path remains the smart route for "in my watercolor style").

## 6. Testing

- Unit (vitest): `GENERATE_OPTIONS` — 5 entries, nodeTypes exist in `ACTION_CATALOG`, non-empty `promptWidget`/`placeholder` per entry.
- e2e (Playwright, `PW_BASE_URL` pattern): chip flow — open selector, pick Image, type "a red fox", Enter → exactly one new node on canvas whose prompt widget shows "a red fox", chip cleared, nothing running (run-queue count unchanged); Escape clears chip; freeform submit with no chip still reaches the agent UI (thinking state appears).
