# Agent fast-lane for single-node generations

**Date:** 2026-07-04
**Status:** Approved direction, pending spec review. SUPERSEDES the earlier "generate-mode chip" draft (previous content of this file, see git history) — the user rejected adding a mode/chip to the prompt bar; the bar stays single-purpose (always the agent). This design keeps one brain and zero new UI, and instead removes the proposal ceremony when there is nothing to review.
**Scope:** Frontend only. `useCanvasAgent.ts` + a small pure predicate. No changes to the prompt bar UI, the Generate toolbar door, the planner prompt, or `/api/agent-plan`.

## 1. Behavior

Today, typing a plain description ("a red fox in deep snow") flows: planner → ghost proposal on canvas → user clicks **Keep & Run** (or Keep). Three beats for the product's most common ask, where the "proposal" is a single node the user already fully described.

New behavior: when the planner's response is a **trivially-safe single placement** (definition in §2), skip the ghost/proposal ceremony and place the node directly — configured, selected, brought into view, and **never auto-run** (running = spending is always the user's explicit act on the node; same rule as the start modal). The bar shows a one-line confirmation instead of the proposal card. Anything non-trivial (multi-command plans, wiring, edits to existing nodes, deletions, tunes) keeps today's full ghost → review → Keep/Reject flow, byte-identical.

Accepted tradeoff (explicitly chosen over the chip design): the planner round-trip's latency (~2–5s) and cost (~1¢) remain — we are buying "fewer beats, no new concepts", not "instant and free".

## 2. The eligibility predicate

New pure function in `app/lib/agent/fastlane.ts`:

```ts
export function isFastLanePlacement(commands: AgentCommand[]): boolean
```

True iff ALL hold:
- exactly one command, `op === 'addNode'`;
- no `target` (it creates; it doesn't modify anything existing);
- the nodeType is a **creation** capability: present in `AGENT_CAPABILITIES` with `kind === 'generator'`, OR a frontend-only studio (`kind === 'studio'`) — the planner's gradient/texture exceptions ("soft blue gradient" → GradientStudio) deserve the same fast lane; both are free to place and the studio is free to run;
- effects (`kind === 'effect'`) are NOT eligible — a lone `addNode EditImageNode` floating unwired is a half-plan; let the ghost flow show what the agent intends to feed it.

The predicate sees only the parsed commands — no LLM involvement, trivially unit-testable.

## 3. Implementation shape (`useCanvasAgent.ask()`)

After parse + the existing dry-run/verify step, if `isFastLanePlacement(commands)`:
1. Commit through the SAME code path as the user clicking Keep (reuse the existing preview→commit internals with animation off; no new canvas API) — preserving undo/`restore` behavior exactly.
2. `fitView` the placed node (existing focus pattern).
3. Set `answer` to a short confirmation derived from the plan (e.g. "Added **Generate an image** — press Run when ready.", using the capability title; append the model's `message` if present). No proposal card, no Keep/Reject buttons.
4. Do NOT arm the run→look→fix review (nothing ran).

Else: existing flow, unchanged.

## 4. Out of scope / rejected / deferred

- **Rejected:** mode chip / selector in the prompt bar (this spec's predecessor). The Generate toolbar door keeps dropping bare nodes; no `GENERATE_OPTIONS` module is needed.
- **Deferred:** non-LLM instant path (client heuristic) — revisit only with evidence; latency is accepted for now.
- **Deferred:** homepage-card → prompt seeding; slash commands.
- **Never:** auto-run of billable nodes from any prompt path.

## 5. Testing

- Unit (vitest, `tests/unit/agent-fastlane.unit.spec.ts`): predicate truth table — single generator addNode ✓; single studio addNode ✓; single effect addNode ✗; addNode+connect pair ✗; single setWidget ✗; addNode with target ✗; empty ✗.
- e2e (Playwright): intercept `POST /api/agent-plan` with `page.route()` returning canned JSON — deterministic and free, no real model call:
  - canned single-addNode response → type in bar, submit → node appears with prompt widget filled, NO proposal card, nothing running;
  - canned two-command response (addNode + connect) → ghost proposal card appears as today (regression guard).
