# Four takes — the agent proposes four versions before committing to one

*2026-08-25. Designed live with Julien via the visual companion (mockups in
`.superpowers/brainstorm/17939-1787673779/`). Decisions his: system C (canvas-shaped,
in-studio first), staged diverge→converge, filmstrip with "yours" pinned first, two
explicit buttons. Approved: "go for it".*

## In simple terms

Today a "describe the look" request gets ONE guess. After this, it gets FOUR
genuinely different readings — each with a short angle label — rendered instantly as
thumbnails in a filmstrip under the studio preview, with the current version pinned
first as the anchor and instant undo. Hovering a take shows it full-size and the
control panel follows live; clicking selects; **keep** commits. Two buttons:
**↻ different directions** (four new interpretations) and **≈ variations of this**
(four parametric neighbors of the selected take — active only after a selection).
Every pick and rejection is logged from day one: the training data for future
personal-taste learning.

Milestone A (this spec's build scope, **amended during Task 4 — see below**): the
fast studios that describe through the vibe seam — **Gradient, Shader, Shape,
Vector Type**. Milestone B (later, separate plan): the same strip on the canvas
node at first-configure; 3D Studio when its 4-way render cost is measured.

### Amendment (2026-08-25, during Task 4): Pattern (Texture) is a follow-up

This spec was written believing all five studios' describe bars ran through
`useStudioAgent`/`useVibeControl`. Pattern's does not. It runs `useTextureAgent`
→ `/api/agent-plan` over a **structural command surface** (`setFillColor`,
`setFillGradient`, `linkFill`, … alongside `setParam`) — which is how "make the
ground a sunset gradient" works today. Scope item 1 added `variants` to
`/api/vibe`, whose vocabulary is flat parameter patches only, so routing
Pattern's bar through takes would silently cost it per-role fill editing: a
shipped capability traded for a filmstrip. Task 4 shipped the other four and
left Pattern alone rather than regress it (`.superpowers/sdd/task-4-report.md`
carries the full reasoning).

**The follow-up, which needs its own task and no server change:**
`/api/agent-plan` takes its schema and prompt from the CLIENT, so a multi-take
structural ask is a client-side build — a `buildTakesCommandSchema(commands)`
wrapper plus a takes-shaped parse in `lib/agent/protocol.ts`, takes carrying
`commands` instead of `changes`, each applied to a cloned `TextureState` through
the existing `applyTextureCommand`. `≈ variations of this` gates itself off for
command-only takes via the `canVary` prop the strip already has.

## Scope (Milestone A)

1. **Multi-take model call.** `/api/vibe` gains an optional `variants: N` (N=4)
   request field. Response schema (strict, like VIBE_SCHEMA): `{ takes: [{ label
   (≤24 chars), changes: [{key, value}], rationale }] }`, 2–4 takes. Absent
   `variants` → today's single-patch behavior byte-identical (back-compat pinned).
   Each take's changes validate/clamp through the existing validatePatch path.
   Guidance gains a SHARED prose block (all five studios): takes must differ on a
   NAMED dimension each (not numeric jitter of one idea); labels are angles, not
   descriptions; out-of-vocabulary looks label the closest take "closest: <look>"
   (rides the existing honesty clause).
2. **The filmstrip** — one shared component (`studio/TakeStrip.vue` or similar):
   "yours" tile pinned first + divider + up to 4 take tiles with labels; hover =
   live preview + panel follow (non-destructive: original config restored on
   unhover/dismiss); click = select; keep = commit via the studio's existing apply
   path + strip closes; dismiss = restore original; "yours" click = reselect
   original. Esc = dismiss. Strip state is per-studio-session, not persisted.
3. **Thumbnails**: per-studio `renderTakeThumb(config, size) → canvas/dataURL`
   adapters reusing each studio's EXISTING render machinery (they all have bake or
   preview paths); small (~160px), rendered async after the model call returns.
   A take whose render throws shows an error tile, never a blank strip.
4. **≈ variations of this**: NO second model call — parametric spread around the
   selected take: take the 2–3 keys the selected take changed most (relative to
   range), spread each ± around the picked values within clamps, seeded
   deterministic. Labels derived ("airier", "+/-" style is fine; honest generated
   captions, no fake AI prose).
