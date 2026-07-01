# Shot Director — design spec

**Date:** 2026-06-30
**Status:** Design approved, awaiting spec review → implementation plan
**Branch:** main

## Problem

Driving Seedance 2.0 well requires holding an entire cinematographer's checklist in
your head on every prompt: subject, action, environment, one (and only one) camera
move, lighting, style, negative constraints, per-role reference tagging, and optional
timed beats — all within a ~60–100 word budget. Miss a piece or over-specify and you
get documented failure modes (jitter, blended events, character drift). Remembering
all of it per shot is unreasonable, and the current ComfyNext video node exposes almost
none of Seedance's real control surface — it sends only `prompt` + a single `image`.

## Goal

A **Shot Director studio** that lets people direct a shot with granular control
*without* memorizing the formula — by encoding the field's collective best practices as
**guardrails that make the documented mistakes structurally impossible**, while keeping
the compiled prompt fully transparent and editable.

North star for v1: **granular shot control** — directing a shot like a cinematographer
(shot type, one camera move, timed beats, role-tagged references) without memorizing
syntax.

## Research basis (why this shape)

Six independent Seedance 2.0 guides converge on the same practices. These are treated as
hard design constraints, not suggestions:

- **Canonical slot order:** Subject → Action → Environment → Camera → Style →
  Constraints, target **60–100 words** (>100 words causes conflicting instructions).
- **References outweigh prose** — "references define constraints, the prompt describes
  the scene." Seedance is reference-dominant → the reference rail is the *primary* lever.
- **References carry semantic roles:** identity-lock / lighting-copy / composition-lock /
  style-transfer (images); camera-copy / motion-transfer / sequence-extend (video);
  beat-sync / lip-sync (audio).
- **Exactly one primary camera move**, from 8 canonical types (push-in, pull-out, pan,
  track, orbit, aerial, handheld, locked-off). Multiple = jitter.
- **No photography jargon** (fps, f/2.8, ISO, lens) — use pacing words
  (slow / smooth / gradual / gentle).
- **Lighting is the single highest-leverage addition** → first-class field.
- **Timing is soft** — 2–3 beats max, each 2–3 sentences; overloading → blended/skipped
  events; most useful for 10s narrative clips.

### Verified against the real Replicate schema (`bytedance/seedance-2.0`)

- Single `prompt` string (max 4000 chars; ≤600 words recommended). **No structured
  timing field** — beats are prose inside the prompt.
- `reference_images` (array, up to 9), tagged in-prompt as `[Image1]…[Image9]`.
- `reference_videos` (array, up to 3), tagged `[Video1]…`.
- `reference_audios` (array, up to 3), tagged `[Audio1]…`; **requires ≥1 image/video ref.**
- `image` (first frame) + `last_frame_image` — **mutually exclusive with reference_images.**
- `generate_audio` (bool); dialogue via `"double quotes"` in the prompt.
- `duration` (int; `-1` = intelligent), `resolution`, `aspect_ratio` (`adaptive`), `seed`.
- **No `fps` and no `camera_fixed`** in the real schema — the existing builder sends both
  and they are ignored/invalid (latent bug to fix).

## Architecture

A standalone **`ShotDirector` studio node**, following the existing studio pattern
(Shader/Texture): a node card component + a full-editor surface, state persisted on the
node, a "Render" action that compiles + dispatches a Seedance generation.

```
node.data.properties.comfynext_shotDirector : ShotSheet   (persisted state)

ShotDirectorNode.vue      card: reference thumbnails + shot summary + Edit button
ShotDirectorSurface.vue   full editor modal (StudioModalShell)
lib/shotdirector/
  types.ts                ShotSheet, Ref, Beat, enums, role vocab, camera vocab
  compile.ts              pure compile(sheet, profile) -> ModelInput  (the heart)
  profiles.ts             per-model capability profiles + input dispatch
  rules.ts                validation (XOR, audio-dep, beat cap, word budget)
server/api/shotdirector/
  seed.post.ts            one-liner intent -> full ShotSheet (Haiku, structured)
  direct.post.ts          NL phrase -> structured patch onto the sheet (vibe pattern)
```

Registration mirrors existing studios: `ARTIFACT_NODE_COMPONENTS` in
`composables/useVueNodes.ts` + `node-types` in `VueNodeCanvas.vue`.

## Data model — `ShotSheet`

