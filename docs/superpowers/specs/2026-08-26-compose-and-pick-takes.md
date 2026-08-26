# Compose and pick — four takes without asking the model to drive the machinery

*2026-08-26. Approved by Julien ("let's give it a try"), with the objection this
design exists to answer: **"the model doesn't know how to translate an idea into
our gradient machinery."** It doesn't. So we stop asking it to.*

## In simple terms

Today the model is handed sixty-odd control keys and asked to invent four
parameter patches. That is a translation job it is bad at, and every round of
fixes so far — presets it couldn't reach, directions it got backwards, colours
that landed on the wrong ramp — has been a symptom of asking the wrong question.

Instead:

1. **We describe our own looks.** Every gradient preset gets a short, factual
   description of what it *renders as* — measured from its actual pixels, not
   written from its name.
2. **The model composes a recipe, not a config.** Given the ask, the menu of
   looks, a small menu of mood words we define, and a summary of what the user
   already has, it returns six to eight recipes: *which base look, which colours
   in order, which moods, what to call it.* It never writes a control key.
3. **We build and render every candidate.** Our code turns each recipe into a
   real config through the machinery we already trust, and renders it. Free,
   deterministic, ours.
4. **The model picks with its eyes.** It sees every candidate thumbnail plus the
   user's current design and chooses the best four: ones that read as the ask and
   are clearly different from each other and from what the user has.

The model does the two things it is genuinely good at — having taste about words,
and judging pictures — and none of the thing it is bad at.

## Scope (Gradient's "different directions" flow only)

Other studios, the single-tune path, and local `≈ variations` are unchanged.

1. **Look descriptors.** One per preset, derived from real renders: dominant
   colours, direction, tone, busyness, plus a short mood phrase. Stored as data
   beside the presets. A drift guard re-measures and fails when a preset stops
   matching its own description.
2. **Recipe call** (text, Haiku): ask + descriptor menu + mood-dial menu +
   "yours" summarised. Returns `{base, palette, mood[], name}` per recipe, 6–8 of
   them. Wire-legal schema; a malformed recipe is dropped, never the batch.
3. **Mood dials.** A small table WE own: adjective → nudges on keys we already
   offer. The model picks adjectives; our code applies them.
4. **Materialize + render.** `buildGradientPreset(base)` → palette onto the ramp
   stops in order → mood nudges. Deterministic: same recipe, same config, always.
   8–12 candidates including one or two built on the user's own base.
5. **Eye-pick** (vision, Haiku): all candidate thumbnails + "yours" + the ask →
   the best four, ordered, named, with one-line reasons. Fewer than four valid
   picks → fill from the unpicked candidates our pixel-distinctness ranks
   farthest apart. Deterministic, ours, never invented.
6. **The strip is unchanged UX.** Each take is a whole materialized config
   (macro-style: whole-config restore, keep through the existing writer).
7. **The honesty machinery becomes telemetry here.** Base-swap substitutes and
   the `(partial)` / `(differs)` / `(similar)` tile suffixes are *not shown* in
   this flow — the eye-pick is the quality gate, and a tile the model chose after
   looking at it does not need a badge apologising for itself. They still run and
   still write to the take log and the console.
8. **Degrades, each to the next-simplest honest thing.** Recipe call fails → the
   old blind-generation path, with its old machinery entirely unchanged (the two
   paths do not entangle). Eye-pick fails → our pixel-distinctness picks the four
   farthest apart, and says so.

## Constraints

- Two model calls (one text, one vision), both metered and rate-limited like the
  other assist routes.
- Candidates must render before the pick, so first paint is later than today.
  Measure it. If it exceeds ~8s in the lab, paint the distinctness top-four
  immediately and let the eye-pick reorder in place.
- Every await behind the superseded guards the strip already uses.
- The descriptors are the one place a human judgement enters the data; they are
  derived from measured pixels and guarded against drift, not written from
  memory.

## Out of scope

The other four studios; the single-tune path; local variations; a second recipe
round; letting the eye-pick invent a take that was never rendered.
