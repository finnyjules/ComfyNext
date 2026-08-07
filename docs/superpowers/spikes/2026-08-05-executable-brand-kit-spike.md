# The Executable Brand Kit — hinge spike (brief)

*2026-08-05. Written before the spike runs; findings get appended below when it has.
Child of the vision work recorded in [2026-08-04-per-surface-roadmap-design.md](../specs/2026-08-04-per-surface-roadmap-design.md)
(the wargame + maximal-vision strategy docs are still to be committed).*

## In plain language

The long-term idea: a brand kit that doesn't just *describe* an aesthetic (colors, fonts,
guidelines) but *executes* it — studios open already looking like you, variations stay in
your lane, the agent proposes in your style. **Brand guidelines that run.**

Everything in that idea rests on one assumption nobody has tested: that an aesthetic can be
**read into parameters** — that software can look at what you like and set the sliders the
way you would. This spike tests exactly that, in about a week, with a built-in way to fail
loudly.

## The claim under test

> Given evidence of a person's taste (inspiration images, and their own past work), we can
> produce parameter settings across several studios that the person **recognizes as theirs** —
> well enough that *correcting* the result beats starting from neutral defaults.

If true: the executable brand kit, the taste-conditioned production floor, and the
"aesthetic into software" thesis all stand on ground. If false: they are poetry, and we
learn it for a week's cost.

## Design

### The facet vocabulary, v0

Taste is stored as ~12 studio-agnostic dimensions, deliberately imperfect and versionable:

