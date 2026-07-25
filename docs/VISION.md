# Vision — Sailor

*Last revised: 2026-07-25*

## The thesis

**Sailor is the Cursor for creative work.** A place for exploring, transforming, and authoring — with AI as an accelerant, not a slot machine.

Cursor's insight was that AI is most powerful when it operates *inside* a professional's real workspace, on the real artifacts, with the professional reviewing and steering. Sailor applies that to visual and motion work: a real canvas, real materials, real output — and an agent that can see, plan, propose, and be overruled.

## The core bet: the technology factory

There is a long tail of creative technologies and libraries that people have barely begun to properly leverage — GLSL, three.js, physics engines, variable-font shaping, computational geometry, noise fields, constraint solvers. Almost none of them have ever had a **taste-driven, AI-drivable front end**. Each one is a material waiting for a studio.

**These technologies stay under the hood.** The user never sees or edits code. The win is that the AI — and the user, through inspectors, motion, and sweeps — can reach every parameter of them.

Which means the metric that matters most is:

> **What does it cost to absorb the next technology — and is it automatically agent-drivable when it lands?**

Today the answer ranges from *one declaration* (a Shader Studio manifest entry) to *seven declaration sites across five files* (a Gradient Studio parameter, which still can't be animated). Closing that gap — making one declarative schema the source of the inspector, the agent controls, the motion tracks, and the sweep bindings — is the central engineering bet. See [ROADMAP.md](ROADMAP.md), Act 1.

## What "good" looks like

- **Absorbing a new library** (Voronoi, cloth, variable fonts) is a schema plus a renderer — days, not a multi-thousand-line bespoke studio.
- **Everything that ships is agent-legible by construction.** No surface exists that the AI cannot see and drive.
- **Everything numeric is animatable and sweepable by construction.** Motion and Collections are derived capabilities, not per-studio projects.
- **Taste travels.** House styles, trained LoRAs, and taste profiles condition every material, not just image generation.
- **Work leaves the building.** One render/export spine; "ready to deliver" means rendered, packaged, and correct.

## What Sailor is not

- Not a code editor for creatives — the code stays under the hood.
- Not a prompt-in / image-out slot machine — generation is one material among many.
- Not a node-graph hobby tool — the graph is infrastructure; the studios are the product.
