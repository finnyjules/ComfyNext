# Per-Surface Roadmap — design

*2026-08-04. Companion to [VISION.md](../../VISION.md), [ROADMAP.md](../../ROADMAP.md), [STATE.md](../../STATE.md).*

## In plain language

Sailor's roadmap today is organised by *capability* — three acts that each unlock the next
(Factory → Absorption → Reach). That answers "what am I building this quarter". It does not
answer "where is Scene3D going", or "what is the Lip-Sync Studio actually missing", or "which
one thing would light up the most surfaces at once".

This adds the other axis: a document with one entry per surface, saying what that surface
becomes when it is fully itself, what it is measurably missing today, and the two-to-four moves
that close the gap. Plus, at the top, one ordered list pulled from all of them, so there is
always a defensible answer to "what next".

The acts stay in charge of sequencing. This is the vertical view beside them, not a replacement.

## Why now

Three things converged.

**The maturity table is stale and structurally incomplete.** `STATE.md`'s grid was surveyed
2026-07-25. Since then embeds landed on three surfaces, Scene3D gained a mesh primitive, and
Space Type gained real alpha — none of which the table can express, because it has four columns
and no `embed` column exists. A table that cannot represent what shipped is worse than no table:
it reads as authoritative and is quietly wrong.

**"What's next" currently requires reading 600 lines.** The acts state direction but not
inventory. Deciding the next move today means holding ROADMAP + STATE + several landed-feature
write-ups in your head simultaneously.

**Unlock value is invisible.** Nothing in the current docs makes it visible that (say) a generic
inspector renderer would light a rung on eight surfaces while a Lip-Sync fix lights one on one.
That comparison is exactly the decision the roadmap should be making easy, and today it is
guesswork.

## What is being built

One new document, `docs/SURFACES.md`, with three stacked layers. Each layer is deliberately a
different *kind* of claim, and is trusted accordingly.

### Layer 1 — the ladder (mechanical)

Ten rungs. Every cell must be derivable from code, so the layer stays true without judgement:

| Rung | Means |
|---|---|
| `bake` | renders to pixels through an export path |
| `motion` | animatable — timeline clip or motion tracks |
| `inspector` | has a panel UI |
| `agent` | agent-legible: a control descriptor or a command surface |
| `factory-built` | controls **derived** from one declaration, not hand-written |
| `embed` | exports as self-contained live HTML |
| `vector-out` | emits geometry/SVG, not only pixels |
| `alpha` | real transparency survives the bake |
| `sweepable` | bindable by Collection |
| `taste-conditioned` | a house style / taste profile can steer its parameters |

Cells are ✅ / ◐ / ❌ / **n/a**.

**`n/a` is load-bearing, not politeness.** `vector-out` on the LoRA Trainer is a category error,
not a gap. Scoring it ❌ manufactures debt that will never be paid and teaches the reader to
distrust the column. Every `n/a` carries a one-line reason.

**◐ means "evidenced as partial", never "unclear".** Where the audit cannot evidence a rung, it
records ◐ *and writes the ambiguity down*. Rounding an unknown up to ✅ is the failure mode that
produced the stale table.

### Layer 2 — one block per surface

```
### <Surface>
**Destination.** One or two sentences: what this surface is when fully itself.
**Rungs.** n/10 — missing: <list>
**Next moves.**
1. <move> — [Act] · size
2. ...
**Known debt.** pointers into STATE.md / specs
```

Moves carry an **act tag** (Factory / Absorption / Reach) and a **size**:

- **S** — one working session
- **M** — one spec + plan cycle
- **L** — its own design document, multi-phase

Destinations are drafted from `VISION.md`'s three axes (explore / transform / author) plus what
the code shows a surface is already good at. They are the one layer that is *opinion*, and are
marked as such — the user strikes or rewrites what is wrong.

For spine rows (canvas, agent, projects, delivery) the destination is phrased as **what it must
become for the studios' sake**, since their ambition is service-to-others rather than creative.

### Destination decisions already made (brainstormed 2026-08-04)

Five contested calls shape many rows at once. Four are decided; one is deliberately open.

1. **Type family — two poles, absorb the utilities.** Vector Type owns flat/print/vector type;
   Space Type owns spatial/cinematic type. Text on Path and Text Mask retire into Vector Type as
   layout modes (path layout, mask fill) — continuing the Kinetic Slates consolidation. Their
   destination rows say exactly that.
2. **Scene3D — motion-graphics 3D, inside Sailor.** Best-in-class 3D as a *creative material*
   (sculpt, light, animate, bake) always feeding the canvas. The standalone-tool idea stays a
   dormant possibility, not the stated destination; moves are judged by what the canvas needs.
3. **Motion — the Timeline is the stage, studios are the actors.** Every studio animates itself
   through its own factory-derived tracks; the Timeline is where pieces meet (sequencing,
   layering, audio, final render). Shot Director folds into the Timeline as a camera lane —
   the second retirement-by-absorption. Compositor keeps per-layer motion as its local dialect.