1. warmth (cool ↔ warm)
2. value bias (dark ↔ light)
3. contrast (soft ↔ punchy)
4. saturation discipline (muted ↔ vivid)
5. palette breadth (monochrome ↔ polychrome)
6. grain / texture affinity (clean ↔ textured)
7. edge quality (crisp ↔ painterly)
8. density (sparse ↔ busy)
9. geometric regularity (rigid ↔ organic)
10. finish (matte ↔ luminous)
11. ornament (restrained ↔ decorative)
12. motion character (snappy ↔ floaty) — **expected to be unreadable from still images;
    kept in v0 precisely to confirm that blind spot** (motion taste must come from observed
    projects or the owner's hand)

### Three evidence routes

- **Elicited** — inspiration images → Fable vision → facet values. Adapts the existing
  Style Publisher pipeline (`server/api/style-profile/`), emitting numbers instead of prose.
  Cheap deterministic reads (palette extraction, contrast stats) run beside the model call.
  Two mechanics borrowed from the field survey (2026-08-05): the output includes **avoids**
  (negative priors — what this taste never does; Krea's moodboard analyze ships this), and
  Fable must **cluster before averaging** — if the board holds two registers, report two
  candidate modes rather than the mush of their mean.
- **Observed** — the owner's saved projects mined for real parameter choices on the mapped
  params. No AI involved; this is direct measurement.
- **Declared** — not built in the spike; noted as the correction loop the product would add.

### The mapping

~30 high-salience params across three studios — **Gradient, Shader (grain/palette),
Vector Type (weight/axes)** — hand-mapped from facets in one standalone file. No
`ControlSpec` schema changes, no migrations: the spike must not pay productization costs.

### The wall

A dev page (`/dev/taste-wall`, following the `/dev/shaderfill-bench` precedent) rendering a
grid: three studios × three columns — **neutral defaults / elicited taste / observed taste**.

### Two controls (a verification that cannot fail proves nothing)

1. **The anti-wall (discriminability).** A second board of deliberately opposite taste
   (e.g. brutalist monochrome against a warm, textured set) rendered through the identical
   pipeline. The two walls must differ **loudly**. If they look like cousins, the pipeline is
   emitting generic pleasantness, not reading taste — the silent failure mode this control
   exists to catch.
2. **Elicited vs observed agreement.** Two independent routes to the same person's taste
   should roughly agree where they overlap. Divergence in a consistent direction is not
   necessarily failure — inspiration is aspiration, project history is practice — but *zero*
   correlation is.

## Predictions, registered in advance

- The elicited wall reads as a **caricature**: directionally right, too blunt. Color lands
  best (Gradient panel most convincing), grain roughly lands, subtlety does not.
- **Facet 12 (motion) comes back empty or guessed** — confirming motion taste needs
  non-image evidence.
- The observed column is **sharper but patchy** — strong where the owner has real usage,
  blank elsewhere.
- Elicited and observed **partially disagree**, most likely with the board reading moodier
  or bolder than the practice. That gap is the first measurement of aspiration-vs-practice.
- Even at caricature quality, "Gradient Studio opens already in your colors" **feels
  disproportionately good** — the demo moment that decides whether to keep pulling the
  thread.

## Pass / fail

**Pass** requires all three:
1. **Recognition** — the owner says "that's my direction" on the elicited wall (not "that's
   perfect", just clearly better than neutral).
2. **Discrimination** — wall and anti-wall differ loudly.
3. **Economy** — correcting the elicited result would take fewer decisions than configuring
   from neutral.

**Fail** — generic output (control 1), or no recognition, or elicited/observed at ~zero
agreement. A fail kills the executable-kit thesis cheaply and redirects taste work to
diffusion-side only.

## Owner's part

30–50 images. Do not browse fresh — harvest where taste already accumulates:
`input/lora_dataset_*` folders, own portfolio, Pinterest/Are.na/saves screenshots.
Perfectionism about the corpus is a delay dressed as diligence; a "good enough" board is
the realistic input the product would receive anyway. Plus ~30 minutes of honest looking
at the finished wall.

## Deliverables

- `facets.v0` list (above, refined if the build forces it)
- images → facets endpoint (Fable, JSON out)
- the standalone facet→param mapping file (3 studios, ~30 params)
- project-history miner for the observed column
- `/dev/taste-wall` with all three columns + the anti-wall
- findings appended to this document, including a facet-by-facet verdict on which evidence
  route reads which facet best

## Non-goals

No board/moodboard UI. No `ControlSpec` schema field. No agent integration. No sweeps
integration. No persistence format decisions. Each of those is product work that only makes
sense after a pass.

---

# Findings

## Run 1 — deterministic route + discriminability control (2026-08-05)

Built: `shared/taste/facets.ts` (12 facets), `server/utils/tasteAnalyze.ts` +
`POST /api/taste/analyze` (deterministic, 6 facets), `POST /api/taste/read` (Fable, BYOK,
built but not yet run — no key), `app/lib/taste/mapping.ts` (30 entries, validated against
the real frozen control keys + shader manifest), `app/lib/taste/mine.ts` + `observed.json`
(383 projects scanned, 47 mined: 35 shader / 26 gradient / 18 VT nodes),
`app/lib/taste/observedConfigs.ts`, and the instrument at `/dev/taste-wall`.
37 unit tests green, each with a broken control proven to fail.

**Control 1 — discriminability: PASS, loudly.** Board A (Cinematic Amber Clairobscur
training set) vs board B (Dotwork Monochrome) through the identical pipeline: A's wall goes
amber/brown across all three studios; B's goes fully grayscale. Key reads — A: warmth 0.94
(c 0.87), valueBias 0.24, saturation 0.67; B: saturation **0.02 (c 0.97)**, warmth 0.62 at
c 0.20 (correctly *low-confidence* — a grayscale image has no hue to read; the confidence
model behaved). Pixel-level column inequality asserted programmatically (7/7).

**Observed column is characterful:** dark magenta/blue gradients with heavy grain
(observed `post.grainAmount` median 0.785 over 26 values) and a cyan type ink — visibly a
*third* taste, distinct from both boards. Divergence check (thin, as predicted):
valueBias |Δ| = 0.24 elicited-vs-observed; most facets honestly n/a on the deterministic route.

**Honest blemishes:** the dotwork board's density read 1.00/c 1.00 — stipple texture reads
as maximal busyness to an edge-count analyzer (a *texture* signal leaking into *density*;
Fable should disambiguate). VT cells clip at density-driven size extremes (no fit-to-box in
`vtPlacement`). The `/api/dataset-match` + `/api/training-image` `FOLDER_RE` only admits
`lora_dataset_\d+`, so a custom `taste_board_julien` folder 400s until widened. Two mapped
shader effects (`post_grain`, `color_temperature`) have zero observed usage, so the observed
shader column runs on adjust/bloom medians + pooled duotone colors only.

**Still owed for the verdict:** the Fable column (Julien's key into the page field), the
recognition test on Julien's own board, and the elicited-vs-observed agreement once both
exist for the same person.

## Run 2 — Julien's board exposed the actuator gap (2026-08-05)

Julien drove the first user-run: a coherent pastel board (Miami/Palm-Springs pink buildings
against turquoise/sunset skies) through the deterministic route. **His verdict: "a recolored
vertical gradient which doesn't get it at all." He is right, and it is the spike's most
important finding so far.**

**The diagnosis has two layers.** (1) He tested the pixel-math half — the half that cannot
know "Miami." (2) Deeper: even a perfect reading would have disappointed, because the
actuators were too weak. The wall nudged ~30 sliders on a *frozen* composition (the fixed
banded layout, deliberately held constant as a control) and recolored its stops. **A vibe is
not thirty slider offsets** — his board's taste means a different *layout*, softness, and
light. The reading was starved by its actuator space.

**The correction (`8503209ca`): taste must be allowed to COMPOSE, and Sailor already owns
the mechanism — the per-studio agents.** The Fable read now returns a "what it sees"
summary (the show-you-understood moment) and a standalone **style brief**; the wall gained
a **Composed** column that feeds the brief through the real gradient-agent path
(`/api/vibe`, preset macro + recipe guidance — exactly `/dev/gradient-agent-eval`'s
pipeline), so taste can pick layout and character rather than recolor a fixed one.

**Architectural consequence for the kit design:** the kit's compile target for procedural
studios is **palette + priors + a brief handed to each studio's agent** — not a static
facet→param table. The param mapping remains useful for *defaults biasing* and sweeps; the
*first configuration* of a surface under a kit should be agent-composed. (This also merges
the taste spine with the existing agentic-north-star machinery instead of building a
parallel channel.)

The fixed-composition columns stay on the wall as what they always were: a control
instrument, not the product behavior.

**Unrun:** the Composed column live (key-gated; Julien's next run is its first execution).

## Run 3 — first live Fable run: summary nails it, brief translates the wrong thing (2026-08-05)

Julien ran the full Fable path on the pastel board. **The summary was a bullseye** ("the
sun-bleached pastel world of retro California… vacation stillness rather than street
bustle") — the show-you-understood moment works. **The composition still failed**, and the
failure chain is now fully legible:

1. **The brief translated the photos' OBJECTS, not their LIGHT.** Fable wrote "strong
   horizontal/vertical banding like stucco walls meeting flat sky" — mapping the buildings'
   geometry into the gradient, when the wanted translation was the sky's soft liquid wash.
   The agent then *obeyed the brief faithfully* ("clean linear banding, minimal flow
   distortion"). Garbage-out was loyal to garbage-in.
2. **"Horizontal" was unexpressible anyway:** the gradient agent's vocabulary exposes no
   direction/orientation control at all — the render stayed vertical bands. A real
   vocabulary gap, filed separately.
3. The agent already owned what Julien wanted — an `aurora` preset ("soft dreamy pastel
   aurora wash"), plus `marble`/`sunset`/mesh — the brief simply never steered there.

**Correction (`5e2eb50e6`): atmosphere-first, three takes.** The brief instruction now
demotes photographed objects to palette-only and translates the board's *light and air* by
default; Fable returns **three briefs** (atmosphere / structure / essence), each forced to
name an archetype from the studio's real preset menu; the Composed column renders all
three for the person to choose — one guess was the wrong shape for taste (the explore
thesis applied to the kit itself).

**Generalizable lesson for the kit:** taste-to-studio translation has a *direction* choice
(what aspect of the evidence maps to this material?) that is itself a creative call —
which is exactly why the compile target must be briefs-through-agents with human choice,
not a deterministic mapping.

## Run 4 — diffusion transfers; the gradient needed compose-then-enforce (2026-08-05)

**The generation pair is a strong pass.** Fixed seed, fixed subject, ± the taste style
block (summary + palette + avoids as prose): the tasted render came back pink stucco, teal
doors, palms, sunset over a beach — unmistakably the board's world, at $0.003/image
through nothing but prompt text. Caveat, registered honestly: the subject (a coastal
building) is *native* to the board, so this tested style transfer on easy mode; an
out-of-world subject ("a hedgehog in a forest") is the sharper test and remains to run.
Julien's verdict: "that looks pretty good!"

**The atmosphere gradient got closer — soft, liquid, horizontal — but kept a large
near-black mass against a bright, "no darkness" board.** Diagnosis: (a) the avoids never
reached the composition call (only the brief text was sent), and (b) when the agent picks a
preset it recolors only the stops the brief names — the preset's leftover dark base stops
survive. Compose-then-drift.

**Correction (`c35fa43a8`): compose, then enforce.** Avoids now ride along with every
composition brief, and `enforcePaletteOnGradient` (extracted from `applyTasteToGradient`,
behavior-identical, 37 tests green) deterministically stamps the board's palette and value
bias onto the composed config — stops in luminance order, background pinned. **The model
proposes, the kit disposes** — the diffusion post-pass doctrine, arriving in the
procedural pipeline first, upstream of any product build. This two-stage shape
(agent composes structure → kit enforces palette/value invariants) is the strongest
architectural output of the spike so far.

## Run 6 — the briefs converged; the translation to config did not (2026-08-06)

With simplicity bias + full-carrier enforcement + a review round wired, Julien ran again.
**The briefs are now right** — "Linear gradient with soft turquoise-to-pink-to-peach
palette, high blur, dreamy flat sky" *is* the board. **The renders still missed**, and his
one-line verdict — "a clear issue between the brief and how it translates" — is the spike's
conclusion. Three named fractures in the brief→config link:

1. **Vocabulary gaps:** the agent cannot reach the shapes its own briefs describe. A plain
   flat ramp isn't reliably expressible over the banded default (the flame silhouettes are
   the seed structure surviving), and orientation is still absent from the vocabulary
   (fix in flight in a parallel session), so "clean horizontal bands" rendered vertical.
2. **Enforcement used the wrong palette source.** The agent chose the brief's designed
   colours (correct); enforcement then stamped the **k-means measurement** over them —
   which includes shadow brick/grey clusters, because a pixel histogram is not a designed
   palette. Doctrine right, source wrong: enforce the *curated* palette (Fable's named
   colours), keep the measured one as evidence. **Measurement ≠ design.**
3. **The review round silently never ran** ("review skipped" on all three takes) — a
   uniform failure swallowed by a catch-all (prime suspect: the union `type` in the strict
   output schema). The one mechanism built to catch fractures 1–2 was dead, and the error
   handling hid it. Recorded as a diagnostic anti-pattern: never blanket-catch the
   verification step.

---

# VERDICT (2026-08-06, after six runs)

**The hinge holds where it was doubted, and bends where it was assumed.**

**PASS — reading taste from evidence.** Deterministic extraction discriminates loudly
(run 1, 7/7) with honest confidence behavior. Fable's understanding is genuinely good —
the run-3 summary named Julien's world exactly, and by run 6 the briefs were
indistinguishable from what a human art director would write. Cluster/avoids machinery
works. The 383-project observed mining works and shows a real signature.

**PASS — compiling taste into diffusion.** The style block (summary + palette + avoids as
prose) moved a fixed-seed FLUX render unmistakably into the board's world for $0.003.
Julien: "that looks pretty good!" — the only output he was happy with. Caveat: tested on a
board-native subject; the out-of-world subject test remains open.

**FAIL (for now) — compiling taste into procedural studios.** Not because reading fails —
because **brief→config translation is immature**: agent vocabulary can't express what the
briefs ask (orientation, plain ramps), enforcement needs curated-not-measured palettes,
and the see-and-correct loop needs to actually run. Every one of these lands in a *known,
planned* workstream — the agentic north star's translation-fidelity track (F3 hints, F4
verification, per-surface intent-corpus gating) plus a palette-curation step in the kit —
not in a new unknown. The thesis does not die here; it queues behind agent maturity.

**Consequences for the executable brand kit:**
- Build order inverts the original assumption: **the diffusion channel is the kit's first
  shippable value** (style block + avoids + LoRA scales — nearly free, proven), while the
  studio channel gates on agent fidelity per surface.
- The kit stores TWO palettes: measured (evidence, from pixels) and curated (design, named
  by Fable, editable by the owner). Enforcement uses curated only.
- Compose-then-enforce + see-and-correct is the right studio pipeline; it needs the
  reviewer actually running and an agent vocabulary audit per surface (the taste-wall is
  the test harness for exactly this).
- The recognition test on Julien's own board remains open — but is no longer the
  bottleneck question; translation is.

## Run 7 — sref board: consistency passes, texture finds its owner (2026-08-06)

Julien dropped an sref-derived set (thermal-dusk world: coral-pink against violet-blue,
fog, film grain, "two hue families that never break" — his words: **"the readout is
perfect"**). Then the trio: same tasted prompt, three fresh seeds.

**Consistency PASSED** — the dimension where prose-styles were suspected of losing to
LoRAs: all three renders held the two hue families, the fog, the thermal glow, for
$0.009 total. The moodboard-as-LoRA-alternative claim survived its intended killer.

**The gap: grain/texture went missing.** Three layers: (1) **model tier** — FLUX schnell's
4-step distillation airbrushes fine texture; dev renders it (the wall now has a model
picker with live prices, `fd73998cc`, via an opt-in `model` param on text2img that leaves
its four production callers untouched); (2) prompt mechanics — texture adjectives sit
mid-block where attention is weakest; (3) **the structural answer: finish belongs to the
kit, not the model.** Grain is procedurally free in Sailor (the Compositor post stack, at
the measured intensity, deterministically). The doctrine finalizes as: **the model does
world and light; the kit does finish.** No diffusion-only competitor can close the
texture gap this way.
