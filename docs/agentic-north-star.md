# Sailor → Agentic: The North Star

*An AI agent that lives inside Sailor the way Cursor lives in code — a collaborator working in your file, not a chatbot beside it. It edits the recipe (params + structure), never pixels, so its moves compose and undo for free. You supply taste; it supplies leverage. The win is a tight propose→accept loop, not autonomy.*

Status: direction agreed, not yet building (as of 2026-06-27). This is the map; the foundations are tracked as tasks F1–F4 + Tier-1.

---

## Invariants (true in every phase)

1. **Collaborator in the file, not a sidebar.** Moves happen in your space, staged for approval.
2. **Params/structure, not pixels.** Edit the source of truth → composable, undoable.
3. **Human is the taste oracle; the machine is leverage on judgment.** Not autonomy — loop tightness.
4. **One agent, everywhere.** Not per-studio copilots; one agent addresses the document at any altitude.
5. **Ceremony scales to consequence (altitude legibility).** A slider nudge is silent and free; a 1000-asset campaign is previewed, costed, confirmed.
6. **One command layer drives both the UI and the agent.** Never two — agent and manual edits must compose.
7. **Perception/tuning is largely solved; composition is the frontier.** Invest there.

## The altitude ladder (the spine of the roadmap)

`Tune → Build → Compose → Campaign`. Each rung is a phase, a model tier, and a level of UX ceremony/cost.

---

## Phase 0 — Foundations (the ground the agent stands on)

The substrate every altitude rides on. Altitude-agnostic; everything depends on it.

