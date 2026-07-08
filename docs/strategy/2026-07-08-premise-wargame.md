# Gaming the premise — gap-score, wargame, roadmap

**Date:** 2026-07-08
**Premise under test:** *"A creative canvas to explore, transform and produce, with AI to accelerate your creativity and productivity at the speed of thought."*
**Purpose:** both product prioritization and positioning narrative — the roadmap should be the set of things that make the premise defensibly true; the story falls out of it.

---

## 1. The premise, decomposed

The sentence makes six falsifiable claims:

| # | Claim | What it promises |
|---|-------|------------------|
| 1 | "a creative canvas" | The surface feels like a creative tool — spatial, direct, playful — not an engineering diagram |
| 2 | "to explore" | Divergence is cheap: variations, comparisons, happy accidents, branching without fear |
| 3 | "transform" | Anything on the canvas can become anything else — no dead ends |
| 4 | "and produce" | It converges to real deliverables — formats, campaigns, consistency, volume |
| 5 | "AI to accelerate" | AI woven into the flow, not a chatbox bolted on |
| 6 | "at the speed of thought" | The loop from impulse → result is fast enough that you don't lose the thought |

## 2. Gap-score: Sailor today (July 2026)

| Claim | Score | Evidence |
|-------|-------|----------|
| Transform | **8.5/10** | Strongest claim. Restyle-w/-LoRA, relight, person/product/background swap, enhance-detail, Lens/DoF, 33 shader effects, ~20 Type Studio effects, pattern/texture/gradient studios, compositor warps/fills, critique-repair loop, turntable, lipsync. Field-best verb density. |
| AI acceleration | **7.5/10** | Canvas agent w/ fast-lane auto-place, vibe control, critique fix chips, copy assistant, aesthetic auto-fill, image search; legible design language (pastel = AI). Gap: accelerates placement/setup more than judgment. |
| Creative canvas | **6.5/10** | Frame near-Figma on basic actions; Smart Layout on-canvas editing. But core surface = LiteGraph in a cross-origin iframe — two canvases wearing a trenchcoat. |
| Produce | **6.5/10** | Smart Layout formats + brand kits + variables/collections/data-merge/lookup; character library. @refs specced-unimplemented; video/shorts unspecced; batch volume partial. |
| Speed of thought | **5/10** | Split personality: WebGL studios ARE realtime/local/free; the AI loop is dispatch-and-wait cloud latency with no draft tier. |
| Explore | **4/10** | Weakest claim. No draft mode, takes-compare, promote, moodboard, or branching. Every generation full-price, full-latency — credits are a psychological brake on divergence. |

**Headline:** Sailor today is a **produce/transform** tool marketing itself with an **explore/speed** sentence. The two lowest scores are the two words at the front of the premise — and exactly what the sketchbook-loop and moodboard epics attack.

## 3. Wargame: the field (researched July 2026)

### Clause ownership

★★★ = owns it · ★★ = credible · ★ = weak

| | Canvas | Explore | Transform | Produce | Speed |
|---|---|---|---|---|---|
| Krea (30M users) | Nodes + realtime | ★★★ | ★★ | ★ | ★★★ |
| Magnific/Freepik ($230M ARR) | Spaces, multiplayer | ★ | ★★ | ★★★ | ★ |
| Flora ($42M A) | Branching + FAUNA | ★★★ | ★ | ★★ | ★★ |
| Figma Weave | Node graph + pro edit | ★★ | ★★★ | ★★→★★★ | ★★ |
| Recraft | Studio canvas, chat | ★★ | ★★ | ★★★ | ★★ |
| ComfyUI ($500M val) | 60k nodes | ★ | ★★★ | ★★ | ★ |
| Higgsfield ($500M run-rate) | Linear workbench | ★ | ★ | ★★★ | ★★ |
| Firefly Boards | Ideation board | ★★★ | ★ | ★ | ★★★ |
| **Sailor today** | Node + Frame hybrid | **★** | **★★★** | **★★** | **★★** |

### Key competitor facts (2025-Q4 → 2026-Q2)

