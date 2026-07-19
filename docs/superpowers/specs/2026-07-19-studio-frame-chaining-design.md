# Studio frame chaining — Shader Studio reads motion from upstream studios

**Date:** 2026-07-19
**Status:** Design approved, ready for planning

## Problem

You cannot wire Space Type (or Gradient Studio, or any studio) into Shader Studio and have
it work. The edge draws and then nothing happens — Shader Studio shows its "Connect or add
an image" placeholder with a wire visibly attached to it.

Separately, Shader Studio only ever operates on a single still image, so there is no way to
run an effect stack over anything that moves.

These turn out to be the same problem. Solving the chaining case solves the motion case,
because studios are live renderers rather than files.

## Current state

### Why the wire does nothing

Two independent hardcoded lists, one at each end of an otherwise complete pipe:

1. **Reading end** — `resolveSrcUrl` (`frontend/app/lib/shaderstudio/source.ts:16`) recognizes
   exactly three shapes: `data.images[0]`, `LoadImage`, and `nodeType === 'Image'`. A studio
   node is none of them. Studios never execute, so `data.images` is never populated.

2. **Writing end** — `publishStudioOutput` (`frontend/app/components/vue-canvas/VueNodeCanvas.vue:3696`)
   filters its targets to `nodeType === 'Image' || type.startsWith('artifact-')`. A
   `shader-studio` node matches neither, so `targets` is empty, the fallback at `:3699`
   fires, and a *new* Image node is spawned — leaving the hand-drawn edge unused.

The edge is accepted in the first place because connection validation is deliberately
permissive (`VueNodeCanvas.vue:2084`) and studio outputs are typed `'*'` (`:1571`).

### What already works

The traversal layer is already built for this topology. `planStudioCascade`
(`frontend/app/lib/studio/cascade.ts:106`) follows *any* forward edge and collects every
studio it finds — a directly-wired Shader Studio already lands in `studioOrder` correctly.
`runStudioCascade` (`:191`) bakes in sequence, upstream-first, feeding each output onward.
Ordering and backend-tail detection are correct as written.

Both export paths also already exist in `ShaderStudioSurface.vue`: `generateImage()` at
`:412` and `generateVideo()` at `:429` (renders N frames → `ensureSpaceTypeBake` →
`POST /sailor/spacetype_encode` → MP4).

### The key structural fact

Space Type is not a file or a video — it is a **time-parameterized renderer**.
`SpaceTypeEngine(canvas)` exposes `renderFrameAt(t01, params)`, driven by a rAF loop
(`SpaceTypeSurface.vue:598`). Ask it for any normalized time, it draws that frame into an
`HTMLCanvasElement`.

`shaderFx.render(passes, base: TexImageSource, w, h)` (`frontend/app/lib/shaderfx/renderer.ts:156`)
accepts a `TexImageSource`, and `HTMLCanvasElement` is one. The two sides compose directly,
with no adapter:

```
engine.renderFrameAt(t) → canvas → shaderFx.render(passes, canvas, w, h)
```

Both are already parameterized by time. This is why chaining gives motion for free and
needs no video codec: we never encode or decode an intermediate MP4, and we can request any
frame at any resolution.

## Design

### The seam: a frame-pull registry

`cascade.ts` already has a baker registry — `StudioBaker = () => Promise<Blob | null>`,
producing one full-res still. Add a sibling for animated pulls:

```ts
/** Render frame at normalized time `t01` (0..1) at the requested size. */
export type StudioFrameSource = {
  /** Normalized-time renderer. Returns a texture-uploadable surface. */
  getFrame: (t01: number, w: number, h: number) => Promise<TexImageSource>
  /** Natural clock of this source — drives downstream export length. */
  duration: number
  fps: number
  /** Natural pixel dimensions, for aspect/size derivation. */
  width: number
  height: number
}

registerStudioFrameSource(nodeId, src)
unregisterStudioFrameSource(nodeId)
getStudioFrameSource(nodeId)
```

`StudioBaker` stays as-is for the still case. This is additive.

Space Type registers a `StudioFrameSource` backed by `engine.renderFrameAt`.