4. **Materials — fills AND destinations of their own.** Shader, Gradient and Texture each keep a
   standalone creative ambition *and* expose themselves as fill/material types on other surfaces
   (the shader-as-fill template). Two-part destinations for each. Shape stays a geometry surface
   and feeds the SVG spine.
5. **Taste — OPEN, deliberately.** The differentiator question: (a) spine service only, wired
   studio by studio; (b) a Taste Studio as forcing function — an editable taste object (palette,
   edge character, density, motion character as procedural priors over ControlSpec) proven on a
   live cross-material proof wall; or (c) the studio shipped early with a one-panel wall that
   grows as studios are wired. Parked for further thought; SURFACES.md records the taste rows as
   contested with these options inline, mirroring ROADMAP's Act 1 pause.

### Layer 3 — the queue (derived)

At the top of the document: moves from every surface, ordered by

1. **act alignment** — a Factory move outranks a Reach move, per ROADMAP's sequencing argument;
2. then **unlock value** — a move lighting one rung across six surfaces outranks one lighting
   three rungs on a single surface.

Marked `derived — regenerate when a surface lands`. Being explicitly derived is the anti-drift
mechanism: when the queue disagrees with the acts, that is a visible contradiction to resolve,
not a silent second opinion.

## Scope — which rows exist

"Everything with a UI." Candidate list, to be confirmed and corrected by the audit:

**Studios (17):** Space Type · Vector Type · Scene3D · Compositor/Frame · Timeline (NLE) ·
Gradient · Shader · Texture · Shape · Shot Director · Smart Layout · Lip-Sync · Character/Sheet ·
Pose Mannequin · Inpaint/Region · Text on Path · Text Mask

**Spine (10):** Canvas (node graph) · Agent / prompt bar · Collection (sweeps) · LoRA Trainer ·
Voice Trainer · House Styles & Style Publisher · Projects · Ready to Deliver · Embed Export ·
Sketch pile

~27 rows. The two groups are presented in separate sections, because a ladder score means
something different for each: a studio missing `motion` has a gap, whereas the LoRA Trainer
missing `motion` is a category error.

## How the ladder is produced

**A fresh parallel audit, not a re-read of STATE.md.** Subagents grouped by surface family, each
returning, per rung, either a `file:line` citation or an explicit "not found". A verdict without
a citation is not accepted.

The audit output is a data file the document is written from — so a future re-audit can diff
against it rather than re-derive prose.

## What this does NOT change

- `ROADMAP.md` — one pointer line added. The acts keep sequencing authority; their argument
  ("factory before absorption or you recreate the 7-declaration problem at scale") is the most
  load-bearing sentence in the docs and is not being restructured away.
- `STATE.md` — remains the "what happened" ledger. Its four-column maturity grid is **replaced by
  a pointer** to SURFACES.md, so there is exactly one maturity table in the repo.
- `VISION.md` — untouched.

## Dashboard

The existing ⛵ *State of the Build* artifact is updated **in place** (same URL, same favicon,
per the standing rule): its 18-row / 4-column grid is replaced by the 27-row / 10-rung ladder,
each row expandable to its destination and next moves, and the derived queue added near the top.

The live artifact is read first — other sessions publish to the same URL.

## Expected findings, stated in advance

Written down now so they can be checked against the audit rather than discovered and
rationalised afterwards:

- **`taste-conditioned` will read near-empty.** `VISION.md` names taste steering *procedural
  parameters* as the un-copied differentiator. If almost no surface scores it, that emptiness is
  the headline finding of the exercise, and is to be reported plainly rather than softened.
- **`agent` will be worse than the acts imply.** Act 3 already names Scene3D, Shape, Shot
  Director, Timeline and Lip-Sync as agent-invisible; the audit will likely add to that list.
- **Surface count is likely to exceed the "~22 creative surfaces" figure** in STATE.md's scale
  line, because that figure predates several additions and counts differently. Whatever the audit
  returns, the counting rule is written down beside the number.

## Risks

- **Rot.** A 27×10 table is 270 cells; every landing invalidates some. Mitigated by the standing
  per-commit dashboard rule already in force, and by keeping the mechanical layer mechanical —
  a re-audit is a repeatable operation, not a rewrite.
- **Destination drift into fiction.** Twenty-seven destinations drafted by an agent will contain
  plausible-sounding ambitions the user does not hold. Mitigated by marking the layer as opinion
  and putting it in front of the user to strike.
- **Queue vs. acts conflict.** Handled by construction: the queue is derived and act-tagged, so a
  conflict surfaces as a visible mismatch.

## Done when

`docs/SURFACES.md` exists with all three layers populated for every row; every ladder cell carries
evidence or an explicit unknown; `ROADMAP.md` and `STATE.md` point to it rather than duplicating
it; the dashboard artifact is updated at its existing URL; and the user has reviewed and edited
the destination layer.
