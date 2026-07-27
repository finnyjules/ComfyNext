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

**Shader as Fill — LANDED 2026-07-26, user-confirmed in the app.** Reached "landed" the hard way: three whole-branch review rounds each returned *not ready* and each found real defects, including a catalog race that made two surfaces silently render a fallback gradient forever. All closed across three fix waves; Julien then confirmed it working in the real app. Derived keys are `fill.shader.params.<paramId>`, not the `.p.` form written below — `.p.` addressed a phantom object and was a genuine bug. See `docs/STATE.md` for the full status and the gaps still open. A third proof, and the one that stress-tests the factory hardest so far: it turns the 63-effect shader catalog into a legal `FillType`, multiplying it across every fillable surface (Space Type, Shape Studio, frames, Scene3D object-anchor) instead of adding one more surface. It is also the first place the control schema meets genuinely *dynamic* vocabulary — 63 effects, each with a different param list, can't use frozen `ControlSpec` keys the way Gradient/Shape do. The answer, **declare the frame, derive the contents** (three frozen keys — `effectId`/`anchor`/`speed` — plus per-effect derived `fill.shader.p.<paramId>` keys), is the pattern every future absorbed library with per-item variable schemas will need. Full report: `.superpowers/sdd/saf-task-10-report.md`; design: `docs/superpowers/specs/2026-07-26-shader-as-fill-design.md`.

---

## Act 2 — Absorption

**Goal:** use the factory to absorb the three chosen technology families. Each one deliberately stresses the factory in a different place — that's the point.

| Family | Stressor it adds | First candidates |
|---|---|---|
| **Data-driven form** | a data input port (Collection half-solves it) | simplex-noise fields, d3-delaunay/Voronoi, d3-force |
| **Physics / simulation** | a simulation runtime contract (step, seed, determinism for bakes) | Matter.js, boids, reaction-diffusion (GPU) |
| **Vector + variable type** | geometry-out surfaces (bake cascade assumes pixels) | fontkit variable axes, marching-squares → paths, potrace |

Ordered cheapest-stressor first. The full candidate list, with cost estimates, lives in the shortlist (memory: `creative-library-shortlist`).

**Vector Type Studio — LANDED 2026-07-27** (commits `003ac333a`..`7423d4fad`, 11 commits, +15,076/−4,065 across 161 files). First surface from the **Vector + variable type** family, and the redesign of the dormant Kinetic Slates feature rather than a bolt-on: text → variable-font glyph outlines (fontkit, not the vendored `opentype` parser, which parses `fvar` but has zero `gvar` support) → animated as real 2D geometry → baked to PNG through the existing cascade and **exported as SVG — Sailor's first vector output**. It is stateless (`f(cfg, t) → paths`), so unlike Shape Studio — whose engine rebuilds on every change and caps animation at camera and scale — it arrived fully animatable, including per-glyph stagger (seeded-stable order, a travelling weight wave proven by test). Roboto Flex's 13 axes (`XOPQ` stroke thickness, `GRAD` grade, `YTAS` ascender height, etc.) are now animatable design parameters; the design doc's claim that nothing else in the market exposes these still stands unchallenged. The factory pattern held for a fourth time: one `ControlSpec[]` declaration produced inspector, agent vocabulary, motion tracks, and Collection sweeps together. A studio-agnostic SVG spine (`app/lib/vector/svg.ts` — `VectorShape`/`shapesToSVG`) was built once, deliberately, so Shape Studio's flat-shaded facets can become its second consumer next.

It replaced as it added: Kinetic Slates (−781 lines), the KineticType node with a 74-preset migration (17 mapped honestly, 9 partial, 48 dropped with a written reason each, −1,527 lines), and the Font Playground widget (−730 lines, removed outright — zero saved projects referenced it). **Surface count, stated honestly:** the plan's headline six→four counts only the four *type-authoring* surfaces (Vector Type, Space Type, Text on Path, Text Mask); the true census is **six→five**, because Scene3D text and Compositor text layers also let a user pick a font and the design doc excluded them as "different jobs" rather than folding them in.

Open items carried forward, not papered over: a migrated KineticType node no longer executes on the ComfyUI backend (it was a real node with IMAGE/MASK outputs; Vector Type is frontend-only, so graphs piping kinetic frames into a backend node lose that input at Run — baked frames and timeline playback still work; needs a release note) — its migrated MASK wire also dangles unconnected; no fallback exists yet if `google/fonts` renames a path upstream (the design doc's "static cut, axes disabled" mitigation is unimplemented); no node consumes SVG output, so vector only leaves the product by download; and parity gaps vs. the retired Font Playground remain (10 curated families, not the full Google Fonts catalog; no kerning off-switch; no word-level 3-D transform). `lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are now orphaned by the retirement (the preset catalog is still live for Compositor metadata) — a separate cleanup. The in-studio agent tuner is wired and guard-tested but not yet runtime-verified against a live model. Design: `docs/superpowers/specs/2026-07-27-vector-type-studio-design.md`. Full ledger: `.superpowers/sdd/progress.md`.

**Done when:** at least one surface from each family is live, factory-built, and agent-drivable on day one. **Vector + variable type: done.** Data-driven form and Physics/simulation: not started.

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