**A source with `duration <= 0` is a still.** Shader Studio pulls a single frame at
`t01 = 0`, does not start an animated preview loop, and falls back to its own `motion`
settings for export length. Studios that are not animated (Gradient Studio today) may
therefore either register a `duration: 0` source — gaining arbitrary-resolution pulls
without implying motion — or register nothing and resolve via the artifact path. Both are
valid; neither is required for this change to land.

### Source resolution order in Shader Studio

Shader Studio resolves its input by priority, first match wins:

1. **Live upstream studio** — a registered `StudioFrameSource` on the directly-wired
   source node. Gives animated, arbitrary-resolution frames.
2. **Artifact file** — the existing `resolveSrcUrl` paths (`data.images[0]`, `LoadImage`,
   `nodeType === 'Image'`). Unchanged; this keeps the current 3-node topology working.
3. **Own uploaded/asset source** — `config.source`. Unchanged.

Deliberately, the artifact path is *not* removed. Space Type → Image artifact → Shader
Studio keeps working exactly as it does today, and the artifact remains useful as a cache.
Direct wiring becomes an additional option, not a replacement.

### Clock ownership

**Whoever supplies the frames owns the clock.** When Shader Studio resolves to a live
upstream frame source, that source's `duration` and `fps` drive export length; Shader
Studio's own `motion.duration` / `motion.fps` become read-only and are displayed as
derived (e.g. "3.4s / 102 frames — from Space Type").

Shader Studio's own motion tracks still apply — they stretch to span the upstream duration,
so a `from`→`to` ramp runs exactly once across the clip. `applyMotion(cfg, t)`
(`frontend/app/lib/shaderstudio/motion.ts:72`) is unchanged; only the `t` values fed to it
change.

**Chains with multiple animated studios:** each Shader Studio node reads its *direct*
upstream only. There is no global clock negotiation. Studio chains are linear in practice,
so the nearest animated ancestor wins and the rule stays predictable. A node with no
animated upstream falls back to its own `motion` settings, exactly as today.

### Sites that change

Three places currently conflate "animated" with "this node's own motion tracks are running":

1. `ShaderStudioNode.vue:71` — card preview rAF loop starts only when `animated.value`.
   Must also loop when the resolved source is animated, or a chained node shows a frozen
   frame on the canvas.
2. `ShaderStudioSurface.vue:254` — modal preview loop, same condition, same fix.
3. `ShaderStudioSurface.vue:436` — `total = fps * motion.duration`. Must read the resolved
   source's clock when one is present.

Plus the two hardcoded lists:

4. `source.ts:16` — extend resolution to check the frame-source registry first.
5. `VueNodeCanvas.vue:3696` — allow studio nodes as publish targets so the cascade's
   existing studio→studio traversal is not undone by the publish step spawning a stray
   Image node.

### Render loop becomes async

`getFrame` returns a promise, so both preview loops become async. Guard against overlapping
frames (skip a tick if the previous `getFrame` has not resolved) rather than queueing, so a
slow upstream degrades to a lower frame rate instead of unbounded lag.

## Non-goals

- **No shader section inside each studio's modal.** Shader Studio stays the single shader
  implementation. Duplicating shader UI into every studio is exactly the render-parity drift
  problem that has bitten this codebase before.
- **External video files are deferred.** A video file's decoder (`FrameSource` in
  `frontend/app/lib/engine/sources/frameSource.ts`, WebCodecs with an element-seek
  fallback) has the same `(time) → TexImageSource` shape and becomes a third producer
  behind the same seam later. Explicitly out of scope here.
- **No trim/speed controls.** Upstream owns the clock, full stop.
- **No keyframe editor.** `MotionTrack`'s two-endpoint `from`/`to` model is unchanged.

## Performance

Measured 2026-07-19 via `frontend/app/pages/dev/shader-bake-bench.vue` (median of 5,
synchronous encoder; the WebGL render itself is sub-millisecond and not the constraint):

| res | PNG encode | JPEG q0.92 | WebP q0.92 | PNG size | JPEG size |
|---|---|---|---|---|---|
| 1024 | 16ms | 8ms | 53ms | 525 KB | 83 KB |
| 1536 | 27ms | 20ms | 95ms | 783 KB | 123 KB |
| 2048 | 44ms | 29ms | 169ms | 1.1 MB | 207 KB |
| 4096 | 138ms | 117ms | 587ms | 2.3 MB | 514 KB |

