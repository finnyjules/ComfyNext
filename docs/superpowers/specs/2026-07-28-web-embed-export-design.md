# Web Embed Export — Design

*2026-07-28 · Companion: [Transparent Video Export](2026-07-28-transparent-video-export-design.md)*

## The idea

Every Sailor studio is already a web renderer. Shader Studio is GLSL. Space Type and Scene3D are three.js.
Gradient is a WebGL field. Vector Type is real SVG. The bake path takes these live web things and
**flattens them into pixels** — PNG, MP4, WebM.

Rasterizing is a lossy terminal step. A web export skips it: ship the config and the renderer instead of
the frames.

What that buys over an MP4:

- **Resolution independence** — crisp at any DPR, any container size
- **Kilobytes, not megabytes** — for procedural surfaces
- **Real transparency** — a canvas composites against the page; no codec negotiates it away
  (see the companion spec for why video can't match this portably)
- **A path to reactivity** — scroll, pointer, or a data feed can drive it later

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Build order | Runtime first, surface-agnostic | Avoids an exporter shaped around one surface's quirks |
| First surface | Shader, as a **test fixture** not a feature | Only surface already close to "config in, canvas out"; proves the contract without adapter work masking a bad design |
| Snapshot semantics | **Frozen** | Matches how PNG/MP4 export already behaves; no new mental model, no coupling to a live project |
| Assets | **Fully inlined** | One file that can never break — no missing font, no dead image URL, works offline |
| Input model (v1) | **Autoplay clock only** | Ships "a video that isn't a video". Reactivity deferred but not foreclosed |
| Delivery | **Download only** | Sailor is local-first (no deploy config; `devServer.host: '127.0.0.1'`). A `127.0.0.1` URL is meaningless to anyone else, and an HTTP frame inside an HTTPS page is blocked as mixed content. Hosting can be added later without touching the bundler |

## Non-goals

**Figma Slides.** Investigated and ruled out on evidence, recorded here so it isn't re-litigated:

- Figma Slides cannot natively embed arbitrary external URLs. It cannot even embed YouTube — that is an
  open feature request on Figma's own forum. An arbitrary live WebGL page is far outside what it accepts.
- The Pitchdeck plugin does not embed live content *inside* Figma either. It exports the deck to an HTML
  presentation; the iframe lives in that export. Paying for it does not change the answer.
- Figma also does not support video transparency. WebM alpha appears to work and then breaks — Figma
  re-compresses uploads and the re-encode drops the alpha channel.

**Conclusion:** for a Figma slide, opaque MP4 is the correct format and Sailor already produces it. If
live presentation matters, present from a web deck (reveal.js, Slidev) — both free, both take iframes
natively. Figma *Sites* (their website builder, not Slides) does support generic URL embeds, so exports
drop in there if that ever becomes relevant.

**Publishing / hosting.** Cut from v1 per the delivery decision above.

**Reactivity.** Scroll, pointer, and a public JS API are deferred. The contract must not foreclose them.

## The `EmbedSurface` contract

There is no shared surface-render contract in the codebase today. `app/lib/engine/sources/` is the NLE's
*clip* abstraction (`FrameSource.getFrame(n)`), not this. The per-surface renderers are scattered and
each has its own shape: `renderSpaceTypeClipToCanvas(...)`, `renderMotionClip(...)`, a `gradientFx`
singleton resolved against `globalThis`, `shaderfill/field.ts` running a module-level frame-token cache.

This contract is the missing abstraction. In plain terms, four questions every studio must answer:

1. Here is a box on a page and here are your settings — set yourself up.
2. Draw yourself at 30% through the loop.
3. The box changed size — deal with it.
4. You're done, clean up.

```ts
// frontend/app/lib/embed/contract.ts
export interface EmbedSurface {
  /** Declared capabilities, read by the exporter. */
  readonly caps: { alpha: boolean }
  mount(container: HTMLElement, config: unknown): Promise<EmbedHandle>
}

export interface EmbedHandle {
  setTime(t01: number): void      // sync, normalized 0..1
  setSize(w: number, h: number): void
  destroy(): void
}
```

### Why these shapes

**`container`, not `canvas`.** `ShaderFxRenderer`, `GradientFxRenderer`, and the texturefx renderer are
already classes that own their canvas and GL context and hand the canvas back
(`render(...) → HTMLCanvasElement`). The adapter appends that canvas to the container. Handing them a
canvas to draw into would mean a per-frame copy — and `drawImage` off a studio WebGL canvas is known to
read stale in this codebase.

**`setTime(t01)`, not a frame index.** An embed has no fps, it has a refresh rate. Deriving `t01` from
wall clock and the snapshot's declared duration means 60Hz and 120Hz displays show the same motion.

**`mount` async, `setTime` sync.** All compiling, decoding, and asset inflation happens once at mount.
Every subsequent rAF is guaranteed a frame with no await in the hot path.

**`setTime` is public.** This is what keeps reactivity reachable. The runtime's internal clock is merely
the default caller. Scroll, pointer, and a JS API become "something else calls `setTime`", not a rewrite.

**`caps.alpha` is declared, not assumed.** Some renderers currently discard alpha —
`app/lib/engine/gl/glRenderer.ts` creates its context with `alpha: false`. `shaderfx` and `gradientfx`
leave alpha on but set `premultipliedAlpha: false`, which changes page compositing. The exporter offers
a transparent-background option only where the adapter declares support.

### Registry

`frontend/app/lib/embed/surfaces.ts` maps a surface kind to a dynamic import of its adapter. One entry
per surface — the same declaration-per-capability economics as `shader_effects/manifest.json` and
`GRADIENT_CONTROLS`. That list *is* the feature's scope, visible at a glance.

### Known cost: per-instance state

The contract requires two embeds to coexist on one page (two shader loops on one deck slide). Today
`gradientFx` binds to `globalThis` and `field.ts` keeps a module-level cache — both quietly assume one
renderer per page. Those assumptions must go. Pre-existing debt, but this is what forces payment.

## The export artifact

**One self-contained `.html` file.** Inside: the config blob, the prebuilt adapter bundle for that one
studio, every asset inlined as text, a baked poster image, and a small clock loop. No folder, no
dependencies, nothing to fetch. Open it and it plays.

**Bundles are prebuilt, not built at export time.** Each adapter gets a Vite library-mode entry, emitted
during `nuxt build` into a known static path, tree-shaken to just that adapter's dependency cone. Export
is then string assembly — grab the prebuilt bundle, paste in config, assets, and poster. Milliseconds, no
compiler on the server, and an export can only ever contain code that already shipped and was tested.

**The poster reuses the existing bake path.** No new render code — the same call that produces a PNG
today renders one frame at the snapshot's poster time and is inlined as a data URI.

**Entry point.** Export lives alongside the existing Save/Render footer actions in each studio (the
pattern established by the Type Studio panel reorg), enabled only for surfaces present in the registry.

**Size is shown before export.** Inlining means a shader is kilobytes and a 3D scene with textures could
be several megabytes. The dialog shows the real number up front.

**Two behaviors baked in.** Pauses when scrolled off-screen (IntersectionObserver) so ten embeds don't
cook a laptop. Holds a still frame when the system `prefers-reduced-motion` is set.

## Failure handling

**Every export carries a still image of itself**, baked at export time and inlined as a PNG (PNG so the
fallback composites the same way the live version does). It serves three purposes: the frame shown before
mount completes, the frame shown under `prefers-reduced-motion`, and the frame shown when the piece
cannot run at all.

That last case is real — every one of these surfaces needs WebGL2. An embed that fails should look like a
still frame on someone's site, not an empty rectangle. Same if the renderer throws mid-run: catch, swap in
the poster, never print an error into someone else's console.

**The fallback is also the hazard.** A graceful fallback that hides a dead render path is a known failure
mode in this codebase — a silently-failing shader showing its poster looks fine in a screenshot, fine to a
reviewer, and is broken. The tests below exist specifically to defeat this.

## Testing

**1. Contract conformance, per adapter.** Mount, tick, resize, destroy. Then do it *twice on one page* —
that is the test that catches the shared-state bugs we already know are there.

**2. Parity against the studio.** Render the same config at the same `t01` in Sailor and in the exported
file; compare pixels. They must match.

**3. The parity test must have teeth.** Deliberately break something — change a shader default or a
colour — and confirm the comparison **fails**. A test that cannot fail is not a test. And specifically:
assert the live canvas is on screen and the poster is hidden, so an export that fell back to its still
image can never pass.

## Open questions

- Which surface is second? Vector Type is the natural candidate (real SVG already, strongest handoff
  story), but its motion means a second rendering path — animated SVG/CSS — which is its own design.
- Payload ceiling for three.js surfaces under inline-everything. Not a v1 blocker (the fixture is
  procedural), but Space Type and Scene3D will hit it and may need a stated size cap or a refusal.
