# Shot Director → Film Studio: the fidelity-timeline design

**Date:** 2026-08-07
**Status:** Design direction. Not built. Supersedes the framing (not the code) of the earlier
Shot-Director specs by reframing the *interface* around one idea.
**Origin:** A long design conversation sparked by beechinour's Seedance-2.5 thread on X, which is
really an interface spec in disguise (aggregate coverage don't one-shot; the structured prompt is a
form; the SEQUENCE block is a timeline; character/environment sheets; one pinned style; negatives =
only observed problems; video is expensive so previz in cheap images first).

---

## Plain-language summary

Today's Shot Director helps you describe *one* shot well, then makes *one* video. That's the exact
mistake the source article warns against, and it's why it doesn't feel like it "harnesses video models."

The new idea: **the timeline *is* the video, and it's on screen the whole time — you just turn its
fidelity up, shot by shot.** A shot starts as words, becomes a still (storyboard), becomes a rough
grey-box motion pass, and finally becomes real video. Cheap steps first; you only spend real money at
the last step, once the story already works as pictures. Everything else — Shot Director, characters,
beats, coverage — hangs off that one spine.

---

## The problem

Shot Director is a mature single-shot authoring studio (shot sheet, camera vocabulary, references,
cast, timed beats → a Seedance generation). But it is built on the wrong unit: **one prompt → one
clip.** There is no coverage, no cheap previz, no assembly, and no clear place the finished video comes
together. Adding those as separate panels produced a "wall of panels" that read as confusing and
un-thought-out. The fix was not more features — it was one organizing idea.

---

## The core idea: the timeline is the video, at rising fidelity

There is a single persistent document — the **timeline** — that represents the video from the first
moment. Each shot-slot on it has a **fidelity**:

**words → still → grey-box motion → film**

- **words** — the beats you wrote (the shot list). Free.
- **still** — an image per beat (the storyboard / animatic). Cheap (image gen).
- **grey-box motion** — a rough 3D blockout of camera + shapes (see Motion rung). ~Free, real-time.
- **film** — the generated video. The only expensive rung.

Fidelity is **per shot-slot**, which is what makes iteration cheap: changing a beat edits the document
in place and re-derives only that slot, instead of restarting a linear wizard. The film is **always
playable** — real video where it exists, stills where it doesn't. "The cut" is not a separate step;
the timeline was the cut all along, you just kept raising its resolution.

Money changes hands only at the **film** rung, and the cost is shown on the button *before* you commit.
Batches are small and user-chosen (NOT the article's reckless 10). Better authoring and a validated
grey-box mean fewer paid takes — precision is the cost fix.

---

## The zoom axis (why Shot Director is a level, not a panel)

The whole tool is **one zoom axis**, and every level is the same kind of surface (a timeline + a stage):

- **Canvas** — your *world*: characters, backgrounds, loose material (already how Sailor works).
- **Film** — the video as a timeline of *shots*.
- **Shot** (Shot Director) — one shot as a timeline of *beats*.
- **Beat** — a single still + its prompt.

Descending from Film into a Shot is **navigation** (breadcrumb + back / zoom-push on the same
full-screen surface), **not** a modal stacked on a modal — so it respects Sailor's rule against
stacking floating layers. Shot Director as a right-hand panel was rejected: a side panel forces you to
look at two levels at once, which is the overload we set out to remove. Keep only a **light inspector**
at the film level for shallow per-shot tweaks (rename, reorder, re-roll the still, the "Film · $" button);
*opening* a shot descends for real directing.

Fidelity is fractal: a shot has a fidelity at the film level, and inside it each beat has its own.

**Learnability payoff:** learn one level and you've learned all of them.

---

## How it maps to Sailor

Sailor is already two surfaces — an infinite **node canvas** and full-screen **studios** opened from a
node. Our design maps onto them 1:1, inventing nothing new structurally:

- **Canvas = the world.** Characters and backgrounds live here as nodes; this is where the cast and
  locations get built and kept.
- **A full-screen Film studio = the timeline.** Built on the existing `StudioModalShell` slots:
  - **agent bar** = Plan ("turn an idea into shots" — seeds the empty timeline)
  - **center stage** = plays the animatic / video at whatever fidelity exists
  - **bottom** = the fidelity timeline (the row of shots) — the one genuinely new UI element
  - **left rail** = cast + locations, dragged in from the canvas / registry
  - **right** = the selected shot's light inspector
  - **footer** = spend + export
- **Shot Director** = the next zoom level down, reached by opening a shot.

---

## Finishing the characters work (the "world")

The user's instinct that this has "unfinished business with characters" is correct, and the gaps line
up precisely with what this design needs. The characters subsystem is largely built (registry in
`characterRegistry.ts`, variants/looks, a 4-shot turnaround **sheet generator** in
`useSheetGeneration.ts` + `data/character-shot-scenes.ts`, optional LoRA link, Shot Director cast
wiring). The gaps:

1. **The sheet is generated but only the cover reaches video** (`lib/shotdirector/cast.ts`
   `CAST_REF_CAP = 1`). The 3–4 angle turnaround is never composited and sent as *one* identity image —
   which is the article's trick that sidesteps the "3 angles read as 3 different people" bug. **This is
   the single biggest lever** for consistent characters across shots.
2. **No "lock"** — no notion of a frozen/approved character; sheets re-roll freely as a full replace.
3. **Beat `keyframeUrl` (the per-beat preview still) is a documented stub** in `shotdirector/types.ts`
   ("filled in a later phase"). The animatic idea is a half-done TODO already in the code.
4. **Seam-matching deferred** — "last frame of shot A becomes first frame of shot B" is written down as
   future work; it makes cuts line up and falls straight out of still-per-beat.
5. Creation UX uses `window.prompt`; face-drift detection was explicitly deferred.

So: cast sheets and beat-stills are not new bolt-ons — they are the missing final third of characters.

---

## The motion rung, and its risk (harder in practice than in theory)

**The concept is proven.** Blocking a shot with basic 3D shapes + a camera move, rendering a rough
pass, and using it to *steer* a video model (depth / structure / motion control) is a community-standard
workflow; the geometry carries the camera and motion while the model repaints the look. It fits Sailor
uniquely: **Scene3D** (blocking), a **ComfyUI** backend (native home for depth control), and **Kling /
Wan already in the catalog** (the models with real motion control). And it repeats our favourite
pattern: the grey-box is *both* the free motion previz *and* the control signal that de-risks the paid
render — one asset, two jobs, exactly like the storyboard still.

**But the build is meaningfully harder than the idea**, on three unbuilt/uncertain layers:

1. **Scene3D is a static composer, not an animation tool.** Blocking needs a camera path and object
   motion over the shot's duration — a keyframe/timeline system inside Scene3D. Planned (motion specs
   committed) but unbuilt.
