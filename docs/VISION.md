# Vision — Sailor

*Last revised: 2026-07-25 (rewritten against the mid-2026 competitive landscape).*

## The thesis

**There is no place that lets you fully explore, transform, and produce with the deep creative technologies — in the same place.**

GLSL shaders, three.js scenes, physics, kinetic typography, computational geometry, procedural texture and gradient: these are the most expressive materials on the web, and almost no one who isn't a creative coder can reach them. The tools that *can* reach them expose code. The tools that hide the code don't have the materials. And the one triad that matters to a working artist — **explore** many directions, **transform** what's promising, **produce** something finished — is split across a dozen products that don't talk to each other.

Sailor is the single environment where those materials are first-class, no code is exposed, and the whole triad happens on one canvas.

## Why "the same place" is the whole point

The market has fractured the triad. Each competitor owns one slice and stops:

- **Gen-media apps** (Midjourney, Runway, Sora, Luma) *produce* — but you can't procedurally transform what comes out, and there are no authorable materials underneath.
- **Node canvases** (FLORA's FAUNA, Figma Weave) *explore and transform* — but by chaining model calls only. Verified mid-2026: **zero procedural or code-based materials** in either. Pick a model, branch, remix.
- **Figma** shipped agent-authored shader fills and an on-canvas motion timeline at Config 2026 — genuinely our pattern — but scoped to *design-tool fills and effects*, in service of shipping a product UI, not authoring a shader or a 3D scene as its own system.
- **Rive** wraps procedural motion and physics behind an AI agent — but the code stays visible (inline diffs, "sanity-check what it generates"), it's motion-only, and there's no explore-or-produce breadth around it.
- **Adobe Firefly's** agent *orchestrates* — across Photoshop, Premiere, Illustrator — but the work still lives in five separate apps.

Nobody puts breadth of creative-code materials, a canvas that explores and transforms them, and a way to produce finished motion/output — in one place. **That gap is the vision.**

## The core bet: the technology factory

The under-the-hood technologies stay under the hood. The user never sees or edits code. What makes the whole thing possible — and defensible — is the cost and speed of turning the *next* technology into a taste-driven, AI-drivable studio.

Today that cost ranges from *one declaration* (a Shader Studio manifest entry, which yields inspector + agent + motion + sweeps for free) to *seven declaration sites across five files* (a Gradient Studio parameter, which still can't animate). Collapsing that to one — a single declarative schema that generates the inspector UI, the agent controls, the motion tracks, and the sweep bindings — is the central engineering bet. See [ROADMAP.md](ROADMAP.md), Act 1.

This is now a **speed** thesis, not only a cost thesis. Figma is the credible threat — it has the pattern and the distribution, and is an estimated 6–12 months from generalizing shaders-plus-motion into authorable studio systems. A solo builder cannot out-distribute Figma. A solo builder *can* out-absorb it: the factory is what lets Sailor add a whole studio family — 3D, physics, computational type — in the time an incumbent spends shipping one more fill type. **Breadth of authorable material, arriving faster than a platform's roadmap, is the moat.**

## What is ours, and hard to copy

- **Depth and range of studios, not fills.** A staged 3D scene with lights and camera, a physics simulation you can bake, kinetic type with real motion — as *authorable systems* with their own inspectors, not a parameterized effect on a rectangle. This is the deep end Figma and Adobe have structurally chosen not to enter.
- **Taste that steers procedural parameters, not just diffusion weights.** Krea commoditized "train your style" on model weights in 2026. The un-copied move is a house style that also conditions your gradients, your type motion, your 3D lighting — taste as a layer over the *whole material stack*, which only the factory's control descriptors make reachable.
- **The agent drives the studios, not a chat box.** An agent operating a canvas is table stakes now — FLORA, Figma, and Adobe all shipped it. The differentiator is not *that* it drives a canvas but *what* it can drive: procedural studios exposed through taste-shaped parameters.

## What "good" looks like

- **Absorbing a new library** (Voronoi, cloth, variable fonts) is a schema plus a renderer — days, not a bespoke studio.
- **Everything that ships is agent-legible and animatable and sweepable by construction.** No surface exists that the AI cannot see and drive, and no numeric parameter that cannot move or vary.
- **The triad closes on one canvas** — you explore a wide field of directions, pull the strong ones forward and transform them procedurally, and produce finished motion or stills without leaving.
- **Taste travels the whole stack**, not just image generation.
- **Work leaves the building** through one render/export spine — and, eventually, is *shareable*, because shareable artifacts (Figma is making Community-published workflows a distribution moat) are how this category now spreads.

## What Sailor is not

- Not a code editor for creatives — the code stays under the hood.
- Not another model-picker canvas — chained model calls are one material among many, not the product.
- Not a product-UI design tool — Sailor is for people whose output *is* the artwork, not a screen that ships an app.
- Not a slot machine — generation is a beginning, not the deliverable.
