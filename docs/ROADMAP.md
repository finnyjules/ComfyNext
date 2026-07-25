# Roadmap — Sailor

*Last revised: 2026-07-25. Companion to [VISION.md](VISION.md) and [STATE.md](STATE.md).*

Three acts. Each is sequenced because it de-risks the next.

**Product wedge (from the demand evidence):** motion. Making designed/generated content *move — controllably, on-brand, at multiple sizes* — is the loudest verified demand signal and where incumbents are weakest. When a studio or capability can be prioritized by whether it sharpens the motion wedge, it should be.

**The bar everything is measured against:** reliability. 62% of designers name inconsistent output as their #1 reason AI tools don't stick. Sailor's procedural substrate is deterministic *by construction* — that's the edge — but the agent driving it is where inconsistency creeps back in. Every act below is only "done" if the agent drives it *reliably*, not just plausibly.

---

## Act 1 — The Factory

**Goal:** one declarative parameter schema per surface, from which the inspector UI, agent control descriptor, motion tracks, and Collection sweep bindings are all *derived*, never re-declared.

Why first: it changes the cost of everything after it. The pattern already exists in the repo — a Shader Studio effect uniform costs one manifest entry and gets all four capabilities free; a Gradient Studio parameter costs seven declaration sites and can't be animated at all. `ControlSpec` (in `lib/spacetype/effect.ts`) is already the convergence type for all four descriptor producers; the work is making it the source instead of a fourth restatement, and adding what it lacks: animatability metadata and path-based writes.

**Open decision (paused 2026-07-25):** how to scope the first proof.

1. **Staged — cheapest new target first** *(current recommendation)*: design the schema against one data-driven surface (numbers in, pixels out, drops straight into the existing bake cascade — e.g. a Field/Noise or Voronoi studio). Prove one-declaration end to end, then extend.
2. **All three stressors up front**: define schema + runtime contract + ports + output types before building any surface.
3. **Retrofit Gradient first**: collapse its 7 declaration sites to 1, delete ~500 lines of inspector markup, make its params animatable for the first time. Highest-confidence proof, zero new material.

**Done when:** a new studio built through the factory ships with inspector, agent controls, motion, and sweeps generated from a single declaration — and one legacy studio has been retrofitted to prove the schema fits real complexity.

---

## Act 2 — Absorption

**Goal:** use the factory to absorb the three chosen technology families. Each one deliberately stresses the factory in a different place — that's the point.

| Family | Stressor it adds | First candidates |
|---|---|---|
| **Data-driven form** | a data input port (Collection half-solves it) | simplex-noise fields, d3-delaunay/Voronoi, d3-force |
| **Physics / simulation** | a simulation runtime contract (step, seed, determinism for bakes) | Matter.js, boids, reaction-diffusion (GPU) |
| **Vector + variable type** | geometry-out surfaces (bake cascade assumes pixels) | fontkit variable axes, marching-squares → paths, potrace |

Ordered cheapest-stressor first. The full candidate list, with cost estimates, lives in the shortlist (memory: `creative-library-shortlist`).

**Done when:** at least one surface from each family is live, factory-built, and agent-drivable on day one.

---

## Act 3 — Reach, Delivery & Distribution

**Goal:** pay down the debts the factory doesn't fix by itself, plus close the one strategic gap the mid-2026 landscape exposed.

- **Agent reach:** retrofit control descriptors across the existing surfaces the agent can't see — Scene3D (4.3k lines, agent-invisible today), Shape, Shot Director, Timeline, LipSync. Target: every surface in [STATE.md](STATE.md) shows agent-legible ✅.
- **Delivery spine:** one render/export path. Today: four independent export paths, JSZip implemented twice, ~40 ad-hoc `a.download` handlers, and a "Ready to deliver" shelf that only re-packages existing files. WebCodecs is the likely backbone and doubles as a new-tech absorption.
- **Distribution / shareable artifacts *(new — landscape-driven)*:** Sailor has no sharing story. The mid-2026 research found shareable workflow artifacts becoming the category's distribution moat — Figma opened Community publishing for Weave workflows. Sailor's equivalent is the studio, the taste profile, and the sweep: things worth sharing that also pull others into the tool. Scope is TBD; the point is that "an island with no export-to-community path" is now a named risk, not an oversight.

**Done when:** the agent can drive any surface, any artifact renders + delivers through one pipeline, and at least one Sailor-native artifact (a studio preset, a taste profile) is shareable.

---

## Sequencing logic

Factory → Absorption → Reach. Building absorption before the factory recreates the 7-declaration problem at scale. Doing reach retrofits before the factory means hand-writing descriptors that the factory would have generated. Delivery last because it's a quality debt, not a capability gate — nothing in Acts 1–2 depends on it.