2. **Exporting the *right* control signal off a WebGL canvas is fiddly.** You need a per-frame depth /
   pose / driving-video sequence at the model's expected size and rate — not one frame. Grabbing frames
   off the Scene3D WebGL canvas has known staleness gotchas.
3. **Model plumbing is the real uncertainty.** Which hosted models accept a control video / depth
   sequence, via which provider (fal vs Replicate), with which exact schema? Sailor's builders are
   per-model, so this is a new input shape per model, and bad fal fields fail *silently at result time*.
   The most flexible control path (ComfyUI depth-ControlNet) is the one Sailor deprioritizes in favour
   of hosted fal/Replicate — and the hosted "motion control" inputs may be narrower or less documented
   than the base t2v/i2v paths.

**Scoping nuance:** basic shapes are strongest for **camera moves and object/vehicle motion**. Nuanced
**character performance** wants a rigged figure (pose control), which is far beyond "basic shapes" —
so the first version of this rung should target camera + object motion, not acting.

**De-risking recommendation:** split the rung in two.
- **(a) Motion previz** — block camera + shapes in Scene3D and scrub it purely as a *human* check
  ("does this move right?"), with no model wiring. This is the easier, high-value half and delivers the
  "see motion before you pay" promise on its own.
- **(b) Motion control** — the grey-box actually driving the paid video. Treat as a **research spike**
  against *one* model (Kling Motion Control via fal) before committing. Do not assume it works until a
  paid probe proves it.

---

## Open questions (deferred, not decided)

- **Per-shot model choice.** The motion rung implies a shot can pick its model (locked-face shot →
  Seedance; big camera move → Kling with the grey-box driving it). The backend already has 16 models;
  the frontend profile layer is Seedance-only today.
- **Consistency drift at Build.** Even with locked cast sheets, models drift (~20%). Where does a
  drift check / repair live? (Face-embedding verification was deferred in the characters specs.)
- **Fast lane.** Is there an express path for "I just want one 5-second shot" that skips the full
  four-rung ceremony?

**Settled:** hierarchy is video → shots → beats (still per beat; video generates per shot with beat
stills as anchors); the cut needs no separate room; Shot Director is a zoom level.

---

## What exists to build on

- Shot authoring: `frontend/app/lib/shotdirector/*` (types, compile, cast, profiles, dispatch),
  `ShotDirectorSurface.vue`, `useShotDirector.ts`.
- Studio shell + controls: `StudioModalShell.vue`, `StudioSection.vue`, the schema-driven
  `ControlSpec` / `StudioControlPanel` / `StudioRow` stack.
- Timeline grammar to reuse (ruler / playhead / clips — NOT the motion evaluator):
  `timeline/KeyframeDock.vue`, `useTimelineStore`, `lib/studio/track.ts`.
- Characters: `characterRegistry.ts`, `useCharacters.ts`, `CharacterLibraryPanel.vue`,
  `CharacterSheetNode.vue`, `useSheetGeneration.ts`, `data/character-shot-scenes.ts`.
- Video catalog: `comfy_api_nodes/video_models.py` (16 models), `FilmShotNode`,
  `frontend/app/data/video-models.ts`.
- 3D blocking: the Scene3D studio (Spline-lite) + its committed-but-unbuilt motion plans.

---

## Suggested build order (stage it; spike the risky part)

1. **Coverage on the current shot** — fire a small, cost-shown batch; a take shelf to star keepers.
   Delivers the article's core mental shift with the least new surface.
2. **The fidelity timeline (film level)** — the row of shot-slots with per-shot fidelity + the light
   inspector; the film becomes playable as a stills-and-video animatic.
3. **Descend into a shot** — Shot Director as a zoom level with the beat timeline; wire up per-beat
   stills (fill the `keyframeUrl` stub).
4. **Finish characters as the world** — compose-and-lock cast sheets (lift `CAST_REF_CAP`), a lock
   concept, seam-matching between shots.
5. **Motion previz (a)** — Scene3D camera/shape blocking as a human motion check.
6. **Motion control (b)** — research spike: grey-box drives one motion-control model. Gate on results.
7. **Per-shot model choice** — generalise the profile layer past Seedance.
