# Critique fix chips — the reviewer injects paid-fix chips into the next-steps strip

**Date:** 2026-07-02 · **Status:** approved design (Approach A), pre-plan
**Context:** ARPU lever 4's remainder ([pricing §6](2026-07-01-costs-and-pricing-model.md)); extends the chip strip shipped in [artifact-generator-actions](2026-07-02-artifact-generator-actions-design.md). The run→look→fix reviewer already finds defects and builds repair commands ([useCanvasAgent.ts](../../../frontend/app/composables/useCanvasAgent.ts) `runReview`); today they surface only as Keep/Dismiss cards in the agent bar. This gives them a second, artifact-anchored surface: contextual chips like **⚠ Fix hands · ~$0.12** that appear on the render itself.

## Decisions (user-approved)

- **Trigger:** auto-review runs when a fresh take lands on an image artifact whose direct upstream producer is a *paid* generator (has a `priceBadge` on its node data). Free/local outputs never auto-review. Manual Fix and Keep & Run reviews are unchanged.
- **Approach A:** reuse the existing ProposedChange pipeline — no second fix-builder. Chips map 1:1 to the review's built `fromReview` changes.
- **Surfacing split:** auto-review results render as chips ONLY (no agent-bar cards, no "✓ looks right" answer). Manual/Keep&Run reviews keep today's card UI untouched.
- **Click = aim-first:** a chip click applies exactly that one fix change — the pre-configured Nano-Banana `EditImageNode` lands spliced after the artifact, focused, un-run. No auto-billing.

## Data flow

1. `ArtifactImageNode`'s existing fresh-take watcher additionally dispatches `comfynext:autoReview { nodeId, takeId }` (fires alongside `announceFreshTake`).
2. `CanvasPromptBar` (owner of `useCanvasAgent`) listens and gates: skip when the artifact's producer isn't paid, when `reviewing`/`busy`, or when this take was already reviewed; 3s debounce per node so a Variations ×4 burst reviews only the settled state. Then calls `runReview([nodeId], intent, { auto: true })` with the same intent source the Fix action uses (`vueCanvas.agentNodeIntent?.(nodeId)`).
3. `runReview` in auto mode: on completion, instead of populating `changes` (bar cards), publishes to the strip: `useNextStepsStrip().announceFixes(nodeId, chips)` where each chip is `{ id, label, hint, change }`. Zero issues → publish nothing, silently.
4. `NextStepsStrip` renders fix chips styled with the translucent pastel gradient (the `gen-pastel` idiom the Edit… button uses — pastel = AI-powered in this app's design language) ahead of the standard dark suggestion chips. Fix chips are **sticky**: exempt from the 12s auto-dismiss (reviews arrive ~10s after render by nature); cleared on click, explicit dismiss, or a newer take on that node.
5. Chip click → `applyReviewFix(change)` on the agent composable: applies that single change's command to the canvas through the existing keep machinery (splice lands configured + focused, un-run), then clears that node's fix chips.

## Component changes

- **`lib/agent/protocol.ts`** — review schema gains a short `label` (2–4 words, imperative: "Fix hands", "Clean up text") per fix; `parseReviewResponse` returns `fixLabels: string[]` (fallback when the model omits it: first 30 chars of the rationale).
- **`composables/useCanvasAgent.ts`** — `runReview(targets, intent, { manual, auto })`: auto mode skips `changes`/`answer` population and publishes chips; new `applyReviewFix(change: ProposedChange)` applies one change (reuses the internals `keep()` uses on a single command). Chip hint: `ACTION_HINTS['nano-banana']` when the fix adds an `EditImageNode`, `null` otherwise (widget/seed fixes have no fixed price).
- **`lib/artifact/nextSteps.ts`** — pure `paidProducerFor(nodeId, nodes, edges): boolean` — walks the artifact's direct image-input edge to its source node and checks `data.priceBadge`. Unit-tested.
- **`composables/useNextStepsStrip.ts`** — second channel: `fixes: Ref<{ nodeId, chips } | null>` with `announceFixes` / `clearFixes`; `announceFreshTake(nodeId)` clears stale fixes for that node. Strip visibility for a node = generic-active OR has-fixes.
- **`components/vue-canvas/NextStepsStrip.vue`** — renders fix chips before the standard chips: translucent `gen-pastel` gradient background with dark text (mirroring the Edit… button's treatment at chip scale), Sparkles-style lucide icon; fix chips ignore the auto-dismiss timer (timer only clears the generic chips).
- **`components/agent/CanvasPromptBar.vue`** — the `comfynext:autoReview` listener with the gating described above; needs edges for `paidProducerFor` (expose `getEdges()` from VueNodeCanvas if not already exposed).
- **`components/vue-canvas/ArtifactImageNode.vue`** — dispatch `comfynext:autoReview` in the takes watcher; strip render condition includes the fixes channel.

## Edge cases & errors

- Review API failure in auto mode: silent (console only) — never toast a background process.
- Artifact deleted mid-review: `announceFixes` for a node id that no longer exists is harmless (strip renders per-node); `applyReviewFix` on a stale change no-ops with a console warn.
- Review returns only non-EditImage fixes (e.g. a seed re-roll for a fundamentally-wrong image): still chip-able — label from the schema ("Re-roll — wrong subject"), no price hint.
- The reviewer's one-at-a-time guard means overlapping renders on different nodes queue naturally: the debounce re-fires; if a review is in flight, that node's event is dropped (next take re-arms). Acceptable v1 looseness — noted, not solved.

## Out of scope

- Auto-review opt-out UI (revisit when billing lands; it's the user's own API key today).
- Reviewing video artifacts, frames, or studio exports.
- Auto-running the fix (would bill without aiming — against the trust wedge).

## Testing

- Unit: `paidProducerFor` (paid, free, no-upstream, multi-input); `parseReviewResponse` label extraction incl. fallback; strip fixes-channel state machine (announce/clear/fresh-take-clears/dismiss).
- Live: paid render → scanning overlay → chips appear with labels + hint; click spawns configured EditImageNode un-run; new render clears stale chips; free local render never triggers a review call.
