# 3D Studio Motion — design

**Date:** 2026-07-21
**Status:** Design (approved to write up; not yet planned)
**Scope:** Add simple, preset-driven motion to the **3D Studio** (`scene3d`). Frame-node local-layer motion is noted as **Phase 2**, not built here.

---

## 1. Goal & framing

Give 3D Studio scenes **motion** — the "Jitter" flavor: preset enter/exit transitions plus always-running ambient loops — that plays **live** in the studio and **exports to video (mp4/GIF)**. No keyframe editor. The authoring surface is a dedicated **Motion tab** with a band-timeline you can drag; the power lives in good defaults, not in a dense timeline.

Non-goals (explicit guardrails):
- **No per-property keyframes.** The band-timeline is the ceiling — resize/slide bands, pick presets, set durations. If someone needs true keyframe choreography, that lives in Space Type / the compositor, not here.
- **No new easing math, no new export pipeline, no new timeline UI toolkit** — all three already exist and are reused (see §7, §8, §9).

### Why this is cheap

- The **Frame node is already a motion engine** (master clock, live RAF preview, per-slot phase looping, working mp4 export via `/sailor/spacetype_encode`). It animates anything wired into it.
- The unifying contract is `StudioFrameSource` (`lib/studio/frameSource.ts`) — "a renderer that produces a frame at time `t01`." GradientFX and Space Type register it; that's why a Frame can animate and export them for free.
- **3D Studio has no motion today.** `SceneObject` is a static `position/rotation/scale` snapshot; the engine renders on-demand; `bake()` is single-still; it does **not** register as a `StudioFrameSource`.

So the critical path is small: give the scene a **time model** and a `renderFrameAt(t01)`, register it as a frame source, and add the Motion-tab UI on top of components that already exist.

---

## 2. Core model — `home ∘ motion(t)`

The single rule that makes everything cohere:

> **The Build transform is the object's HOME (rest) pose. Motion is expressed as deltas around home.**
> `renderFrameAt(t) = home ∘ motion(t)`

Consequences:
- Build (posing) and Motion (animating) never fight — Build says where things *rest*, Motion says how they *move around that rest*.
- Turn motion off → back to the exact Build pose.
- At loop boundaries the delta is 0, so the object returns to home → **loops close seamlessly by construction**.
- The frame source is trivial: evaluate motion deltas at `t`, compose onto each object's home transform, `engine.render()`, return the canvas.

### 2.1 Data model additions (`lib/scene3d/config.ts`)

`parseDoc` is already a tolerant deep-merge, so adding fields to old docs is safe.

- **Scene-level** (`SceneDoc`): `motion?: { duration: number; fps: number; loop: boolean; template?: string }`. Absent / `duration<=0` ⇒ still (current behavior).
- **Per-object** (`SceneObjectBase`): `motion?: ObjectMotion`.
- **Camera** participates as a motion target too (it already lives in `SceneDoc.camera`): `camera.motion?: CameraMotion`.

```ts
interface ObjectMotion {
  loop?: { kind: LoopKind; speed: number; amount: number; phase?: number } // ambient, always-on
  in?:   TransitionSpec   // plays once at head
  out?:  TransitionSpec   // plays once at tail
  offset?: number         // start delay (seconds) — drives stagger
  stagger?: StaggerSpec    // text only: explode into per-glyph units (§6)
}
interface TransitionSpec { preset: TransitionPreset; duration: number; direction?: Direction; ease: EaseRef }
type LoopKind = 'spin' | 'bob' | 'pulse' | 'orbit' | 'sway' | 'tumble' | 'none'
type TransitionPreset = 'move' | 'rise' | 'scale' | 'fade' | 'pop'   // + mirror on out
type Direction = 'left' | 'right' | 'top' | 'bottom'
interface CameraMotion { preset: 'orbit' | 'push' | 'sway' | 'none'; speed: number; amount: number }
```

`EaseRef` — the one canonical ease field — is defined in §7.

---

## 3. Preset catalog