```ts
type CameraMove =
  | 'push-in' | 'pull-out' | 'pan' | 'track'
  | 'orbit' | 'aerial' | 'handheld' | 'locked-off'   // the 8 canonical moves
type Pacing = 'slow' | 'smooth' | 'gradual' | 'gentle'
type ShotType = 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'establishing'

type RefRole =
  // image roles
  | 'identity-lock' | 'lighting-copy' | 'composition-lock' | 'style-transfer'
  // video roles
  | 'camera-copy' | 'motion-transfer' | 'sequence-extend'
  // audio roles
  | 'beat-sync' | 'lip-sync' | 'mood'

interface Ref {
  kind: 'image' | 'video' | 'audio'
  slot: number            // 1-based per kind; -> [Image{slot}] / [Video{slot}] / [Audio{slot}]
  src: string             // data URL or hosted URL (Replicate input)
  role: RefRole
  note?: string           // freeform refinement, folded into the purpose phrase
}

interface Beat {
  id: string
  startS: number
  endS: number
  action: string
  shotType?: ShotType
  move?: CameraMove
  pacing?: Pacing
  activeRefSlots?: number[]   // which references apply to this beat
  keyframeUrl?: string        // cached flux-schnell preview still
}

interface ShotSheet {
  intent: string                 // one-liner seed, retained for re-seeding
  mode: 'reference' | 'firstLastFrame'   // XOR — governs reference vs first/last-frame

  subject: string
  action: string
  environment: string
  lighting: string               // first-class (highest leverage), preset-backed
  style: string
  camera: { shotType: ShotType; move: CameraMove; pacing: Pacing }   // ONE move
  constraints: string[]          // e.g. ['jitter', 'bent limbs'] -> "avoid …" in prose

  references: Ref[]              // primary lever
  firstFrame?: string            // firstLastFrame mode only
  lastFrame?: string             // firstLastFrame mode only

  beats?: Beat[]                 // optional, 0..3 (bounded); the timing view

  audio: {
    generate: boolean
    dialogue?: { speaker?: string; line: string }[]   // -> "double quotes" in prose
    sfxNote?: string
  }

  format: {                      // NO fps — not in schema, and jargon per best practice
    aspectRatio: string          // Seedance real set incl. 'adaptive'
    durationS: number            // Seedance set; -1 allowed (intelligent)
    resolution: string           // Seedance set
    seed?: number
  }
}
```

### Invariants (enforced in `rules.ts`, surfaced in the UI)

1. **Mode XOR** — `reference` mode disables first/last-frame inputs and vice versa
   (`reference_images` cannot combine with `image`/`last_frame_image`).
2. **Audio dependency** — audio references require ≥1 image or video reference.
3. **One camera move** — `camera.move` is single-select; beats likewise carry one move.
4. **Beat cap** — `beats.length <= 3`; beats must fit within `durationS`; each terse.
   Beats require a concrete duration — the beat board is disabled when
   `durationS === -1` (intelligent duration), since there is no timeline to lay against.
5. **Word budget** — compiled prose warns >100 words (amber), hard-caps at 600 (error).
6. **No fps/lens fields** exist in the model.

## The compiler (`lib/shotdirector/compile.ts`) — the heart

Pure, deterministic, unit-tested:

```
compile(sheet: ShotSheet, profile: ModelProfile): ModelInput
```

Behavior for the Seedance profile:

1. Assemble prose in canonical order: Subject, Action, Environment, Camera
   (`"{shotType}, {move} ({pacing})"`), Style, then Constraints as `"avoid {a}, {b}"`.
2. Inline reference purpose phrases from role vocab, e.g.
   `"[Image1] for the character's identity and wardrobe, [Video1] for the camera motion"`.
3. If `beats` present: render `[0s] …`, `[2s] …` segments, each terse; else a single
   paragraph. Beats never exceed the cap.
4. Dialogue → `"quoted"` lines in prose; set `generate_audio` accordingly.
5. Emit the Replicate input object:
   `{ prompt, reference_images[], reference_videos[], reference_audios[],
      image?/last_frame_image?, duration, resolution, aspect_ratio, seed, generate_audio }`.
6. Enforce the word budget; throw a typed `WordBudgetError` past the hard cap.

The compiled prompt string is shown read-only in the surface with a live word-count
meter — the tool never hides what it sends.

## Capability profiles (`lib/shotdirector/profiles.ts`) — "and other models"

A `ModelProfile` declares what a model honors: `refImages` (0–9), `refVideos`,
`refAudios`, `firstLastFrame`, `negativePrompt`, `cfg`, `cameraParams`, `serverEnhance`,
`wordBudget`, `tagGrammar`, and a model-specific input builder. The surface greys
out/adapts controls per the active model; the compiler dispatches to that builder.

