# Vision — Sailor

*Last revised: 2026-07-25 (rewritten against two verified research passes: the mid-2026 competitive landscape and the demand-side evidence).*

## The thesis

**Creative is a probabilistic game, and it is won by exploring many diverse, controllable, on-brand, animated directions — fast. The AI models give you quantity without control. Control is the unmet need. Sailor is the place where generated and designed content becomes controllable, diverse, animatable, taste-conditioned material.**

The deep creative technologies — GLSL shaders, three.js scenes, physics, kinetic typography, computational geometry, procedural texture and gradient — are the substrate that makes control possible: they are *deterministic* where diffusion is a slot machine, *parametric* where a prompt is a wish, *animatable* where a generated image is frozen. They stay under the hood. The user never sees or edits code. What they get is the one thing the models structurally cannot give them: their own look, under their own hand, in motion, at volume.

## Why this holds — the evidence

Two adversarially-verified research passes (mid-2026) support this shape, and — importantly — refuted the easier version of it.

- **The game is probabilistic, and volume-of-*diversity* wins.** Only ~6% of ads drive the majority of spend; roughly half get none; brands who launch more creative get ~2x the winners on identical budget (Motion 2026 Creative Benchmarks — 550k+ ads, ~$1.3B Meta spend, third-party corroborated). The 2026 consensus stresses *diversity of angles* over raw quantity. This is the core case for **explore**: a diffusion model gives four variations of the same thing; procedural materials + taste profiles + sweeps give genuinely *different, on-brand* directions. Volume of *sameness* is easy and commoditized. Volume of *diverse, controllable* directions is the hard part — and the part that wins.

- **Motion is a real, costly gap.** Canva paid to acquire Cavalry (an After Effects alternative) in Feb 2026, explicitly because "customers have been asking… for motion graphics," and MangoAI the same day to tie video ads to performance feedback. Mainstream users want content to **move**, and current options bifurcate into too-hard (After Effects) and too-basic (Canva), with AI video too uncontrollable in between.

- **The unmet need is control, not quality.** 62% of designers name inconsistent/unreliable output as their single biggest AI-tool frustration; 80% say reliable output is what makes a tool stick (AI in Design Report 2026, n=906). Raw generation quality is crowded and largely solved. Controllable, reliable, on-brand output is not.

**What we explicitly do NOT claim:** that people feel acute pain switching between tools. The "fragmentation tax" narrative failed verification — nearly every direct practitioner-complaint source was refuted. "One place" is a *consequence* of doing explore→transform→produce well, not the pitch. We earn integration by making the loop fast; we don't sell the annoyance of tabs.

## The wedge: motion

The sharpest entry point is making designed and generated content **move — controllably, on-brand, at multiple sizes.** It is the loudest verified demand signal, it is where the incumbents are weakest (too-hard vs. too-basic), and it is where Sailor's deterministic procedural substrate has the most obvious advantage: you can keyframe a parameter, you cannot keyframe a prompt.

## The core bet: the technology factory

The moat is the cost and speed of turning the *next* creative technology into a taste-driven, AI-drivable studio. Today that cost ranges from *one declaration* (a Shader Studio manifest entry, which yields inspector + agent + motion + sweeps for free) to *seven declaration sites across five files* (a Gradient parameter, which still can't animate). Collapsing that to one — a single declarative schema generating the inspector, the agent controls, the motion tracks, and the sweep bindings — is the central engineering bet. See [ROADMAP.md](ROADMAP.md), Act 1.

This is a **speed** thesis. Figma shipped agent-authored shader fills and an on-canvas motion timeline at Config 2026 — genuinely our pattern, but scoped to design-tool fills, and backed by distribution a solo builder cannot match. A solo builder cannot out-distribute Figma. A solo builder *can* out-absorb it: the factory adds a whole studio family — 3D, physics, computational type — in the time a platform ships one more fill. **Breadth of controllable material, arriving faster than a platform's roadmap, is the moat.**

And procedural is not just breadth — it is the *reliability* answer. A shader runs the same every time; a sweep is deterministic. Where diffusion churns users with inconsistency, the procedural layer is repeatable by construction. That maps directly onto the #1 unmet need.

## What is ours, and hard to copy

- **Diversity, not sameness.** Genuinely different on-brand directions, not four re-rolls of one image — the thing the probabilistic game rewards and pure generation can't produce.
- **Control and determinism.** Keyframeable, parametric, repeatable materials — the answer to the reliability frustration that churns users off AI tools.
- **Taste that steers procedural parameters, not just diffusion weights.** Krea commoditized "train your style" on model weights in 2026. The un-copied move is a house style that also conditions your gradients, your type motion, your 3D lighting — taste over the *whole material stack*, which only the factory's control descriptors make reachable.
- **The agent drives the studios, not a chat box.** An agent on a canvas is table stakes now (FLORA, Figma, Adobe all shipped it). The differentiator is *what* it drives: procedural studios exposed through taste-shaped parameters.

## The risks we are honest about

- **The reliability bar is the whole game.** Procedural materials are inherently more reliable — but the *AI driving them* reintroduces exactly the inconsistency people churn over. The thing to prove is not "can we wrap a shader" but "can the agent drive it *reliably* enough to clear the 62%-cite-unreliability bar."
- **"One place" is untested, and Canva is closing the gap from the mainstream side.** No evidence yet shows an integrated canvas beats a best-of-breed stack in practice. Integration must earn its weight through a fast loop, not be assumed.
- **The segment is price-sensitive.** Canva's AI-justified 317% Teams-plan hike triggered backlash and a forced rollback. This market pays for value clearly delivered and punishes AI priced ahead of value. Prove controllable-on-brand value before pricing on AI.
- **The willing-to-pay segment is not yet isolated.** Performance/social creative shows the loudest money-and-frustration signal, but no source cleanly pinned a single segment's willingness to pay for an explore→transform→produce all-in-one. That is the open demand question.

## What Sailor is not

- Not a code editor for creatives — the code stays under the hood.
- Not another model-picker canvas — chained model calls are one material among many, not the product.
- Not a slot machine — generation is a beginning, and *control* is the product.
- Not sold on "all-in-one" as a virtue — integration is earned by a fast loop, not pitched as relief from tab-switching.