Small, complete spread per slot — one per transform axis, not a big menu. Ship the starred set; the rest are table entries added on demand.

| Slot | v1 (ship) | Later |
|---|---|---|
| **Ambient loop** | Spin · Bob · Pulse · Orbit | Sway · Tumble |
| **Enter** | Move · Rise · Scale · Fade · Pop | — |
| **Exit** | mirror of each Enter (Move out, Sink, Scale out, Fade out; Pop's twin = quick scale-down) | — |
| **Camera** | Orbit · Push in · Sway | Dolly path |
| **Modifiers** | `direction` (Move/Rise), `stagger` (text) | ping-pong loop |

Notes:
- **Orbit + Tumble** are the presets that justify motion in *3D specifically* — they read with real depth, unlike Bob/Pulse.
- **Pop** (scale w/ overshoot) is the one "personality" preset worth shipping — the difference between "correct" and "feels designed."
- Each transition preset carries a `direction` sub-knob (one enum), not four presets.
- **No Blur in/out** in 3D — expensive/ugly in a Three render; it stays in Space Type.
- A preset is a **table entry** evaluated against shared easing/loop math — adding one is data, not an engine change.

---

## 4. Scene orchestration — one clock, two rules

Several moving objects read as *designed* or *twitchy* based on one insight: **loops and entrances want opposite treatment.**

- **Entrances → sync-with-offset (stagger).** Objects entering on a shared cascade (each delayed by `offset`, or `i × step`) read as choreographed. All-at-once reads as a jump-cut.
- **Loops → desync (drift).** Identical-phase loops look mechanical. A per-object `phase` seed makes the *same* motion look organic and alive.

Implementation: one shared scene clock; staggered `offset` for one-shot In/Out; a per-object `phase` seed for the continuous loop.

### 4.1 One-click to alive (the "simple" promise)

The real test of "simple" is what happens when someone just flips motion **on** with zero per-object work. A scene-level **Animate** action assigns sensible defaults: a gentle, phase-varied loop per object; a staggered Fade+Rise entrance in object order; a slow camera push/orbit; sane `duration/fps`. Per-object controls become *overrides*, not blank fields to fill. Good defaults you tune, not empty forms.

### 4.2 Scene templates

Named orchestrations — preset *bundles* (functions that stamp defaults across objects + camera), data not engine:
- **Showcase** — slow orbit + staggered scale-in.
- **Reveal** — push-in + fade cascade.
- **Loop** — pure drift, no in/out, for a seamless GIF.

Ship 3; treat them (with Animate) as the primary entry point, per-object panel underneath for tuning.

---

## 5. Authoring UX — the Motion tab

Motion has a time dimension that needs horizontal real estate an inspector can't give, and posing-vs-animating should be an explicit mode. So it's a **tab**, not a panel. Three zones:

1. **Viewport** — the existing 3D view, now a *preview*: the playhead drives `renderFrameAt(t)`; scrubbing moves time.
2. **Transport bar** — play/pause, scrub, loop toggle, time readout, scene `duration/fps`, **Export mp4** button. Plus a **Templates** row and one-click **Animate**.
3. **Band-timeline** — one row per object + a **Camera** row. Each row shows its `In · Loop · Out` bands against the shared clock. Select a row → its Motion panel appears (loop preset + speed/amount, In/Out presets + direction, ease).

### 5.1 Band interactions (direct manipulation)

- **Drag the In→Loop divider** → In lengthens, **Loop auto-shrinks to fill**. Drag the Loop→Out divider → Out duration. Loop is always the remainder (never dragged directly) → gap-free, seamless loop region.
- **Drag the whole clip** left/right → its `offset` (delay). Staggering becomes dragging clips into a diagonal cascade by eye. Edges **snap** to 0, scene end, and each other.
- **Live readout floats while dragging** (`in 0.9s`) — precision without typing.
- The band is a *band* timeline, **not** a keyframe editor. Resize + slide is the ceiling.

### 5.2 Two gotchas the explicit mode resolves

- **Orbit vs. camera motion.** In the Motion tab you're in playback context: if the camera has motion, orbit is *locked* to the animated camera with an explicit "detach to reposition" (writes a new home). If it doesn't, orbit stays free and just frames the preview. No ambiguity.
- **Loop-close hitch.** The Loop band visually *is* the seamless zone; In/Out sit outside it. "Does this loop cleanly" stops being invisible math.

---

## 6. Kinetic type — the `stagger` primitive only

Kinetic type is three different things by animating-unit; only one belongs in this model:

| Kind | Decision | Where |
|---|---|---|
| Text moves as a block | **Free** — it's just an object | This model (text = an object) |
| Letters reveal in sequence | **In-model** via `stagger` | Explode text into per-glyph units; apply the *same* In/Out preset with `offset = i × step` |
| Rich per-glyph choreography (warps, paths, physics) | **Reuse, don't rebuild** | **Space Type** (already a per-glyph engine, already a `StudioFrameSource`) → wired into a Frame |
| Letters as 3D geometry flying | **Out of scope** | Separate large project |

`stagger` is a modifier on In/Out (`direction`: forward / backward / center-out / random; `step`), not a preset. It delivers the ~80% of kinetic type people actually want (sequential reveals) with one new concept and no per-glyph editor. The ornate stuff meets 3D motion **at the Frame** — wire a Space Type source and a 3D Studio source into the same Frame and composite. The `StudioFrameSource` seam is what lets the two coexist without merging internals.

---

## 7. Easing — reuse, reconciled to one field

### 7.1 What already exists (reused verbatim)

- **Editor UI: `CurveEditor.vue`** — a ready-made draggable cubic-bézier editor: two control points, handle leashes, linear reference, preset chips (`ease · in-out · expo · linear`), **overshoot allowed** (`clampY` −0.6…1.6), `v-model` as a JSON `[x1,y1,x2,y2]` string. **Currently orphaned** (zero importers) → clean to adopt, but wants a real wiring pass (unproven in a live surface).
- **Evaluator: `spacetype/motion.ts`** — `bezierEase(x, [x1,y1,x2,y2])` and `parseEase()`, already speaking the exact tuple `CurveEditor` emits. So `CurveEditor → tuple → bezierEase` is a complete existing pipeline. No new curve math.

### 7.2 The two-vocabulary reconciliation (a real decision)

The codebase has **two easing vocabularies**:

| Vocabulary | Where | Covers |
|---|---|---|
| Cubic-bézier tuple `[x1,y1,x2,y2]` | `CurveEditor.vue` + `spacetype` `bezierEase` | curve family: linear, ease, in-out, overshoot/back |
| GSAP name-strings (`power2.out`, `back.out`, `elastic.out`, `bounce.out`…) → `EaseFn` | `lib/motion/easing.ts` `resolveEase` | curve family **+ procedural** (elastic, bounce) |

Bézier cannot express bounce/elastic/spring (they wobble/repeat; a monotonic-in-time bézier can't). This *validates* the two-families split — the procedural eases already live in `easing.ts`.

**Decision — one canonical ease field, two families:**
- **Curve family** → stored as the **bézier tuple** `[x1,y1,x2,y2]`, edited in `CurveEditor.vue`, evaluated by `bezierEase`. Named smooth presets (Ease out, In-out…) are just **labeled tuples that preload the editor**. "Custom…" opens the same editor from the current tuple.
- **Procedural family** (Bounce, Spring/Elastic) → **named presets** from `easing.ts`, each with a knob (bounces / stiffness). **Not** curve-editable — the editor doesn't open for them.

```ts
type EaseRef =
  | { kind: 'bezier'; cps: [number, number, number, number] }   // curve family, CurveEditor
  | { kind: 'named'; name: 'bounce' | 'elastic' | 'spring' }     // procedural, easing.ts
```

A custom bézier is still **one curve for one transition** — it does not cross the no-keyframes guardrail. Natural freebie later: **"Save as preset"** — name a curve, it joins the list.

---

## 8. Export — register a frame source; one render path, two triggers

Both playback paths requested (live frame source **and** a direct Studio export button).

- **`renderFrameAt(t01)`** (new, mirrors `spacetype/engine.ts:renderFrameAt`): evaluate motion at `t`, compose `home ∘ motion(t)` onto every object + camera, `engine.render()`, return the canvas/texture.
- **Register a `StudioFrameSource`** (`lib/studio/frameSource.ts`) exposing `getFrame(t01, w, h)`, `duration`, `fps`, `width`, `height`. ⇒ a wired Frame animates the 3D Studio live and exports it through the **existing** `ensureSpaceTypeBake` → `/sailor/spacetype_encode` → mp4 → Assets pipeline **for free**.
- **Direct "Export video" button** in the Studio → renders `fps × duration` frames through the **same** `getFrame`/`renderFrameAt` and the **same** encode endpoint.

> **Invariant: one render path, two triggers.** The frame source and the direct button MUST call the same per-time render function and the same encode pipeline. If the direct button ever grows its own frame loop, that's the bug (the "3+ surfaces drift" trap).

Loop-close: because `motion(t)` returns home at boundaries and loops complete integer cycles over `duration` (reuse `spacetype/loop.ts` `loopMultiplier`), the last exported frame equals the first — seamless mp4/GIF.

Async detail: GLB objects are already loaded into the engine; `getFrame` sets transforms and calls the synchronous `engine.render()`, so per-frame rendering stays sync. The one async concern is ensuring assets are loaded before an export run begins (guard/await at the start of the bake, not per-frame).

---

## 9. Reuse map & work estimate

| Piece | Where | Reuse | Size |
|---|---|---|---|
| `ObjectMotion` / `CameraMotion` / scene `motion` + tolerant parse | `lib/scene3d/config.ts` | new fields (tolerant merge exists) | small |
| Motion evaluation (preset → transform deltas, easing, loop, stagger) | `lib/scene3d/` (new) | easing via `bezierEase` + `easing.ts`; loop via `spacetype/loop.ts` | **medium** |
| `renderFrameAt(t01)` | `lib/scene3d/` (new) | mirrors `spacetype/engine.ts` | **core / medium** |
| Live play toggle threading `t` into the RAF | `Scene3DStudioSurface.vue:599` | existing RAF | small |
| Register `StudioFrameSource` | `lib/studio/frameSource.ts` registry | existing contract | small |
| Motion tab (viewport preview + transport + band-timeline + panel) | Studio surface | `MotionTransport.vue`, `LayerMotionPanel.vue`, `timeline/`, `CurveEditor.vue` | medium (mostly composition) |
| Direct "Export video" button | Studio surface | shared bake→encode path | small |
| Ease field + CurveEditor wiring + procedural presets | `easing.ts` / `CurveEditor.vue` | both exist; `CurveEditor` orphaned → wire in | small–medium |

**Phase 2 (separate spec):** surface the same band-timeline + In/Out/Loop presets on the **Frame node's local layers** (`LocalLayer.animation` / `lib/motion` already carry the model). Different surface; kept out of this spec so v1 stays "3D Studio gets motion, end-to-end."

---

## 10. Guardrails (the lines to hold)

1. **Band timeline is the ceiling** — presets + durations + stagger shown on a timeline, never per-property keyframes.
2. **One render path, two triggers** — frame source and direct export share `renderFrameAt` + the encode pipeline.
3. **`home ∘ motion(t)`** — motion is deltas around the Build pose; never bake motion into the static transform.
4. **Reuse, don't rebuild** — `CurveEditor.vue`, `bezierEase`, `MotionTransport`/`LayerMotionPanel`/`timeline/`, `spacetype/loop.ts`, the Frame's encode pipeline. Adding a preset or ease is a table entry.
5. **Kinetic type**: only the `stagger` primitive is in-model; rich per-glyph stays in Space Type, meeting 3D at the Frame.
