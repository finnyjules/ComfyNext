# The Room — living-timeline UX design

**Date:** 2026-08-28
**Status:** Approved design (brainstormed with Julien, visual-companion mockups), pre-implementation
**Program:** the motion living-timeline ([MOTION.md](../../MOTION.md)); sits beside
[2026-08-27-timeline-live-studio-clip-editing-design.md](2026-08-27-timeline-live-studio-clip-editing-design.md) (spec 1, the dive-in)
**Grounding:** the bridge probe (2026-08-27) proved the timeline's machinery works and its
doors don't — every failure was a broken *entrance* or *exit*, not broken compositing.
Friction log in [STATE.md](../../STATE.md).

## The idea in one paragraph

One full-screen place where you make a video piece. The piece plays in the middle, big.
Down the left is a list of everything alive in the project. The timeline strip sits at the
bottom. You **pull** things in from the list — drop one and it's already moving. Today's
model is the opposite: scattered per-node "send to timeline" buttons pushing at a passive
Timeline node, each separately built and separately broken. Pull replaces push: it fixes
the class, not the instances.

## Decisions (each wargamed, don't relitigate)

### 1. One room, two thin doors
- **From Home:** "Create a video" opens the room, empty, with a three-line teaching state
  (pull something in → it plays → export) that disappears once you start.
- **From the canvas:** select things → one button, **"Arrange in time"** (wording not
  final) → the room opens with them in a row, already playing.
- Both doors open the SAME room. Every scattered "send to timeline" verb is retired in
  favor of these two.
- *Why not timeline-first only:* it assumes you know you're making a video before you
  start; Sailor's walk often discovers it. *Why not "send" verbs everywhere:* that's the
  disease the probe diagnosed. Two thin doors, one room, is the synthesis.

### 2. The rail (the load-bearing wall)
- Tab 1 **"This canvas"**: mirrors the project's canvas, **newest first** — the thing you
  just made is always on top (the probe's "fresh video invisible" bug becomes impossible
  by construction: in the project ⇒ on the canvas ⇒ in the rail). Filter chips
  (All · Shots · Living · Stills) + search for reach-back.
- Tab 2 **"Library"**: brand kits, other projects, imports, audio.
- **Tile contract:** a tile is a *living reference*, not a file. Still by default, plays
  on hover (never burns WebGL ambiently — the canvas already learned this). Shows
  cost-to-re-roll (~$0.20) or "free". Drag to strip or stage → lands at the playhead,
  already moving (the Butter-grade entry gesture).
- **"＋ Generate a shot…"** is a thin shortcut: it creates a REAL canvas node and runs it
  there (generation lives on the canvas — Julien's call); the result tops the rail
  because the rail mirrors the canvas. No second generation system, no forced round-trip.
- *A vs C wargame:* with generation on canvas, "newest-first river" and "canvas mirror"
  collapse into one design — C's scope with A's ordering. That merge is this rail.

### 3. Dive-in
Per spec 1: click into a clip → the full studio opens on that clip's state → edit → back.
Push/back navigation, no stacked modals. Nothing frozen until export.

### 4. Export is a job in the existing queue
- Export runs as a background job in the **existing "N running" queue system** — no new
  progress chrome. The room stays usable; the job **survives closing the tab** (the probe's
  export died three times to page reloads — this class of death ends).
- The finished piece **lands as a node on the canvas** (and in Deliverables) — an output is
  a first-class thing in your world, not a file in a folder.
- Surviving a full app restart is explicitly out of scope here (needs the bake to move
  server-side or checkpoint — delivery-spine territory, Act 3).

### 5. Formats (the C-refined position)
A piece has ONE shape for now. The preparation for multi-format is a discipline, not a
build:
- clip placement stays normalized / format-agnostic (mostly already true — keep it so in
  everything new);
- NO variant machinery until the symbols seam (spec 2) exists — formats-as-variants rides
  that seam later, never its own mechanism;
- clips carry their recipes (spec 5's requirement anyway), so an AI shot's answer to
  "give me 9:16" is a cheap re-roll at the target ratio — the living-clip answer;
- when multi-format ships, prefer intent/anchor-based reframing (Smart Layout heritage)
  over hand-layout-per-format; stored placement is the manual fallback.
- *Wargame note:* the ambitious reading of "prepare the data now" died (it prepares for
  the wrong future); the discipline reading survived at ~zero cost.

## Look and feel

House idiom, straight: dark, calm, hairline borders, white-opacity neutrals. The stage is
the biggest thing on screen; chrome recedes. One accent per meaning (emerald = run/paid
actions with price shown BEFORE click; amber = taste; white = structure). Empty states
teach, then get out of the way. **Standing non-goal:** we do not compete on editor
ergonomics (ripple edit, markers, audio ducking...) — differentiation lives inside the
clips; the strip stays deliberately thin.

## Key states

| State | What the user sees |
|---|---|
| Empty room (Door A) | 3 numbered teaching lines; rail shows "＋ Generate" + Library |
| Seeded room (Door B) | gathered clips in a row, already playing |
| Playing/scrubbing | always-current; "alive" = re-openable + auto-refreshing (caching legal, scrub must stay smooth) |
| Exporting | queue shows the job; room stays usable; done → canvas node + toast |
| Stale source | clip stays renderable (detached copy per spec 1) — never a black frame |

## Copy needed

Rail tabs ("This canvas" / "Library") · teaching lines (≤6 words each) · tile metadata
(name, age, duration, ~$ or "free") · queue label ("Exporting NOIR · 42%") · landed toast
("NOIR.mp4 — on your canvas") · the gather verb (test "Arrange in time" vs "Make a video
from these").

## Open questions (implementer's, non-blocking)

- Gather-verb wording (above).
- Rail width / collapse when the stage needs room.
- Does the Frame node's ambient tile get an "open as piece" affordance (a third tiny door)?
- Export-survives-app-restart: deferred to the delivery spine.

## Build order touchpoint

This spec reshapes the room the existing TimelineEditor already is — its bones (tracks,
clips, playback, export pipeline) stay. It composes with spec 1 (dive-in) and doesn't
block it; whether the room ships as spec 1.5 before/with/after spec 1's build is the next
sequencing decision. Mockups from the session persist in `.superpowers/brainstorm/`.
