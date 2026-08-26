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
7. **The honesty machinery is SKIPPED here, and the distances logged instead.**
   Base-swap substitutes, the promise checks, the see-first review and the
   `(partial)` / `(differs)` / `(similar)` tile suffixes do not run in this flow
   at all — a composed take has no patch to validate, no promise to break and no
   substitution to make, and it was chosen by looking at it, which is a stronger
   check than any of them. What *is* kept is the measurement: the strip's closest
   pair is computed and logged as telemetry, and nothing is labelled. (The
   earlier draft of this section claimed the machinery "still runs"; it does
   not, and saying so was overclaiming.)
8. **Degrades, each to the next-simplest honest thing.** Recipe call fails → the
   old blind-generation path, with its old machinery entirely unchanged (the two
   paths do not entangle). Eye-pick fails → our pixel-distinctness picks the four
   farthest apart, and says so.

## Constraints

- Two model calls (one text, one vision), both metered and rate-limited like the
  other assist routes.
- First paint waits for the RECIPE call plus our renders, and no longer for the
  pick: the strip goes up on our own distinctness ranking the moment the
  candidates exist, and the eye-pick reorders it in place when it lands. Measured
  in the lab, our half is **95–106 ms** for seven candidates; the honest total is
  that plus one model call, where before this contingency it would have been plus
  two sequential ones. The contingency is implemented rather than deferred
  because the real per-call latency cannot be measured here — there is no API key
  on this machine — and a design that only works if both calls are fast is not a
  design.
- Every await behind the superseded guards the strip already uses.
- The descriptors are the one place a human judgement enters the data; they are
  derived from measured pixels and guarded against drift, not written from
  memory.

## Out of scope

The other four studios; the single-tune path; local variations; a second recipe
round; letting the eye-pick invent a take that was never rendered.
