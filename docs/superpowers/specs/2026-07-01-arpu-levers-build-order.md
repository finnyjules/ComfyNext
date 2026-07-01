# ARPU Levers — Build Order

**Date:** 2026-07-01
**Status:** Roadmap (sequencing doc, not an implementation plan)
**Companions:** `2026-07-01-costs-and-pricing-model.md` (the why), `2026-06-30-shot-director-design.md` (lever 1's spec)

## Premise

Per the pricing model: margin is uniform (~1.7–1.8×) across actions, so ARPU grows on **volume escalators** — features that move a user from cheap actions to expensive ones (draft 1cr → final 4cr → fix/refine 12–28cr → animate 60–400cr → batch ×N) — with video as the ceiling-breaker ($10/mo image plateau vs $30–100/mo video users). None of these levers block on the accounts/billing system; they ship as product value now and become monetized the day metering lands.

## Lever 1 — Finish Shot Director v1 (highest leverage)

**Actual state (corrects stale notes):** Phases 1–2 are BUILT on main — compile core (`frontend/app/lib/shotdirector/`: types, rules, profiles, compile, hydrate + tests), `useShotDirector` composable, `ShotDirectorNode.vue` + `ShotDirectorSurface.vue` with live compiled-prompt preview, preset gallery, Add-menu entry, `/dev/shot-director-harness`. **What's missing is generation — the surface composes prompts but nothing runs.**

Remaining slices (≈ the spec's "Backend work" section):

1. **Generation wiring.** Compiled ShotSheet → `bytedance/seedance-2.0` on Replicate, reusing the existing cloud-generator rails (same pattern as Film a Shot / RestyleWithLoRA): submit, poll, `save_generation_output` so results land in Assets. Strip `camera_fixed`/`fps` per spec.
2. **Reference rail.** Upload/wire the `[Image1..N]` role-tagged references the compiler already emits — primary/character/style refs from canvas nodes or uploads.
3. **Result → video artifact + "New take".** Output lands as a downstream video artifact node (freshest-downstream convention); a one-click re-run with same sheet + new seed. This is the first takes mechanic and belongs in v1, not deferred — takes are the revenue loop.
4. **Cost affordance stub.** Show the $ estimate per run (resolution × duration from the price book's Seedance rows) even before billing exists — it builds the "finals cost real money" mental model and is the future paywall hook point (billing spec §9.1).

**Why first:** it's the image→video ARPU bridge, ~70% built, and every other video lever funnels into it.

## Lever 2 — "Animate this" escalator (cheapest build, ambient funnel)

**State:** Film a Shot node is shipped; Shot Director hydrate helpers + `ShotPresetGalleryModal` exist. This lever is wiring, not new capability.

Slices:

1. **Animate action on every image artifact** (`ArtifactFrameNode.vue` footer, alongside the existing action pattern): click → spawn a Shot Director node seeded with that image as primary reference, auto-wired upstream. Preset picker (existing gallery modal) on the way in.
2. **Same affordance from Frame/Compositor and generator results** — anywhere a final image lands, "Animate" is one click away.
3. **(Optional polish)** Shot-preset suggestions conditioned on image content — reuse the existing Moondream/describe rails.

**Why second:** turns lever 1 from a destination into an ambient next step. Escalators live at the moment of investment, not in the Add menu.

## Lever 3 — Takes & variations mechanics (spend multiplier)

Un-defers the Shot Director spec's "Variant / A–B iteration" item; extends the same idea to images.

Slices:

1. **Takes strip on Shot Director** — lever 1 slice 3 grows into a compared list of takes per shot (thumbnail scrubs, keep/discard), "change one variable" re-runs (the spec's A–B idea: tweak one ShotSheet field, new take).
2. **Image variations split** — "×4 variations" option on the generator Play/scope dropdown (existing split-button pattern from the node Play work), seed-varied, results as siblings.
3. **(Later)** Variation grids as first-class canvas objects feeding Smart Layout / data-merge.

**Why third:** multiplies action count per session on both surfaces; depends on 1 for the video half.

## Sequencing & the rest of the ladder

**1.1 → 1.2 → 1.3/1.4 → 2.1 → 2.2 → 3.1 → 3.2.** Then, from the pricing doc's lever list (§7): proactive finishing stack (critique-loop suggestions as one-tap paid fixes), un-park Variables & data-merge (the ×N batch lever, targets the $75+ persona), character/LoRA flywheel, agent-as-orchestrator, auto-top-up post-launch.

**Boundary:** escalators are offers, not traps — no dark patterns; trust (non-expiring credits, no charge on failure) is the positioning wedge.
