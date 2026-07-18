# Space Type — live timeline clip

**Date:** 2026-07-18
**Status:** design approved section-by-section in conversation; the error-handling
and testing sections were written after approval and are flagged for review.
**Scope:** a new procedural timeline clip kind backed by Space Type's three.js
engine, rendered live during preview and baked only at export. Frontend, plus one
small branch in `comfy_extras/nodes_timeline.py`.

## Why

Today, getting a Space Type animation into an edit is a round trip: bake a loop
to PNG frames, encode an mp4 via `/sailor/spacetype_encode`, spawn a Video node,
drag the asset into the timeline. Every tweak — a typo in the text, a slower
rotation, a different gradient — repeats the whole cycle. The animation arrives
as dead pixels.

The timeline already knows how to composite live procedural clips. `MotionClip`,
`TitleClip` and `LowerThirdClip` draw themselves per frame with no file involved;
`TextCanvasSource` rasterizes them on demand and the GL compositor uploads the
result as a texture. Space Type is a better fit for that pattern than any of
them, because its engine is already pure in normalized time.

The socket was even left wired. `MotionBake.external` in
`frontend/shared/timeline/types.ts:277` is documented as *"frames produced by an
external baker (e.g. Space Type's Three.js engine)"*, and
`TimelineEditor.vue:1082` already skips re-baking those on export. **Nothing in
the codebase ever sets it.** This spec is the thing that plugs in.

## What makes Space Type suited to this

Three properties of the existing engine, none of which need changing:

- **Time is already normalized and scene-owned.** `SpaceTypeState` carries `fps`
  (default 30) and `loopDuration` (default 6s). `renderFrame(i)` reduces to
  `renderFrameAt((i % frameCount) / frameCount)`.
- **Effects are pure in `t01`.** The `SpaceTypeEffect` contract requires
  `update(t01, params)` to be a pure function of normalized time — no history, no
  accumulated state. Any frame can be rendered on demand, in any order. This is
  exactly the contract random-access timeline scrubbing needs.
- **Structural and per-frame work are already separated.** `buildScene()` is
  structural, `update()` is per-frame, and `liveKeys` declares which params can
  change without a rebuild. That split is what makes live playback affordable.

## Decisions

| Decision | Rationale | Alternative rejected |
|---|---|---|
| **The scene owns time** (Option 2) | `BaseClip` already has `in_frame`, `length`, `speed`, `reverse` — all of which assume the source has intrinsic time the clip windows into. A clip-length-drives-duration model would make `in_frame` meaningless and `speed` ambiguous, and would make Space Type behave unlike every other clip. | Clip owns duration (normalized 0→1 progress stretched to clip length); or a hybrid where procedural motion is rate-based and keyframed motion is scene-owned. The hybrid means two mental models in one node. |
| **Snapshot with explicit sync** (Option C) | Keeps `EditState` self-contained and serializable, which the Python export path requires — it receives JSON with no access to the node canvas. Live-linking would put the bake cache key outside `EditState`, pointing at a node that may not exist at render time. Sync is cheap because `spaceTypeSourceKey()` already computes the content hash it needs. | Live-linked (silent action-at-a-distance, orphaned clips on node delete); pure snapshot (no path to propagate a fix). |
| **Tile by default past the loop end** | Every effect is pure in `t01`, so frame `N+1` is as valid as frame `1`. Freezing on the last frame is never the desired behaviour for an inherently looping effect. One modulo. | Freeze on last frame; or hard-cap clip length at the loop duration. |
| **One shared `SpaceTypeEngine` for the whole timeline** | Browsers cap WebGL contexts at ~8–16 and Space Type node cards already compete for them. One context per clip would exhaust the budget on a modest edit. | An engine per clip. |
| **A shared `renderSpaceTypeClip()` called by every surface** | `renderMotionClip` is the one piece of render logic in this codebase that has *not* drifted across surfaces, and the reason is that it is a shared module both engines call. Follow the precedent that works. | Implementing per-surface (would create a fifth divergent compositor — see Follow-ups). |
| **Bake one loop (`k` cycles) and tile at export** | A 6s loop on a 60s clip must not bake 1,800 frames. `loopMultiplier(effect.loopRates(params))` already computes the smallest `k` where every motion rate completes whole cycles, so the tile point is seamless. | Baking the full clip length. |
| **Reuse `MotionBake` with `external: true`** | The type, the flag, and the export-side skip all already exist and are documented for this exact case. | A parallel `SpaceTypeBake` clip field. `lib/spacetype/bake.ts` already has its own `SpaceTypeBake` for the mp4 path; introducing a third bake concept on the clip would be worse. |
| **Keep Python export; do not switch to client-side encode** | Strictly larger project, and nothing in this design depends on the answer. See Follow-ups. | WebCodecs `VideoEncoder` export. |

## Model

A new member of the `Clip` union in `frontend/shared/timeline/types.ts`:

```ts
interface SpaceTypeClip extends BaseClip {
  kind: 'spacetype'
  state: SpaceTypeState      // full snapshot: effectId, params, gradientStops,
                             // fps, loopDuration, dimsKey, transparent, bgColor,
                             // post, projection, panX, panY
  loop?: boolean             // default true — tile past the source's end
  origin?: {
    node_id: string
    state_key: string        // spaceTypeSourceKey() captured at copy time
  }
  bake?: MotionBake          // external: true
}
```

Three properties of this shape matter:

**The clip carries the full state.** Exactly as `MotionClip` carries its `layer`.
`EditState` stays self-contained and serializable end-to-end.

**`origin` is advisory and never load-bearing.** Nothing in rendering or export
reads it. It exists only so the clip inspector can offer *sync from node* when
`spaceTypeSourceKey(node.state) !== origin.state_key`. A missing node or a stale
key degrades silently to a plain snapshot — no error, the affordance just does
not appear.

**Source duration is derived**, not stored: `state.loopDuration * state.fps`.
Clip `length` and `in_frame` window into it exactly as for video, so trim,
`speed` and `reverse` work through existing `BaseClip` machinery with no
special-casing.

## Live rendering

### The seam

`FrameSource` (`app/lib/engine/sources/frameSource.ts`) is a three-member
contract: `{ width, height, getFrame(n): Promise<TexImageSource>, dispose() }`.

A new `SpaceTypeSource` implements it. Wiring is two lines in
`app/lib/engine/webglPreviewRenderer.ts`: a `SpaceTypeSource.supports(clip)`
short-circuit in `resolutionPlanFor` (alongside the existing `TextCanvasSource`
one, before any URL resolution), and a case in `loadSource`.

No pixel readback is needed. `GlRenderer.setSource` does
`texImage2D(..., image)` and accepts any `TexImageSource`; a three.js canvas is
one. The `version` argument must be the source frame number (not `0`, as
`ImageSource` passes) so each frame re-uploads.

### Why one shared engine is safe

`FrameSource.getFrame` documents that the returned image is valid only until the
next `getFrame` call, and `renderFrame` honours this strictly: it awaits
`getFrame`, immediately calls `gl.setSource` (which uploads to a texture), then
proceeds to the next entry. Pixels are copied out before anything else can touch
the canvas.

So every Space Type clip can render through the same pooled engine and return
the same canvas, sequentially, with no interference. The existing contract is
tight enough to make pooling correct.

### Why the serial await does not stall playback

`getFrame` is awaited one clip at a time, so per-frame `buildScene()` would tank
playback. It is avoided by a **scene cache** inside the source, keyed on the
structural params (those not in the effect's `liveKeys`), holding the
`THREE.Object3D` each `buildScene` produced.

Switching between clips swaps which root is in the shared scene — cheap.
`getFrame(n)` is then `update(t01)` + render, which is what the node card already
sustains at 60fps. A rebuild happens only on first load or a genuine structural
edit. Two overlapping clips with different effects cost two `update` + render
passes, not two rebuilds.

The cache is LRU-bounded at 8 resident scenes. A timeline with many distinct
effects degrades to occasional rebuilds rather than exhausting GPU memory.

### Surfaces

The shared entry point is `renderSpaceTypeClip(ctx, clip, localFrame, W, H, fps)`
in `app/lib/engine/`, mirroring `motionClipRenderer.ts`.

It works on both engine types because a WebGL canvas is simultaneously a valid
`TexImageSource` (GL uploads it as a texture) and a valid `drawImage` argument
(any Canvas2D compositor can blit it). Same engine, same frame, both paths.

| Surface | Treatment |
|---|---|
| GL engine (`usePlaybackEngineGL`) | Live, via `SpaceTypeSource`. |
| Canvas2D fallback (`usePlaybackEngine`) | Live, via `drawImage` of the engine canvas. **Not optional** — `TimelineEditor.vue:226-236` falls back here whenever `webglPreviewSupported()` fails. |
| `TimelineModal.vue` | Poster frame (frame 0) for now. |
| `TimelineNodePreview.vue` | Poster frame (frame 0) for now. |

The last two carry their own hand-rolled compositors and are out of scope; see
Follow-ups. They must not be given a fourth and fifth independent Space Type
implementation.

## Export

Export runs in Python (`comfy_extras/nodes_timeline.py`) via PyAV. Python cannot
execute three.js, so frames are baked to PNG before encoding — the same
translation step motion clips already perform.

Mostly existing machinery:

- `ensureSpaceTypeBake` (`app/lib/spacetype/bake.ts`) already renders a frame
  range, uploads via `uploadFrameBatch`, and caches on `spaceTypeSourceKey(cfg)`
  plus frame count. It works unchanged.
- `MotionBake.external` is honoured at `TimelineEditor.vue:1082`, which skips
  re-baking external frames.
- `preserve_alpha=True` already exists in the Python loader, so transparent
  output composites correctly over lower tracks.

New work:

**Bake `k` loops, tile at export.** `k = loopMultiplier(effect.loopRates(params))`.
Export maps clip-local frame → `bakedFrames[n % bakedFrames.length]`.

**A `spacetype` branch in `nodes_timeline.py`.** Motion clips flatten
`clip.motion_bake.frames` into `clip.motion_frames` before the payload is sent,
and `nodes_timeline.py:1110-1124` loads those. Space Type needs the equivalent
plus the tiling modulo. This is the only backend change.

**Bake progress must be reported.** Motion clips are Canvas2D text and bake
almost instantly. A supersampled three.js effect at 1080p does not. The first
export after an edit does real work, and a silent multi-second freeze before
rendering starts reads as a hang. Bake progress reports into the existing
NDJSON stream from `/sailor/render_timeline_stream`. **This is a requirement,
not polish.**

**Explicitly not solving:** server-side three.js rendering. It would remove the
bake entirely but requires headless GL on the Python side. The content hash makes
the bake a once-per-edit cost.

## Error handling

*Written after the conversational approval — review.*

| Condition | Behaviour |
|---|---|
| `state.effectId` unknown (effect removed/renamed) | Clip loads, renders transparent, records a `loadWarning`. `webglPreviewRenderer.load()` already catches per-clip failures into `loadWarnings` and skips — follow that path. Never fail the whole timeline for one clip. |
| WebGL2 unavailable | The pooled engine cannot start. Space Type clips render transparent with a warning. This is the one capability the Canvas2D fallback cannot paper over — `drawImage` of the engine canvas still requires the engine. Must be surfaced in the UI, not just `console.warn`. |
| WebGL context lost mid-session | Dispose the pooled engine, attempt one re-init on next `getFrame`. If it fails, degrade as above. |
| Export attempted with no WebGL2 | Bake is impossible. Block export with a clear message rather than silently emitting transparent frames. |
| `origin.node_id` missing at inspector open | No sync affordance. Not an error. |
| Bake upload fails | Fail export with the failing clip named. Do not emit a partial render. |

## Testing

*Written after the conversational approval — review.*

- **Purity of `t01`** — render frame `n` after seeking forward, and again after
  seeking backward; assert identical pixels. This is the property the whole
  design rests on, and the one most likely to be broken by a future effect that
  accumulates state.
- **Seamless tiling** — with `k = loopMultiplier(...)`, assert frame `0` and
  frame `k * frameCount` are identical.
- **Bake cache key** — moving, trimming, fading, or changing opacity of a clip
  must not change `spaceTypeSourceKey`; changing text, effect, or params must.
- **Engine pooling** — a timeline with N Space Type clips creates exactly one
  WebGL context.
- **Parity** — extend `tests/timeline-golden.spec.ts`, which already diffs the GL
  engine against the server renderer, to cover a `spacetype` clip. This is the
  natural place to prove the baked frames and the live render agree.
- **Fallback** — with `sailor:Engine.WebGLPreview = 'false'`, a Space Type clip
  still renders in the Canvas2D path.

## Follow-ups (not this spec)

**Timeline compositor consolidation.** There are four independent compositors for
the same `EditState` and they have diverged:

| Surface | Transitions | Speed/reverse | Audio |
|---|---|---|---|
| GL (`lib/engine/compositor.ts`) | yes | yes | yes |
| Canvas2D (`usePlaybackEngine.ts`) | no | no | silent |
| `TimelineModal.vue` | no | no | no |
| `TimelineNodePreview.vue` | no | no | no |

Two distinct stories. GL↔Canvas2D is a *deliberate, documented* primary/fallback
pair (`docs/plans/2026-06-09-phase1-webgl-engine-design.md`, milestone M4;
promoted in `3fa9e4677`), with the maintenance tax paid consciously — see
`45a5f26ed` "render Motion clips in both preview paths". Its drift (no
transitions, no speed/reverse, silent audio in the fallback) is a real bug
affecting users without WebGL2, signalled only by a `console.warn`.

`TimelineModal.vue` and `TimelineNodePreview.vue` are a different matter. Both
were created in `b8d2e9003` (2026-05-21), **three days before**
`usePlaybackEngine.ts` existed (`f6d8d235b`, 2026-05-24) — drift by accretion,
not a rejection of the engine. They were touched again on 2026-05-29, after the
engine landed, without migrating, and no commit message explains why. The node
preview's header cites `<video>` pool isolation, which justifies not sharing an
*instance* but not a shared *implementation*.

Neither file is named in any design doc — including
`docs/plans/2026-06-18-unified-compositor-layer-model-design.md`. This is
unacknowledged debt rather than accepted debt.

**Export architecture.** Whether Python/PyAV should remain the export path.
Against: it is a second compositor that must agree pixel-for-pixel with the
first (`timeline-golden.spec.ts` exists because they can silently disagree), and
it is the sole reason baking exists. For: `nodes_timeline.py` is a ComfyUI node,
so the timeline can be rendered headlessly and driven from a graph — no
browser-side export offers that. The alternative is WebCodecs `VideoEncoder`
(decode already uses `WebCodecsSource`), which would collapse the bake and the
parity risk together; the hard part is audio, where Python does real work
(`atempo` chains, reversal, per-clip mixing). Likely end state is both, chosen
deliberately rather than accidentally. **Nothing in this spec depends on the
outcome** — if export moves client-side, the bake step deletes itself and the
clip kind, shared render function, pooled engine and `FrameSource` all stand.

**3D Studio motion.** `SceneDoc` has no time dimension — no duration, fps, or
keyframes. Adding camera keyframes, object keyframes, and procedural motion is a
separate project; once it exists, its timeline integration is substantially this
spec again, and should reuse `SpaceTypeSource`'s pooling and scene-cache
approach.

**KineticType / MotionClip convergence.** Two answers to the same question.
`KineticType` (GSAP + DOM + SplitText, bakes to a `sequence` clip) and
`MotionClip` (pure Canvas2D, live) do the same job, and MotionClip's
architecture is strictly better for the timeline. Migration is gated on a
feature-parity audit that has not been done — GSAP's SplitText provides real
per-character/word/line layout, and `kinetic-presets.ts` may depend on GSAP
easing and stagger behaviour the hand-rolled evaluator in `lib/motion/` does not
reproduce.