Conclusions that shaped this design:

- **Encode is not the bottleneck.** 44ms/frame at 2048. A 5s clip at 30fps (150 frames) is
  ~7s of encoding. Chaining ships without touching the bake path at all.
- **WebP is not viable** — 3–4× *slower* than PNG despite smaller output. Rejected.
- **JPEG q0.92 is the cheap win**: 1.2–2× faster, 4–6× smaller. Alpha is not a concern —
  `/sailor/spacetype_encode` already flattens RGBA on black, so JPEG loses nothing real.
  Requires fixing `uploadFrameBatch`, which hardcodes `.png` / `image/png`
  (`frontend/app/composables/useKineticRenderer.ts:410-411`).
- **Memory is the real cliff.** `ensureSpaceTypeBake` accumulates every frame blob in RAM
  before uploading (`frontend/app/lib/spacetype/bake.ts:31-35`). 900 frames at 2048 PNG is
  ~1.03 GB; at JPEG it is ~190 MB. This matters past roughly 300 frames, so streaming the
  bake is a **follow-on, not a blocker** — which keeps Space Type's live bake path out of
  this change's blast radius.

**Unresolved measurement:** at 4096, `toBlob` added ~1.1s/frame over the synchronous
encoder, but only at 4096 and only with upload measurement active. This smells like an
automation artifact, but if real in Chrome it makes 4096 baking ~10× worse than the table
implies. The bench flags it in a `toBlob +ms` column. Confirm in a real browser before
raising any resolution ceiling.

## Bugs found in passing (not in scope, worth tracking)

- `uploadFrameBatch` (`useKineticRenderer.ts:421`) silently swallows failed uploads; then
  `ensureSpaceTypeBake` (`bake.ts:42`) throws on the resulting count mismatch. One dropped
  frame discards an entire completed bake. Affects the current Space Type path today.
- Uploads are strictly sequential — one POST per frame in an `await` loop
  (`useKineticRenderer.ts:408`).
- `SpaceTypeNode.vue` uses a raw `<Handle>` rather than `VueCanvasNodePort`, so its output
  port gets no type colour, hover label, or drag-time compatibility highlighting.
- `renderBlob` passes `0.95` as a quality argument to `toBlob` with `image/png`
  (`ShaderStudioSurface.vue:378`), where it is silently ignored.

## Testing

**Unit** (pure, no DOM — matching how `cascade.ts` traversal is already tested):
- Frame-source registry: register / resolve / unregister, and resolution priority order
  (live source beats artifact beats own config).
- Clock derivation: upstream duration/fps wins; falls back to own `motion` with no
  animated upstream; nearest-ancestor rule in a 3-studio chain.
- `applyMotion` track stretching across an upstream-derived duration.

**Integration / manual** (must be driven in the real app, per the verify skill):
- Space Type → Shader Studio direct wire: card preview animates, modal preview animates.
- `generateVideo` from a chained node produces an MP4 whose length matches the upstream
  clip, not Shader Studio's `motion.duration`.
- `generateImage` from a chained node still produces a single correct frame.
- Existing 3-node topology (Space Type → Image artifact → Shader Studio) still works
  unchanged — this is the main regression risk.
- Gradient Studio (non-animated) → Shader Studio still produces a still.
- Space Type's own bake/export path unaffected.

## Risks

- **Regression surface is the existing artifact topology.** The resolution-order change and
  the `publishStudioOutput` target filter both sit on paths that currently work. These need
  explicit before/after verification, not just new-feature testing.
- **Cross-node renderer coupling.** Shader Studio pulling frames from another node's live
  engine is more coupling than a file handoff. Mitigated by keeping the seam narrow — the
  registry hands over a plain `(t, w, h) → TexImageSource` function and nothing else.
- **Unmounted upstream studios.** A studio that is off-screen or never opened has no
  registered frame source. Resolution must fall through to the artifact path rather than
  fail — same concern `runStudioCascade:201` already handles for bakers by skipping and
  logging.