- **Level 1 — Vue Flow as single source of truth.** Demote the LiteGraph iframe to hidden execution-only (`display:none`). ~Free. Gives one graph model, no bridge mutation actions, resolves the "which canvas is visible" question by fiat.
- **F1 — Unified command + describe surface.** Per-surface `describe()` (objects + current values + command catalog with arg-schemas/hints) and `apply(command)` (named, composable, invertible). Wraps existing headless functions; the arg-schema doubles as the structured-output schema (so the model can't emit out-of-vocabulary ops). Carries F3 and F4.
- **F2 — Model router + tier map.** Client sends an *altitude*; server maps altitude→model (Haiku/Sonnet 4.6/Opus 4.8); centralized IDs; `escalate` branch folded into the existing Haiku call (no extra round-trip for the common case).
- **F3 — Semantic hints.** Author `hint` metadata on controls/params so qualitative intent maps to operations. Highest translation-fidelity lever.
- **F4 — Postcondition / verification harness.** Assertions for verifiable intents (geometry, layout-fit) + render-thumbnail vision check-back for aesthetic ones. Converts silent mistranslation into caught failure.
- **De-risk:** run the intent-corpus test — measure real translation hit-rate per studio before committing depth.

**Unlocks:** everything.

## Phase 1 — Tune, everywhere

The agent adjusts what already exists, in every studio.

- **Build:** generalize Vibe (today Type-Studio-only) to all surfaces via F1; Haiku tier; structured-output patches; Keep/Revert chips; the persistent home bar.
- **Delivers:** "warmer, more bloom, tighter grid, bigger headline" — anywhere. Mostly exposing what exists.
- **Depends on:** F1, F2, F3.

## Phase 2 — Build, on one artifact (THE proof milestone)

The structural agent on a single canvas — the "Cursor moment."

- **Build:** Compositor + Smart Layout command surfaces (Tier 1); Sonnet planner tier; the **ghost-state propose→review→commit loop** (translucent proposals, partial accept, inverse-based undo); Smart Layout content-fill command; F4 verified moves.
- **Delivers:** "add a hero section, apply the brand, drop the logo top-left, adapt to portrait" — the agent makes structural moves you accept or reject.
- **Home:** Smart Layout (most headless) + Compositor (nearly all headless). **Not Type Studio** (per-effect, inert camera).
- **Depends on:** Phase 0 + Tier-1 exposures.

## Phase 3 — Compose, whole-document + the node canvas

Multi-object document work, node-graph chaining, and variation as a first-class move.

- **Build:** the canvas as a Vue-side `CommandSurface` (`addNode`/`connect`/`setWidget`/`spliceInto`, type-checked at command time, reusing the existing intent-search engine); Opus tier; the **branching UX** (a few live variants side by side, "this one but warmer," the tree of attempts).
- **Delivers:** "build this whole poster from the brief — give me three directions"; "chain an upscale + enhance after the studio output and run it."
- **Depends on:** Phase 2 + the canvas F1 surface.

## Phase 4 — Campaign (leverage at scale — the north-star demo)

One decision, rendered across a data table and every format.

- **Build:** un-park Variables/data-merge spine; Smart Layout internal auto-layout (the deferred piece, now load-bearing); fan-out across rows × formats; async/interruptible long runs with grounded progress; up-front cost confirmation against the wallet.
- **Delivers:** "here's a brief and a table of 12 products — build the campaign." (The World Cup north star.)
- **Depends on:** Phase 3 engine + data-merge + auto-layout.

---

## Cross-cutting threads (run through every phase, not a phase)

- **Trust spine:** altitude legibility (consequence-proportional ceremony), cost transparency/credits, sacred undo, confirmation gates on spend/publish/delete, graceful refusal/failure (incl. model refusal fallbacks).
- **Memory & context:** the agent works from the brand kit + project doc, says so, and learns the dialect from accept/reject history.
- **Presence:** the home bar + on-canvas cursor embodiment.
- **Translation fidelity:** F3 hints and F4 postconditions deepen continuously; re-run the intent corpus as coverage grows.

## Deferred / separate product calls (NOT on the agent critical path)

- **LiteGraph Level 2** — own the runtime: a Vue-native graph→prompt serializer + direct `/ws` + `/prompt`. ~2 weeks. `graphToPrompt` is the lone real dependency (everything else is already Nuxt-side). Do it for product reasons (kill cross-origin, lower run latency), not for the agent.
- **Type Studio structural substrate** — addressable camera/orbit, shared lighting rig, timeline. Lowest leverage; wrong place to prove structure.
- **Texture region/tile object model** — architectural; low priority.

## Critical path

`Level 1 + F1 → (F2/F3) → Phase 1 → Tier-1 surfaces + F4 + ghost-state → Phase 2 (proof) → canvas surface + branching → Phase 3 → data-merge + auto-layout → Phase 4`

## How we know each phase worked (the demo sentence)

- **P1:** "warmer" works in every studio.
- **P2:** the agent restructures one layout and you accept/reject the ghost. ← *the moment that proves it.*
- **P3:** the agent gives you three poster directions and chains nodes to render the winner.
- **P4:** a brief + a table becomes a finished multi-format campaign.

## Open risks to retire early

- Translation hit-rate per intent → run the corpus test (Phase 0).
- Auto-layout design → the long pole for Phase 4; prototype before committing.
- Branching UX weight → start with "show me 3," grow to the tree.
- Cost calibration → wire wallet/estimates before Campaign.

---

## UX / UI

**Master law:** *the agent's footprint on screen is a direct readout of consequence.* Invisible when stakes are low (a slider nudge), ceremonious when high (a 1000-asset run). This is altitude legibility, and it's the single principle the rest follows from.

**Visual language (reuse, don't invent):** white-opacity for agent chrome; **emerald reserved for Run / commit-of-a-spend**; **never purple**; glassy cards; pastel-hairline outlines for ghost + focus rings; the unified global slider for any agent-introduced before/after scrub; quick eased motion (cursor glide, ghost settle).

**Surfaces:**
- **The bar** — VibeControlBar evolved into a persistent, ⌘K-summonable command bar. Left: a *scope chip* (selection / studio / document — what it'll touch). Center: input. Right: an ambient *altitude glyph* (inferred, shown, overridable) + a cost hint only when it matters.
- **On-canvas presence** — a focus ring (pastel-hairline) on the object the agent is touching; an optional moving agent cursor as later delight.
- **Ghost-diff** — proposals render translucent + dashed (new nodes/sections/layers/wires); param changes show a before↔after scrub (unified slider) or A/B toggle; a compact "✓ Keep all (N) · ⌄ review" affordance + one-sentence rationale. Commit = ghost solidifies; discard = fades + replays inverse.
- **Branch tray** — for open-ended asks: 3–4 *live* variant thumbnails labeled by angle ("warmer/bolder/minimal"); click → becomes the canvas; refine → re-branches. Start light ("show me 3"), grow to a walkable tree later.
- **Run & progress** — flows through the existing Play/scope machinery; long/campaign runs get grounded counts ("47/72"), streaming partials, an Interrupt, and a walk-away completion toast.
- **Campaign pre-flight** — the only up-front gate: "12 × 6 = 72 assets · ~X credits · ~Y min" + sample preview + emerald Run.

**Ceremony by altitude:** Tune = no chrome, live + Keep/Revert. Build = thinking shimmer + on-canvas ghost + accept/reject. Compose = branch tray + "review N changes". Campaign = full pre-flight with cost confirmation.

**Trust surfaced:** cost only where it matters (never on Tune); confirmation gates only on spend/publish/delete; honest refusal/failure ("no camera-facing control — closest is X") instead of silent wrong applies.

**Taste forks (recommended picks):** home surface = evolve VibeControlBar into a persistent summonable bar; altitude = ambient-with-override (not a manual mode switch); branching = light tray first; embodiment = focus-rings first, moving cursor later.

---

## Current build status (2026-06-28) — pick up here

The Smart Layout agent is **live end-to-end** (user-confirmed working in-app). Phase 0
foundations are done and Phase 2's proof milestone is achieved on Smart Layout. All
client-side; full suite green (~1392 pass; the only 2 failures are pre-existing
`spacetype-palette` user WIP). UNCOMMITTED on `main`.

**Phase 0 — Foundations: DONE.**
- **F1** ✅ `frontend/app/lib/agent/` — `commandSurface.ts`, `surfaces/smartLayout.ts` (full verb set, see below), `plan.ts`, `protocol.ts` (now non-strict + tolerant parse + a `message` refuse/answer channel + a `reasoning` field).
- **F2** ✅ `server/lib/aiModels.ts` + `server/api/agent-plan.post.ts` (non-streaming, strict json_schema) + `server/api/agent-review.post.ts` (multimodal visual review).
- **F3** ✅ rich hints on every command; **standard = the vocabulary must cover what the RENDERER accepts** (not the inspector — that gap caused the gradient/grid/brand misses).
- **F4** ✅ `frontend/app/lib/agent/verify.ts` — deterministic postconditions (off-canvas, contrast, narrow-headline, palette/type-size restraint, hierarchy, all-centred) **+ visual self-review** (render via `/api/render-template` → `/api/agent-review` vision critique → self-correcting fix commands appended to the proposal).

**Smart Layout verb set (`applySmartLayoutCommand`):** setText, setTextColor, setElementStyle, setElementProps, addElement, removeElement, reorderElement, setSectionRegion, setSectionProps, group, ungroup, applyArchetype (remaps coarse→fine grid), setBackground (colour/gradient/image), setBrand, addFormat, removeFormat, setGrid, setTypeScale, generateImage, removeImageBackground, editImage, restore (internal). All reversible, immutable, validated.

**Phase 2 — proof milestone: ACHIEVED on Smart Layout.** `useLayoutAgent` + `AgentBar`/`AgentProposal`/`AgentProgress`/`AgentSweep` in `GridEditorShell`. Ghost propose→review→commit with per-change accept/reject/**reroll** (intent-preserving), inverse undo, generative content, rotating progress, glimm sweep, honest refusal/answer.

**Beyond the plan (built this session):**
- **Swiss design system** — `frontend/app/lib/agent/designPrinciples.ts` (`SWISS_DESIGN_PROMPT` generative) + verify.ts checks (`SWISS_LIMITS`). Doc: `docs/agent-swiss-design.md`. The agent composes in International Typographic Style by default.
- **Visual self-review** — the first of the design-learning loops (preference-memory, exemplars, failure→check ratchet still to come).
- **Unified panel UI** — glassy `StudioSection`/`glass-panel` look + a shared panel type scale (`.panel-heading/label/value/sublabel/help` in `main.css`) across studios / Compositor / Smart Layout.

**DONE since (this session, all on `main`, suite ~1433 pass + same 2 pre-existing):**
- **T1 Compositor** ✅ `surfaces/compositor.ts` + `useCompositorAgent` + UI mount + visual-review parity (client-side `paintLayerStack` render → `/api/agent-review`).
- **Phase 1 Tune-everywhere** ✅ generic `useStudioAgent` in Type/Gradient/Shader/Texture (Gradient/Shader via the `lib/agent/configParams.ts` dotted-path bridge over their nested `config` ref).
- **T1 Texture (fills)** ✅ `surfaces/texture.ts` + `useTextureAgent` — STRUCTURAL (per-role fills + tune), replaces the tune agent in that studio.
- **Visual self-review on ALL studios** ✅ extended to Texture/Gradient/Shader (Gradient/Shader via an optional review path added to `useStudioAgent`).

**Phase 3 — SCOPED 2026-06-28 (`docs/agent-canvas-surface-scope.md`).** Two code audits **overturned the stale "canvas is the laggard" finding**: the app is now **Vue Flow native** (`VueNodeCanvas.vue`/`useVueNodes.ts`) — every graph mutation (add/delete/connect/disconnect/`setNamedWidget`/splice/move/dup/mute/run-filtered) is LIVE from Vue; node-discovery infra (`/object_info` cache, `nodeMatch`/`nodeKeywords`, `portIntentCatalog.buildCatalog`, `portIntent`) already exists. So Phase 3 = a describe+command+validate layer (like the studio surfaces) + two new pieces: **plan-then-materialize** lifecycle (graph mutations aren't pure JSON; `$newN` placeholder-id resolution at Keep) and a **canvas home** for the bar (⌘K palette). Build order: Slice 0 (explain graph, read-only) → Slice 1 (edit existing nodes) → **Slice 2 add+wire = canvas proof milestone** → S3 subgraph build → S4 run-in-loop. No bridge work; Level 2 is effectively already done.

**NEXT:**
- **Phase 3 Slice 0/1** — read-only graph Q&A, then single-op edits (low risk, hardens describe + validation for Slice 2).
- **Learning loops** — preference memory (persist accept/reject), exemplar library, failure→check ratchet.

**Verified vs not:** Smart Layout + Compositor agents confirmed live in-app. Studio tune + Texture structural + visual-review NOT yet user-verified live (scoped tsc only, suite green). Phase 3 is scoped only — not started.
