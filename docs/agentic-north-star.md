# ComfyNext → Agentic: The North Star

*An AI agent that lives inside ComfyNext the way Cursor lives in code — a collaborator working in your file, not a chatbot beside it. It edits the recipe (params + structure), never pixels, so its moves compose and undo for free. You supply taste; it supplies leverage. The win is a tight propose→accept loop, not autonomy.*

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

## Current build status (2026-06-27) — pick up here

**Built on `main`, UNCOMMITTED (untracked files), all tests green + tsc-clean on new files:**
- F1 spine — `frontend/app/lib/agent/`:
  - `commandSurface.ts` — shared types (DescribedObject, CommandSpec, SurfaceSnapshot, Command, CommandResult).
  - `surfaces/smartLayout.ts` — `describeSmartLayout` (sections + elements + command catalog w/ hints) and `applySmartLayoutCommand` (ops: setSectionRegion, setText, group, ungroup, applyArchetype, setBrand, addChildToSection, internal restore). Pure, reversible (inverse per command), input-immutable (clone-at-top), validated (typed invalid/out-of-vocabulary).
  - `plan.ts` — `applyPlan` (runs a command list as one reversible batch; rolls back partials on failure).
  - `protocol.ts` — `buildCommandSchema` (constrains model `op` to the catalog), `buildAgentPrompt`, `parseAgentResponse` (args ride as JSON string).
- F2 seed — `frontend/server/lib/aiModels.ts` (AI_TIERS: patch=haiku, plan=sonnet-4-6, campaign=opus-4-8) + `frontend/server/api/agent-plan.post.ts` (thin model proxy, mirrors /api/vibe).
- Tests — `tests/unit/agent-smart-layout-surface.unit.spec.ts` (36) + `tests/unit/agent-plan.unit.spec.ts` (8, incl. a simulated end-to-end). Full suite 1309 pass; the only 2 failures (`spacetype-palette`) are pre-existing user WIP, not ours.
- Adversarially reviewed; immutability + validation holes fixed.

**Verified vs not:** client loop proven deterministically (simulated model). NOT yet run: full Nuxt typecheck (only scoped tsc), the live model round-trip (needs the user's Anthropic key), and any Vue-component test (no component test harness — verify via the app/Playwright).

**In progress — the last mile (option 1):** `AgentBar.vue` (the agent marker = VibeControlBar + the canonical `.pastel-hairline` / `--pastel-gradient`, idle muted → focus bloom) + `useLayoutAgent` composable (describe → POST `/api/agent-plan` → parseAgentResponse → applyPlan → Keep/Revert proposal) + mount in the Smart Layout editor. Marker + redesigned proposal block previewed as screenshots (scratchpad), awaiting final sign-off.

**Open design decisions (await user):** proposal-block redesign sign-off (new-value-primary, actions in footer, pastel identity; consider per-change accept à la Cursor); marker ring muted-until-focus vs always-on; "thinking" state = `gen-pastel` flow / glimm "citrus" sweep; button label "Ask" vs "Apply". Reuse `REGION_PASTEL` + `.pastel-hairline` is confirmed (the canonical AI style).

**Parked:** Mobbin MCP — added to config but needs a Claude Code restart to load; use it for design references once it's online.

**Backlog/tasks** (also tracked as session tasks #1–#7): F1 (active) · F2 (active, tier map seeded) · F3 hints · F4 postconditions · T1 expose Compositor · T1 expose Smart Layout (active) · T1 unhide Texture fills.
