# State of the Build — Sailor

*Surveyed 2026-07-25 (three parallel codebase sweeps). Update when surfaces land or capabilities change. Companion to [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md).*

## Scale

~158k lines in `frontend/app` · 308 components · 27 registered node types · ~22 creative surfaces · 389 unit specs + 20 E2E specs · `frontend/server` 8.6k lines · 50 house styles · 50 image models + ~17 video models.

## Surface maturity map

Legend: **bake** = render/export path · **motion** = animatable · **inspector** = panel UI · **agent** = agent-legible (control descriptor or command surface).

| Surface | bake | motion | inspector | agent | engine LOC |
|---|---|---|---|---|---|
| Space Type | ✅ + clip bake | ✅ timeline clip | ✅ | ✅ descriptor | 11,202 |
| Scene3D Studio | ✅ 3-pass + mp4 | ✅ own timeline | ✅ | ❌ | 4,258 |
| Compositor / Frame | ✅ | ✅ motion clips | ✅ | ✅ commands | 1,667 (+1,041 motion) |
| Timeline (NLE) | ✅ webm/mp4 + server | ✅ native | ✅ | ❌ | shared/timeline |
| Gradient Studio | ✅ | ✅ 30 targets, path-based | ✅ (hand-written) | ✅ descriptor | 2,620 |
| Shader Studio | ✅ | ✅ path tracks | ✅ (data-driven) | ✅ descriptor | 806 + 63 effects |
| Texture Studio | ✅ | ❌ | ✅ (data-driven) | ✅ commands | 2,041 |
| Shape Studio | ✅ | ❌ | ✅ | ❌ | 761 |
| Shot Director | ✅ | ✅ keyframes | ✅ | ❌ | 988 |
| Smart Layout | ✅ batch export | ❌ | ✅ | ✅ commands | 7,262 (UI) |
| Lip-Sync Studio | ❌ (server) | ❌ | ✅ | ❌ | 82 |
| LoRA Trainer | n/a (server) | — | ✅ | ❌ | 2,424 (UI) |
| Voice Trainer | n/a (server) | — | partial | ❌ | 341 (UI) |
| Character / Sheet | ✅ sheet gen | ❌ | ✅ | ✅ capability | — |
| Pose Mannequin | ✅ control img | ❌ | modal | ❌ (excluded) | — |
| Kinetic Type / Slate | ✅ frame seq | ✅ presets | modal | ✅ capability | flagged |
| Inpaint / Region | ✅ backend | — | toolbar | ✅ ops | — |
| Collection (sweeps) | — | — | ✅ | ✅ | backbone |

## The factory metric (Act 1)

Cost for one parameter to be inspectable + agent-drivable + animatable + sweepable:

- **Shader Studio uniform: 1 declaration** (`shader_effects/manifest.json` entry) → all four generated.
- **Gradient Studio param: was 7 sites / 5 files**, range retyped 3×, animation **impossible**.

**Act 1, part 1 — LANDED 2026-07-25** (commits `341bbf81e`..`ce07eeaf2`). `lib/gradientfx/controls.ts` is now the single declarative `GRADIENT_CONTROLS` list, and **both** the agent vocabulary (`gradientAgentControls`) and the motion targets (`animatableTargets`) are *derived* from it. Motion moved from `{layer, param}` index targeting to dotted paths, with a migration for saved projects plus a fallback in `applyMotion` itself (the single render choke point, `renderer.ts:156`) so legacy tracks resolve on every path — node card, headless bake, and studio frame source all read the saved blob raw and never call `ensureConfigDefaults`.

**Measured outcome: animatable Gradient parameters went from 11 → 30**, verified live in the running app. `relief.grain`, `focus.blur` and the whole `flow.*` block can animate for the first time.

The schema is a **superset with per-consumer opt-in** (`agent: false` withholds from the agent, `animatable: false` from motion), so declaring a control can never silently widen another capability.

Still to do in Act 1: the generic inspector renderer (Gradient still has 432 lines of hand-written markup), new `ControlSpec` kinds (`segmented`, `repeater`, `custom`), and exposing the 11 now-declared Shape controls to the agent. Known misfits remain: Texture's colour-role system (`texturefx/roles.ts`), Space Type's scene-sequencing motion model.

## Agent layer

Loop shape is right (perceive → plan → invertible commands → ghost preview → Keep/Dismiss) plus visual self-review and Direction Loop. **Reach is the gap:** 4 agent surfaces (canvas, compositor, smartLayout, texture) vs ~22 creative surfaces; 3 of 8 studios expose descriptors. LLM tiers: haiku→patch / sonnet→plan / opus→campaign; Fable for style profiles.

## Known debt

- **Export:** 4 independent paths; JSZip ×2; ~40 ad-hoc `a.download`; deliverables shelf re-packages, never renders. (Act 3)
- **Motion:** 6 parallel motion modules wired through 3 registries + DOM CustomEvents; only one preset↔keyframe bridge. (Act 1 absorbs numeric tracks; sequencing models stay per-surface)
- **Agent-invisible depth:** Scene3D is the largest surface with zero agent access. (Act 3, or free via factory retrofit)
- **Texture/Shape have bakers but no motion path.**
- **Bindability markup gate:** a control missing its `<BindableRow>` wrapper is sweepable in principle but has no UI affordance.