v1 implements the **Seedance** profile fully and ships **one stub** (e.g. Veo or Kling)
to prove the seam — full profiles for other models are deferred.

## AI accelerators (reuse existing patterns)

1. **Seed-from-intent** — `POST /api/shotdirector/seed`, Haiku with structured output
   returning a full `ShotSheet`. "Never start blank." (Pattern: aesthetic-autofill, but
   text→structure via Haiku rather than Qwen vision.)
2. **Director bar** — `POST /api/shotdirector/direct`, NL phrase → structured patch onto
   the sheet. Extends the vibe-control pattern (`/api/vibe`, Haiku, structured changes),
   with a richer patch protocol able to target nested `beats[]` and `references[]`.
3. **Keyframe previews** — per beat/shot, generated with `flux-schnell` via the existing
   `/api/inpaint/text2img`. Cheap (~$0.01), optional, non-blocking. Previews composition
   intent — *not* a true Seedance output (different model). Failures show a retry, never
   block render.

## Editing surface (`ShotDirectorSurface.vue`)

- **Reference rail (primary):** up to 9 image / 3 video / 3 audio slots; each with a
  **role dropdown** (from `RefRole`) + purpose note; shows its live `[Image1]` tag. A
  mode toggle switches between reference mode and first/last-frame mode.
- **Shot fields:** Subject, Action, Environment, **Lighting (prominent preset chips)**,
  Style, single-select Camera (shot type + one of 8 moves + pacing), Constraints chips.
- **Beat board (optional):** appears once beats are added (cap 3) — the timing view, with
  a keyframe thumbnail per beat, drag to reorder, duration handles.
- **Director bar:** NL patch input.
- **Compiled-prompt preview:** always-visible, read-only prose + tags exactly as sent,
  with a word-count meter (green ≤100, amber >100, red at hard cap).
- **Format bar:** aspect / duration / resolution / seed, bound to Seedance's real option
  sets.
- **Render:** compiles + dispatches the Seedance generation.

## Backend work

- Extend `_b_seedance_2_0` (`comfy_api_nodes/video_models.py:234`) to forward
  `reference_images[]`, `reference_videos[]`, `reference_audios[]`, `last_frame_image`,
  `generate_audio`; **remove the invalid `camera_fixed` and `fps`**.
- Mirror the advanced-field correction in `frontend/app/data/video-models.ts:295`
  (drop `camera_fixed`/`fps` from the Seedance entry; they are not real inputs).
- References are passed as data URLs / hosted URLs (Replicate accepts data URIs).

## Error handling

- All invariants validated in the pure `rules.ts` layer; the surface disables invalid
  actions (e.g. can't add audio ref without a visual ref; can't add a 4th beat).
- The compiler throws typed errors (`WordBudgetError`, `ModeConflictError`) caught and
  surfaced inline.
- Generation failures reuse the existing video run/queue error toasts.
- Keyframe failures are non-blocking with a retry affordance.

## Testing

- **Unit (Vitest, `frontend/tests/unit/*.unit.spec.ts`):**
  - Compiler golden tests — `ShotSheet` → exact prompt string + input object — across
    variants: terse, reference-heavy, beat-timed, dialogue, first/last-frame.
  - Profile gating (Seedance vs stub): controls enabled/disabled, input dispatch.
  - `rules.ts`: mode XOR, audio dependency, beat cap, word budget, one-camera-move.
  - Director-bar patch validation (nested targets).
- **Manual post-build spike (not automated):** 2–3 real Seedance generations to
  sanity-check that the compiler's output lands (composition, `[ImageN]` adherence, soft
  timing). The field has already run the broader "how to drive it" study; this only
  verifies our output.

## Scope / phasing (YAGNI)

**v1 (this spec):**
- Seedance profile implemented fully; one other-model profile stubbed to prove the seam.
- Reference-role rail (primary), shot fields, single-camera, lighting-forward.
- Compiled-prompt preview + word meter.
- Seed-from-intent; director bar; optional bounded beat board with keyframe previews.
- Backend reference/audio wiring + `camera_fixed`/`fps` removal.

**Deferred:**
- Cross-clip multi-shot sequencing (hands off to the existing timeline / video editor).
- Full Veo / Kling / Wan capability profiles.
- Keyframe → first-frame I2V handoff (approved still seeds the real generation).
- Variant / A–B iteration comparison ("change one variable at a time" as UI).
```
