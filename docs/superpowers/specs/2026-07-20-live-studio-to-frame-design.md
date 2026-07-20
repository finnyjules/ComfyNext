# Live studio → Frame — connecting studios into the compositor

**Date:** 2026-07-20
**Status:** Design approved, ready for planning

## Problem

You cannot usefully wire a studio node (Gradient Studio, Shader Studio, Space Type)
into a Frame (the Compositor). A direct wire does two wrong things:

1. **Silent drop.** The Frame resolves each slot with a `resolveSrcUrl` that only
   understands `data.images`, `LoadImage`, and `Image` nodes. A studio never
   self-stamps `data.images`, so the slot resolves to null and the layer vanishes —
   the same class of gap that blocked studio→shader before `resolveSourceKind`.
2. **A clobber bug (live today).** When an upstream studio bakes, `publishStudioOutput`
   matches `artifact-frame` in its target filter and overwrites the Frame's *own*
   composite output (`data.images[0]`) with the raw studio file.

The only working path today is the 3-node detour: studio → Image artifact → Frame slot.

Beyond fixing that, the goal is **live**: an animated studio wired into a Frame slot
composites in real time — its motion plays in the Frame preview and its export.

## Decisions (from brainstorming)

- **Live, not just baked.** Frame slots pull live frames from upstream studios.
- **The Frame owns a master clock.** With up to 16 slots, no single upstream can own
  the timeline (unlike the shader's single input). The Frame defines one timeline;
  animated slots run within it, stills stay constant.
- **Master clock = derived + override.** Default `duration = max(animated slot
  durations)`, `fps = max(animated slot fps)`; a manual override in the Frame's config
  wins when set.
- **Animated slots play at native speed and loop within the master timeline** — each
  studio keeps its authored motion rather than being time-stretched. Deriving the
  master from the longest animated slot keeps that slot seam-clean; shorter slots may
  wrap mid-loop (accepted; see Risks).

## Current architecture (what exists)

- **Frame node:** `frontend/app/components/vue-canvas/ArtifactFrameNode.vue`, vue-flow
  type `artifact-frame`, backend `Compositor` (`comfy_extras/nodes_compositor.py:321`,
  `_MAX_LAYERS = 16`). 16 `IMAGE` input ports `input-0..15` ↔ backend `layer1..16`.
- **Layer model:** z-ordered stack of *wired* layers (`wiredLayers`
  `ArtifactFrameNode.vue:199`) + *local* layers (text/shapes/dropped images). Per-layer
  transform/opacity/blend in `layer{n}_*` widgets. Order in
  `properties.sailor_stackOrder`. `data.images[0]` is the baked composite *output*.
- **Bake:** `registerStudioBaker(props.id, bakeOutput)` (`:550`) →
  `exportCompositeCanvas` (`:514`) → `paintLayerStack` → PNG blob. Only as good as the
  resolver feeding `wiredLayers`.
- **Cascade:** `isStudioNode` returns true for `artifact-frame` (`cascade.ts:64`), so
  `planStudioCascade` bakes an upstream studio *before* the Frame. Ordering already works.
- **Frame-source registry:** `frontend/app/lib/studio/frameSource.ts` —
  `getStudioFrameSource(id)` returns `{ getFrame(t01,w,h), duration, fps, width, height }`.
  `frameSourceEpoch` (reactive) bumps on register/unregister. `resolveSourceKind`
  (`frontend/app/lib/shaderstudio/resolve.ts:35`) resolves live-source-or-URL for the
  shader's single input.

**The duplicated resolver — the core liability.** The Frame's "what URL does this wired
node give me" logic exists in **four** places, already drifted:
1. `ArtifactFrameNode.vue:170` `resolveSrcUrl` — the node.
2. `VueNodeCanvas.vue:4594` `getUpstreamImageUrl` + `:4606` `collectCompositorLayers`
   — the canvas preview path. **Only loops slots 1–4** (bug: should be 1–16).
3. `CompositorModal.vue:104` `getNodeImageUrl` — the modal.
4. `VueNodeCanvas.vue:4934–4946` — the graph-submit path (mirrors `collectCompositorLayers`).

None know about studio node types or live frame sources.

## Design

### 1. A single studio-aware slot resolver (foundation)

Introduce one shared resolver — a Frame-side sibling of `resolveSourceKind` — that,
given a wired source node, returns one of: `{ kind: 'live', source }`,
`{ kind: 'url', url }`, or `null`. It checks `getStudioFrameSource(src.id)` first (live
studio), then the existing `data.images` / `LoadImage` / `Image` URL cases.

Replace all four drifted copies with calls to this resolver. This fixes the 1–4 slot
bug for free and removes the parity hazard. The resolver is pure (node in → descriptor
out) so it is unit-testable in the node environment, like `resolveSourceKind`.

### 2. Master clock (derived + override)

Frame config (`properties.sailor_frame`) gains an optional
`clock?: { duration: number; fps: number }` override. The effective clock is computed:

```
animated = slots whose resolved source is live with duration > 0
master   = config.clock ?? (animated.length
             ? { duration: max(animated.duration), fps: max(animated.fps) }
             : null)   // no animated slot AND no override → static Frame, no clock
```

When `master` is null the Frame is static (no preview loop, single-frame export) —
exactly today's behaviour. The derived branch never needs a fallback constant because
it only runs when at least one animated slot exists. Recomputes reactively on
`frameSourceEpoch` and on wiring changes.

### 3. Per-slot time mapping (native speed, loop within master)

At master time `t` seconds (preview) the Frame samples each animated slot at its own
native phase:

```
slotT01 = ((t % slotDuration) / slotDuration)   // native speed, loops
frame   = slot.getFrame(slotT01, slotW, slotH)
```

Still slots (no live source, or `duration <= 0`) are sampled once at `t01 = 0` and cached.

### 4. Live preview loop

`ArtifactFrameNode.vue`'s preview becomes a rAF loop when **any** slot is animated
(else it stays static, current behaviour). Each tick:
1. Compute master phase from `performance.now()`-derived elapsed vs `master.duration`.
2. `getFrame` each animated slot (async).
3. Composite the unified stack via `paintLayerStack` (live wired + still + local).

**Async-overlap guard** (same as the shader's node card): an `inFlight` flag; skip a
tick rather than queue, so a slow slot degrades to a lower frame rate. A **soft cap**
on concurrently-animated slots (suggested default 8, revisit after perf measurement)
bounds per-tick cost; slots past the cap fall back to their still frame, with a console
note (no silent truncation).

### 5. Export

`exportCompositeCanvas` gains a per-frame form: render `N = master.fps *
master.duration` frames, compositing all slots at each master time, and feed the
existing Compositor video path (`nodes_compositor.py` `video` output, or the
`spacetype_encode` route the studios use). A still-only Frame exports one frame,
unchanged.

### 6. Clobber-bug fix + reactivity

- `publishStudioOutput` (`VueNodeCanvas.vue:3693`): carve out `artifact-frame` from the
  `data.images` stamp. A studio wired to a Frame must feed a **slot**, never overwrite
  the Frame's composite. (Independent bug — worth fixing even if the rest slips.)
- `wiredLayers` and the master-clock computed depend on `frameSourceEpoch`, so slots
  re-resolve when a studio registers late (the mount-order race fixed for the shader).

### 7. Still fallback

A studio slot with no registered live source (e.g. an unmounted producer) resolves to
its baked/still URL if present, else nothing — never an error. Non-studio image nodes
stay still, as today.

## Non-goals

- **No per-slot independent clocks in the UI.** One master clock; slots loop within it.
- **No re-architecting the Compositor's local-layer editor.** Only the *wired* input
  path becomes studio-aware.
- **No new blend/transform features.** Existing per-layer controls apply to live slots
  unchanged.
- **No backend Compositor changes** beyond what the video export already supports.

## Risks

- **Performance.** Up to 16 async `getFrame` + a composite per rAF tick. Mitigated by
  the overlap guard and the soft cap on live slots. The cap and its fallback must be
  visible, not silent.
- **Regression surface — the resolver unification.** It touches the node, the canvas
  preview, the modal, AND the graph-submit path. Each is a working path today; all four
  need explicit before/after verification (an Image-artifact → Frame slot must still
  render identically). This is the highest-risk part.
- **Seam on wrapped slots.** A slot shorter than the master wraps mid-loop; studios that
  don't loop seamlessly show a visible jump. Accepted; deriving master from the longest
  slot minimises it. Revisit if it bites.
- **Export timing across mixed still/animated slots.** Verify a still slot stays constant
  across an animated export and an animated slot completes its native loops.
- **Coordination.** The Compositor is another session's committed feature area.

## Testing

**Unit (pure, node env):**
- The studio-aware slot resolver: live-source-wins-over-URL priority, URL fallback,
  null when nothing resolves, ignores non-input edges.
- Master-clock derivation: max duration/fps across animated slots; override wins;
  defaults when no animated slot; re-derives on epoch.
- Per-slot phase mapping: native-speed loop math (`t % slotDuration`), still sampled at 0.

**Integration / manual (browser, per verify skill):**
- Regression: Image artifact → Frame slot renders identically (all four resolver paths).
- Regression: still-only Frame previews and exports unchanged; local layers unaffected.
- New: Gradient Studio (flow speed > 0) → Frame slot animates live in the preview.
- New: two animated studios in two slots composite, each at native speed.
- New: master clock reads the longest slot; override changes export length.
- New: export produces a video whose length matches the master clock, with still slots
  constant and animated slots looping.
- New: clobber bug gone — a studio wired to a Frame feeds a slot, Frame composite intact.
- New: soft cap — wiring more than the cap of animated slots falls the rest back to
  stills with a visible note, no crash.

## Bugs fixed in passing (worth noting)

- `collectCompositorLayers` loops only slots 1–4 (`VueNodeCanvas.vue:4606`) — fixed by
  the unified resolver covering all 16.
- The `publishStudioOutput` Frame clobber (§6) — a live bug today.