5. **Pick logging**: every keep/dismiss/selection-switch appends an event
   `{studio, prompt, takeLabel, changes, action, ts}` to a bounded local store
   (localStorage ring buffer, ~500 entries, exported helper for the future taste
   consumer). No server, no PII beyond the prompt text the user typed.
6. **Wiring**: the four vibe studios' describe bars route through the same
   in-studio agent seam they use today (useStudioAgent/useVibeControl) —
   multi-take replaces the single proposal UI when variants come back;
   single-change flows (canvas tuneNode path) are UNTOUCHED this milestone.
   Pattern (Texture) describes through a different seam entirely and is a named
   follow-up — see the amendment above.

## Out of scope (recorded for Milestone B's plan)

Canvas-node strip at first-configure; Scene3D; touching the canvas tuneNode
protocol; model-generated near-variations; reading the pick log for
personalization; **Pattern (Texture) — structural multi-take, per the amendment
above**.

## Constraints

- Procedural render honesty: hover/full-size preview must render the take's REAL
  config through the live engine (no thumbnail upscaling lies).
- The existing single-tune path stays byte-identical when `variants` is absent —
  pinned by the studio-tune characterization specs.
- Guidance detector-test conventions apply (labels/keys resolve; shared block
  present in all five studios' prompts; size ceilings respected where they exist).
- Model: the vibe call stays on its current tier (Haiku) — four takes is a prompt
  change, not a model change; if take-quality is poor the eval harness pattern
  (paid, Julien-gated) decides any upgrade, not vibes.
- Component tests via the @vue/test-utils infra; per-studio adapter unit tests
  (render determinism, size, error tile); strip interaction tests (hover restore,
  keep commit, yours-undo, esc).
- Repo hygiene as this week: foreign WIP intact, own hunks, vue-tsc baseline, TDD.

---

## Addition (2026-08-25): Take promises — the model says what it did, we check the pixels

*Approved by Julien ("let's do 2") after the sideways-sunset report.*

### In simple terms

A take's rationale is prose: it can describe a sunset while the picture is a
rainbow, and nothing notices. So each take may now also carry a **promise** — two
or three claims about what its picture will LOOK like, in terms a machine can
measure. When the thumbnail lands we measure it. A direction that came out wrong
gets one local repair attempt; anything still off gets an honest label on the
tile. No second model call, ever.

This is the general safety net for the whole intent chain, not a fix for one bug:
the model can be wrong, the vocabulary can be missing a key, a preset can be
mis-aimed, a renderer can surprise us — and all of those end the same way, as a
picture that does not match what was claimed. It would have caught the sideways
sunset with no diagnosis at all.

### Scope

7. **Promise.** Each take may carry `promise: { colors?, direction?, tone? }` —
   at most three claims, only ever about what a still frame can show: one to
   three common colour words, a direction (`vertical` / `horizontal` / `radial` /
   `none`), and `dark` / `light`. Omitted when the model is unsure; a malformed
   promise is DROPPED and the take kept (never the reverse).
8. **Checkers.** Pure functions over the same 32² downsample the visual-diff
   guard already uses: a hue-bucket histogram for colours, row-vs-column mean
   change for direction (centre-vs-edge for `radial`, both-low for `none`), mean
   luminance with a dead zone for tone. A render that failed is *skipped*, never
   failed — no evidence is not a broken promise.
9. **One repair, then honesty.** A missed DIRECTION gets a single deterministic
   local repair: write the direction keys that studio actually offers, validated
   against the take's post-macro vocabulary, re-render, and keep the repair only
   if the check now passes — otherwise revert it whole. Colour and tone misses
   are never repaired: choosing a value the model did not ask for is inventing.
   Anything still failing gets `(differs)` appended to the tile, a console warning
   naming take/claim/measured, and `promiseResults` on the pick-log event.
10. **One suffix.** A take can be both degraded and mismatched; the tile shows at
    most one suffix, `(partial)` winning over `(differs)` — a take that lost half
    its changes is already saying the stronger thing.

### Out of scope

A second model call to re-ask for a take that failed its own promise; promises on
the single-tune path; anything the checkers cannot measure from a still (motion,
texture "feel", typography).
