# Live studio clips on the timeline — edit a Space Type clip in place

**Date:** 2026-08-27
**Status:** Design, awaiting review
**Scope:** First spec in the "unified motion timeline" program. Small and load-bearing.

---

## The program this belongs to (context, not scope)

Motion is going to be a central category for Sailor. Today it's five separate
systems that barely talk to each other (a pure motion-evaluation core, the
shipped video-editor Timeline, per-studio clocks, the Frame node's loop
reconciler, and Shot Director's prompt compiler). The agreed end-state is **one
timeline where everything you place stays alive**: a clip is a window that says
"this plays here," and inside that window the thing keeps running — an animated
studio loops, a generated shot plays. Anything on it, you can dive into, change,
and pop back out. Design-motion (frame-exact, ownable) and AI video sit on the
same rows, layered over each other. Nothing is frozen until export. The "bridge"
between designed motion and AI video isn't a feature you build — it's what you
get for free once both live on one timeline.

**Direction decided:** build that unified timeline on top of the **already
shipped** video-editor Timeline (`TimelineEditor.vue` + `shared/timeline/` +
`comfy_extras/nodes_timeline.py`), not by growing the Frame node. The Frame node
would mean rebuilding a clip/track/keyframe/video system Sailor already owns and
tests. The Frame node stays what it's good at: the ambient loop tile on the
canvas.

**This spec is step one:** prove the load-bearing mechanic — *one studio, fully
live and editable in place, on the real timeline* — with the cheapest material to
iterate (Space Type, procedural, free to re-render). Everything else in the
program rides on the seam this spec builds.

---

## What already exists (verified at HEAD)

The distance to cover is smaller than it looks. A Space Type clip on the Timeline
today already:

- **Renders live.** Scrub/play renders the live three.js engine every frame
  (`SpaceTypeSource.getFrame` → `renderSpaceTypeClipToCanvas` →
  `engine.renderFrameAt`, `app/lib/engine/sources/spaceTypeSource.ts`,
  `spaceTypeClipRenderer.ts`). PNG bake happens **only at export** (Python can't
  run three.js) — `TimelineEditor.vue` export path, guarded by
  `renderPhase = 'baking'`. Bake is never read back into preview.
- **Holds the full studio state.** `SpaceTypeClip.state` is a complete
  `SpaceTypeState` (`shared/timeline/types.ts`, `shared/spacetype/state.ts`) —
  effect, params (incl. text), gradient, post, projection, pan, fps,
  loopDuration. Same shape the standalone studio persists to
  `node.data.properties.sailor_spaceType`. The clip is a deep-copied snapshot,
  self-sufficient to edit.
- **Trims independently of the loop.** `in_frame`/`length`/`speed`/`reverse`/
  `loop` window into the source cycle (`T = loopDuration*fps`, seamless
  `k`-multiplier via `sourceT01`), exactly like a video clip.

## The one thing missing

**You cannot open a clip into its studio.** `SpaceTypeSurface` is hard-bound to a
canvas **node** (`spaceTypeOpenForId`), opened only by `sailor:openSpaceType`
carrying `{ nodeId }`. A clip is a one-way frozen copy; the sole clip→studio link
is the passive **"Sync from node"** button (`SpaceTypeClipInspector.vue`), which
re-pulls the origin node's current state and opens nothing.

So the entire spec reduces to: **let the full studio open bound to a clip's state
instead of only a node's**, edit, write back to the clip, stay live, keep the
trim. Because live-render + full-state + windowing already exist, this is a
binding/plumbing job plus one "Edit" affordance — not a new engine.

---

## Decisions on record

- **Build on the shipped Timeline (Option C)**, not a grown Frame node. It already
  proves the hardest precedent (a studio embedded as a clip, golden-tested).
- **Space Type is the proof studio** — it's already the embedded clip kind, it's
  procedural (free/instant to iterate), and its loop model is the hardest case,
  so proving it proves the mechanic for everything simpler.
- **Detach, not linked (for this spec).** A clip is an independent copy; editing
  it edits *it*. The origin node is provenance, not a master. Rationale: linking
  a clip to its origin *node* fights the "author on the timeline" vision (you'd
  leave the timeline to edit) and creates bidirectional who-wins sync conflicts.
  The genuinely powerful "change once, update everywhere" is a **symbol/instance**
  model (shared definition + instances + per-instance override) — that is **spec
  2**, deliberately built on the same seam this spec introduces. Detach-first
  proves edit-in-place clean, without the override-resolution problem.

---

## Design

### Core: a state-source adapter

Today `SpaceTypeSurface` reads/writes its `SpaceTypeState` from exactly one place:
a node's `sailor_spaceType` property. We introduce a tiny adapter so the studio
stops caring where its state lives.

```
interface SpaceTypeStateSource {
  read(): SpaceTypeState            // current state (with defaults filled)
  write(next: SpaceTypeState): void // persist an edit, undo- and autosave-safe
  key: string                       // stable identity for reactivity/render cache
  label: string                     // shown in the studio chrome / breadcrumb
}
```

Two implementations, each single-purpose and testable without UI:

- **`nodeStateSource(nodeId)`** — reads/writes `node.data.properties.sailor_spaceType`.
  This is exactly today's behavior, extracted. The existing node-edit path must be
  behavior-preserving.
- **`clipStateSource(timelineNodeId, clipId)`** — reads/writes the clip's `.state`
  inside the Timeline node's `edit_state`, through a new timeline-store mutation.

`SpaceTypeSurface` takes a `SpaceTypeStateSource` instead of a raw `nodeId`.
`saveConfig()`/load become `source.write()`/`source.read()`.

### Opening a clip: navigation, not a stacked modal

The Timeline editor is itself a full-screen surface. Opening the studio on top of
it must **not** be a modal-on-modal (Sailor's no-stacked-floating-layers rule).
Diving into a clip **pushes** into the studio with a breadcrumb/back to the
timeline; **back** returns to the timeline with the edit already applied. Same
self-similar navigation the film-side design settled on.

Wiring, mirroring the existing node path:

- `SpaceTypeClipInspector.vue` gains an **Edit** affordance; double-clicking the
  clip in `TimelineEditor.vue` does the same.
- It dispatches `sailor:openSpaceTypeClip { timelineNodeId, clipId }` (sibling of
  `sailor:openSpaceType { nodeId }`).
- `VueNodeCanvas.vue` listens, builds a `clipStateSource`, and mounts
  `SpaceTypeSurface` bound to it. The single studio mount is reused; only one
  state source is active at a time (naturally serialized — one full-screen
  surface).
- While in the studio, the timeline's rAF pauses via the existing canvas
  occlusion contract (`lib/studio/occlusion.ts`) and resumes on return.

### Write-back, undo, autosave

- New store mutation **`updateSpaceTypeClipState(timelineNodeId, clipId, next)`**,
  following the store's record-before-mutate pattern so it lands in undo history
  and marks the node dirty for autosave. (The compositor motion work already
  proved the record-before-mutate gotcha — edits that skip it wipe or fail to
  persist.)
- The Timeline node already persists `edit_state` to `node.data`; clip edits ride
  the same persistence.

### Staying live and keeping the trim

- **Live is automatic.** Preview already renders `clip.state` live and
  `engine.buildKeyed` keys on state, so a write-back changes the key and the next
  frame rebuilds. The render-cache key (`sourceKey`) must include the mutated
  state so an edit invalidates it — verify, don't assume.
- **Windowing is preserved.** `clipStateSource.write` writes only `.state`; it
  never touches `in_frame`/`length`/`speed`/`reverse`/placement. If an edit
  changes `loopDuration`/`fps`, the content's loop-rate mapping recomputes as it
  already does (`sourceT01`), while the timeline window stays put — expected.

### Edge cases

- **Origin node deleted:** detach makes this clean — the clip is self-sufficient,
  editing still works. "Sync from node" already hides when origin is gone.
- **Snapshot gaps:** `sendToTimeline` omits `seamless`, `W`, `H` that the studio's
  own save includes. `clipStateSource.read` must fill defaults for any missing
  field so the studio never chokes on a clip authored by the send path.
- **Two clips from one node:** with detach, each is independent; editing one
  leaves the others untouched. (This is exactly what symbols will later change —
  intentionally out of scope here.)
- **Node path untouched:** editing a canvas Space Type node must behave exactly as
  before (regression guard).

---

## Component boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `SpaceTypeStateSource` (interface) | Decouple studio from where state lives | types only |
| `nodeStateSource.ts` | State from a canvas node (extracted current behavior) | node data |
| `clipStateSource.ts` | State from a timeline clip | timeline store |
| `SpaceTypeSurface.vue` (refactor) | Consume a state source, not a nodeId | the interface |
| store `updateSpaceTypeClipState` | Undo-/autosave-safe clip-state write | edit_state |
| `SpaceTypeClipInspector.vue` / `TimelineEditor.vue` | Edit affordance + open event | — |
| `VueNodeCanvas.vue` | Clip-open path + occlusion/nav | occlusion contract |

## Data flow

```
double-click / Edit  →  sailor:openSpaceTypeClip {timelineNodeId, clipId}
  →  VueNodeCanvas builds clipStateSource  →  SpaceTypeSurface(source)
     ↳ studio reads source.read()  →  user edits  →  source.write(next)
        →  store.updateSpaceTypeClipState (record-before-mutate → undo + autosave)
           →  clip.state mutated  →  preview render key changes  →  live rebuild
  →  Back  →  timeline resumes, edit already applied, trim intact
```

## Testing

- **Unit** — `clipStateSource` round-trips full state; `write` leaves
  `in_frame/length/speed/reverse/placement` untouched; `read` fills missing
  `seamless/W/H`.
- **Unit** — `updateSpaceTypeClipState` is undoable (record-before-mutate) and
  marks autosave dirty.
- **Integration** — extend `tests/embed-spacetype.spec.ts`: edit a clip's state,
  render a frame, assert the pixels reflect the change; assert placement/trim
  unchanged. Then trim after editing and assert both hold (edit-then-retime).
- **Regression** — the node-edit path is unchanged; `nodeStateSource` behaves like
  today.
- **Golden safety** — bake stays export-only and untouched; keep
  `renderSpaceTypeClipToCanvas` changes minimal so `timeline-golden` (TS + Python)
  stays green.

---

## Non-goals (explicitly out of this spec)

- Lifting the 4-clip cap on the Timeline.
- Making the other studios (Scene3D, Gradient, Shader, Compositor) editable as
  clips.
- Creating a Space Type clip from scratch on the timeline (still made by "send to
  timeline" from a node).
- Symbol/instance reuse and override resolution — **spec 2**.
- Anything on the AI-video side (Shot Director clips, re-roll on dive-in).
- Client-side encoding or two-renderer changes.

## Follow-on specs (the program, for orientation only)

1. **This spec** — one studio, live, editable in place. Builds the state-source seam.
2. **Symbols/instances** — shared definition + instances + per-instance override,
   on the same seam. The real "change once, update everywhere."
3. **Generalize** — make each other studio a live-editable clip kind via the same
   adapter pattern.
4. **Scale** — lift the clip cap; only playhead-adjacent clips run live, the rest
   serve cached frames (time-windowing bounds live WebGL contexts).
5. **AI-video live** — Shot Director shot as a timeline clip; dive in to change the
   prompt/cast/camera and re-roll that one clip. The bridge becomes real.