- **Krea** — March 2026 redesign; Nodes + Node Agent (sentence → wired pipeline); Krea 2 foundation model (May 2026, Turbo open-weighted, 2K in ~2s); realtime canvas <50ms + iPad Voice Mode; 30M users; $47M B @ $500M. Owns explore+speed; output is generations, not artifacts.
- **Magnific (ex-Freepik)** — rebranded Apr 28, 2026 at $230M ARR, 1M paying subs, profitable/bootstrapped; Spaces = node canvas w/ realtime multiplayer + Workflow Apps (graph → one-block tool); enterprise push (BBC, Puma, Amazon PV). Owns produce; weak explore.
- **Flora** — $42M Series A (Redpoint, Jan 27, 2026); Nike/Netflix/Pentagram; branching canvas + Techniques (pro-authored reusable workflows) + FAUNA agent (builds node workflows live, anti-homogenization "multiplier of taste" positioning, ~Apr 2026). Owns explore; transform nascent (editing on roadmap).
- **Figma Weave (ex-Weavy)** — acquired Oct 30, 2025 (~$200M reported; founders ex-Fiverr); node graph + real pro editing in-graph (relight, z-depth, inpaint, channels, outpaint); workflow → packaged mini-tool distribution; Config 2026 (June): 20+ Weave tools inside Figma Design; "Figma node" (live frames as workflow inputs) announced for late summer 2026. Separate product, separate credits — fragmented for now. The existential competitor.
- **Recraft** — V4 (Feb 2026), V4.1 Utility Pro #3 on image arena (May 2026); pivoted from model-house to aggregator studio (20+ video models); Chat Mode in canvas; vector remains the moat. Owns produce for brand/vector; no node graph, no compare primitive.
- **ComfyUI / Comfy Org** — $30M @ $500M (Apr 24, 2026); Comfy Cloud paid credits (Dec 2025); subgraphs GA; **Nodes 2.0 beta moves node rendering LiteGraph → Vue**; ecosystem churn (custom-node breakage anger, issue #11356). Owns transform; canonical speed-of-thought failure.
- **Higgsfield** — $1.3B val (Jan 2026), $500M annualized rev (June 2026), 5M videos/day, ~70% enterprise; linear production workbench for social ads. Fastest commercial momentum in the space.
- **Adobe Firefly Boards** — GA Sept 24, 2025; multiplayer ideation canvas, partner models, 2026 Ps/Lr two-way handoff. Explore-strong; hands off rather than finishes.
- **Runway Workflows** (Oct 2025, node pipelines, enterprise; $315M E @ $5.3B), **fal** ($4.5B+, the infra everyone rents), **OpenArt** (~$20M ARR, One-Click Story), **Glif** — **deleted its node editor March 24, 2026**, relaunched chat-agent-only. The field's proof that raw node graphs don't survive consumer contact.

### Three verdicts

1. **"A creative canvas" is no longer a differentiator — it's the genre.** In nine months Krea shipped Nodes, Freepik made Spaces the flagship, Figma bought Weavy, Runway shipped Workflows, ComfyUI started moving to Vue. Canvas shape = table stakes. Glif's retreat = the warning: the graph must be progressively disclosed.
2. **Nobody holds the whole sentence — everyone holds one clause.** Krea explore+speed but can't produce; Magnific/Recraft/Higgsfield produce but can't explore; Flora explores but barely transforms; ComfyUI transforms but flunks speed. Closest to two clauses: Figma Weave. **The premise is a conjunction claim: defensible only if the whole loop lives on one canvas. That is genuinely unclaimed.**
3. **The field-wide white space is exactly Sailor's specced-but-unshipped work.** Across all eight players: no verified draft/final quality toggle, no takes-snapshot-promote loop. Everyone meters every exploration step at full price (Krea substitutes realtime; Weave's side-by-side model compare is the field's best answer). The sketchbook loop is differentiation, not catch-up. Structural weapon nobody shares: **Sailor runs locally and its studios are free realtime WebGL. "Exploring is free — you pay when you produce" is a sentence only Sailor can say.**

## 4. Roadmap (ranked: premise-gap × defensibility)

1. **Ship the sketchbook loop** (specced) — closes the two lowest scores; lands in verified white space. Light-table takes-compare should explicitly beat Weave's model-compare.
2. **Make "free exploration" the economics, not just a feature** — draft tier = schnell/local/WebGL = free or near-free; metered only on promote/final. Converts the credit-brake into the positioning weapon. Field-unique.
3. **Moodboard node** (next epic — confirmed by the data): Firefly Boards + Flora's Mood Board Maker prove demand; on-canvas-with-output-ports differentiates — theirs are dead-ends that hand off, ours feeds the graph.
4. **@refs / named references** (specced) — produce-consistency gap; analogs: Flora Character Lock, Recraft brand styles; in-graph binding is stronger.
5. **Workflow packaging** — new gap surfaced by the wargame: Krea, Magnific, and Weave all publish a graph as a one-block reusable tool. Sailor has subgraph-shaped pieces but no packaging story. Table stakes for "produce" by 2027.
6. **The substrate seam / LiteGraph divorce** — see appendix. Upgraded from watch-item to recommended background track.

**Named deferrals:** multiplayer (team-produce feature, big lift), agent-builds-graph-live theatrics (FAUNA/Node Agent parity later), realtime <1s generation (Krea's crown; local-first architecture leaves the door open via open-weight turbo models — future epic).

## 5. Post-roadmap ranking (everything above shipped)

| | Explore | Transform | Produce | Speed | Conjunction? |
|---|---|---|---|---|---|
| **Sailor (post-roadmap)** | ★★★ | ★★★ | ★★½ | ★★½ | **Yes — only one** |
| Krea | ★★★ | ★★ | ★ | ★★★ | No — dies at produce |
| Figma Weave (+Figma) | ★★ | ★★★ | ★★→★★★ | ★★ | Closest second |
| Flora | ★★★ | ★ | ★★ | ★★ | No — can't transform |
| Magnific | ★ | ★★ | ★★★ | ★ | No — can't explore |
| Recraft | ★★ | ★★ | ★★★ | ★★ | No |
| ComfyUI | ★ | ★★★ | ★★ | ★ | No |

Why not straight ★★★: speed stays ★★½ because Krea's <50ms realtime loop is categorically different from "fast draft dispatch"; produce stays ★★½ because Magnific has stock+multiplayer+enterprise, Recraft has production vector, Higgsfield has $500M of proven ad output — Sailor would have the best *in-canvas finish*, not the best production *operation*.

**Head-to-heads:**
- **vs Krea:** they win the first 60 seconds; Sailor wins everything after — idea → finished brand-consistent artifact without leaving. Different halves of the funnel.
- **vs Flora:** post-sketchbook, Sailor matches their explore mechanics and dwarfs transform+produce. Their edges: multiplayer, FAUNA taste story, brand cachet.
- **vs Figma Weave — the real fight.** Only other player aiming at the conjunction, with Figma's distribution. Sailor's durable edges: transform depth, free-exploration economics (structurally unavailable to them — they rent every model), draft/promote loop, ONE canvas (Weave is fragmented: separate product, separate credits). Their edge: the industry already lives in Figma. Capability #1 vs distribution #1, on roughly a 6–12 month fuse.
- **vs Magnific / Higgsfield / Recraft:** different segments (team volume ops, ad factories, vector/brand systems). Don't fight there.
- **vs ComfyUI:** Sailor = what Comfy Cloud is trying to become UX-wise, minus the 60k-node ecosystem — a conscious trade.

**Gaps no amount of this roadmap closes:** (1) **distribution** — the ranking that matters most and the one this exercise can't fix; (2) **multiplayer/teams**; (3) **realtime**; (4) **ecosystem network effects** (Techniques / Workflow Apps / Community workflows accumulate third-party content; packaging gives the primitive, community is a different project).

## 6. Positioning that falls out

Structure the story as: *every other tool makes you choose a clause.* Proof points in order of uniqueness:

1. Transform depth spanning generative **and** deterministic/design-grade tools — no dead ends, nothing leaves the canvas.
2. The only node canvas that ends in a finished, brand-consistent deliverable (Smart Layout + brand kits + data merge) instead of handing off.
3. Exploration that costs nothing (local + WebGL + draft tier).

"Speed of thought" stays in the sentence but must be **earned by the draft tier** before it goes on a landing page — today Krea owns that phrase.

---

## Appendix: the LiteGraph divorce

### Finding: ~80% divorced already

With VueNodes on (default), users never touch LiteGraph: rendering, pan/zoom, selection, link-drag, widgets, groups, save/load are all Vue Flow (118 components in `vue-canvas/`). The iframe sits hidden at opacity-0 doing four jobs: (1) `graphToPrompt()` at run time, (2) `queuePrompt()` + validation-400 capture, (3) WebSocket progress relay, (4) the VueNodes=false legacy fallback. The bridge (1,469 LOC, 45 postMessage types) registers no node types and no Python routes — pure glue. Workflows persist as LiteGraph-native JSON in ProjectDoc (keep this: free ComfyUI compat), round-tripped via `convertToLiteGraph()`/`convertFromLiteGraph()` in `useVueNodes.ts`.

### The one hard piece

A TS prompt builder replacing `graphToPrompt()`: widgets_values (positional) → named inputs via object_info ordering; converted widget↔input slots; mute(2)/bypass(4) rerouting; subgraph flattening (`definitions.subgraphs`); `control_after_generate` seed mutation timing. Verify: `gate_paused` mechanism, image-upload flows.

### Plan (each phase shippable; demolition last and only irreversible step)

0. **Spikes (a day each):** how `gate_paused` works in the bridge; Vue Flow perf on heaviest ProjectDoc + one 300-node imported monster.
1. **`lib/graph/graphToPrompt.ts`** + golden-workflow unit tests (10–15 real ProjectDocs → snapshot prompts).
2. **Shadow parity harness:** every dev run builds the prompt both ways (new builder vs bridge `prompt_data`), diffs JSON, logs divergences. Dogfooding = free verification.
3. **Direct execution channel:** frontend owns client_id, opens WS to `:8188/ws` (via proxy — allow-list gotcha now helps), POSTs `/prompt` directly. Flip run path.
4. **Demolition:** remove iframe mount, delete bridge.js, rip 35 `sendToActiveProjectIframe` call sites in `default.vue`, kill VueNodes=false fallback + toggle.

### Downsides (ranked)

1. **Sole ownership of execution semantics, forever** — upstream serialization/execution evolution must be tracked manually; parity tests become a subscription, not a one-time cost.
2. **Custom-node long tail narrows** to node types with Vue renderers; custom-JS-widget packs lose their (fallback-only) escape hatch. Product identity answer: Sailor is a creative product using ComfyUI as render server, not a ComfyUI skin — this was decided implicitly months ago (frontend-only node types already exist). Diagnostic hedge: raw ComfyUI stays reachable at :8188.
3. **Vue Flow perf on large graphs** (DOM-per-node vs LiteGraph's single canvas) — spike before demolition; fixes are virtualization/LOD.
4. **Fat-tailed estimate** — gate_paused, uploads, subgraph flatten, seed timing.
5. **Opportunity cost** — mitigated by running as background track behind sketchbook.

### Recommendation: YES, with sequencing condition

Sketchbook loop stays the main track; divorce runs behind it (spikes → Phase 1+2 interleaved → flip/demolish after the harness is quiet 1–2 weeks). The harness soaks *during* sketchbook dogfooding — the feature that multiplies run frequency also stress-tests the new run path.

### Does the divorce help the ranking?

Not as a clause of its own — it ships no user-visible capability — but it's the enabler of the two scores that otherwise stay capped:

- **Speed:** removes the reload-then-queue iframe round-trip taxing every run, exactly when the sketchbook loop multiplies run frequency. Draft mode ships the speed story; the divorce removes its floor.
- **Canvas:** dissolves the trenchcoat seam — claim #1 goes from 6.5 to ~8.5.
- **Future realtime (gap #3):** a realtime local path (open-weight turbo models à la Krea 2 Turbo) is only plausible with frontend-owned dispatch — impossible through the hidden-iframe hop.
- **Risk:** exits the upstream Nodes 2.0 churn storm; dependency shrinks from ComfyUI frontend internals to the stable server HTTP API.

---

*Research: 4 parallel web-research agents, July 7-8, 2026. Primary sources include PRNewswire/Fortune (Magnific rebrand), TechCrunch (Flora, Weavy, Higgsfield, Runway), Figma blog (Weave, Config 2026), Comfy Org blog (Cloud, Nodes 2.0, funding), Krea blog (redesign, Krea 2), Recraft press releases. Pricing/model lists from vendor sites + third-party trackers, may drift. Codebase recon: 2 parallel explore agents over `vue-canvas/`, `useVueNodes.ts`, `bridge.js`, `default.vue`, `projectDoc.ts`.*
