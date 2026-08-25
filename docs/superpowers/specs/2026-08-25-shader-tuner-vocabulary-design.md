# Shader Studio tuner vocabulary — effect switching, stage enables, derived guidance

*2026-08-25. Approved: Julien ("3 seems important"). The strategy doc's gap #2 —
Shader Studio is the only tuned studio with no guidance — turned out to hide two
structural gaps: the agent cannot CHANGE the effect (no effects.N.id control) and
cannot ENABLE a stage (only already-enabled stages are offered). Prose alone cannot
express "make it glitchy VHS" through that keyhole.*

## In simple terms

Today the shader agent can only wiggle sliders on whatever effect and stages are
already on. After this: it can pick any of the 63 effects by name, switch stages on,
and it gets a cheat sheet — mostly GENERATED from the effect manifests themselves, so
a new effect joins the vocabulary automatically — plus hand-written look-word
clusters ("glitchy/vhs → block_glitch, crt...") and the same honesty clause Texture
got. What stays impossible is admitted, not papered over.

## Scope

1. **Effect macro** (mirror of Gradient's `preset` macro in runParamPatch): a
   `effect` select over the catalog's effect ids; applying it swaps the active
   effect THROUGH THE STUDIO'S OWN switch logic (default params seeded for the new
   effect — find where the studio does this on manual switch and reuse that exact
   seam), then scalar overrides in the same patch apply on top.
2. **Stage vocabulary ungated** (deliberate grant): stage enables (`adjust.enabled`,
   `duotone.enabled`, `gradientMap.enabled`, post stages, mask) become switch
   controls, and each stage's params are offered ALWAYS (not only when enabled) so
   one patch can enable + tune. The in-studio panel gating is untouched — this is
   agent vocabulary only. Snapshot/characterization updated once, keys named.
3. **Derived guidance**: built at describe-time from the catalog — one line per
   effect (id · name · category), grouped by category; hand-written on top: look-word
   clusters mapping common asks to effect ids (verified against REAL ids), "pick
   effect first, then 2-4 params", the approximation-honesty clause (same wording as
   Texture's), and 3 worked examples with exact JSON. Prompt budget: keep the derived
   index compact (~63 short lines); measure the total guidance size and report it.

## Constraints

- All new/derived vocabulary values must validate: effect ids from the live catalog,
  keys resolve on the real config (dead-property hazard), ranges clamp as today.
- Tests: macro swaps effect + seeds defaults (assert a param unique to the new
  effect exists after); enable+tune in ONE patch lands both; derived index contains
  every catalog id and nothing else (auto-sync pinned); look-cluster ids all resolve
  (the Texture detector-test pattern); honesty clause present; guidance total size
  under a stated ceiling.
- The catalog is served by the ComfyUI backend for the browser, but agentControls
  runs frontend — use whatever catalog access the tuner already has (getEffect /
  catalog module); if the full list needs the backend at runtime, derive from the
  same source the studio's own effect picker uses (it lists 63 — find it).
- Working tree foreign WIP: own hunks only. vue-tsc 420. Commit to main.
