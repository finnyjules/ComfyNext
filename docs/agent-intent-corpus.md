# Agent Intent Corpus

The de-risk artifact for the [agentic north star](./agentic-north-star.md). It measures **how well natural-language instructions translate into real operations** today, grounded in the actual vocabulary of each surface (not estimates). Each intent is classified against the real code.

When F1's `describe()` exists, this becomes the **live regression harness** — replay each intent against the real describe payload and score the model's output. For now it measures *vocabulary coverage*, which is what actually bounds translation.

## Rubric

- ✅ **LIVE** — a real command/param exists *and* is reachable/describable to the model.
- 🟡 **HINT** — the command/param exists, but a qualitative/ambiguous phrase needs semantic hint metadata (F3) to map. Cheap: metadata, no code.
- 🔧 **BUILD** — no command or no addressable object yet. Split into *INERT→addressable* (exists in code, just expose it — F1's job) vs *ABSENT* (new capability).
- 🧱 **CEILING** — even a new verb can't express it; the architecture/geometry won't allow it, or it belongs to a different engine. A boundary, not a failure.

## Aggregate result (125 single-surface intents)

| Bucket | Count | Share |
|---|---|---|
| ✅ Live today | 65 | ~52% |
| 🟡 One hint away (F3) | 23 | ~18% |
| 🔧 Build — *expose existing* (F1) | ~17 | ~14% |
| 🔧 Build — *new capability* | ~9 | ~7% |
| 🧱 Ceiling | 11 | ~9% |

**The reachability ladder:** ~52% works today → **~70% with hints (F3, pure metadata)** → **~84% once you also expose what already exists (F1's describe/command surface)** → only ~7% needs genuinely new capability → ~9% is out of scope by design.

## Headline findings

1. **The describe-layer-vs-substrate gap is the dominant bottleneck.** The biggest single class of failure isn't missing capability — it's capability the agent *can't see or reach*. Type Studio's describe path (`describeControls`) ships only the active effect's controls and excludes `fillList` + the entire shared engine (post-fx, projection, pan), so "make it warmer" — the most common designer ask — fails on most effects across *every* phrasing. The Canvas has `setNamedWidget`/`removeNodes`/`spliceIntoEdge` built and tested but with no natural-language entry point. **F1's command/describe surface is the single largest unlock**, because most BUILD items are "function exists, no NL route."
2. **Hints (F3) buy ~18% for pure metadata** — concentrated in the qualitative/generative studios (Shader/Gradient/Texture, ~33% hint).
3. **Per-surface readiness varies widely and predictably:** Compositor (~65% live) and Smart Layout (~63%) are agent-ready now; Type Studio (~42%), Texture (~40%), and Canvas-mutation lag — but mostly from the *describe gap*, not missing features.
4. **Ceiling items are honest boundaries.** Text-flow-around-image, blend compositing, animation in static engines, per-tile addressing, PBR materials, shader stage-reorder/stacking, and "make it pop" on the raw node graph. Several live in *other* engines (motion → the timeline engine). Don't chase.
5. **Grounding overturned two of my earlier inferences** — proof the robust version was worth it: Compositor text *content* is LIVE (`setLocal {text}`), not a gap; Shader pipeline reorder/stacking is CEILING (no stage array; effect slot replaces), not a cheap expose.
6. **One cheap move recurs everywhere: a thin NL→command router** onto functions that already exist (`setNamedWidget`, `removeNodes`, `spliceIntoEdge`, the hidden Texture fills, the unexposed Type Studio post-fx). That router *is* F1.

---

## Type Studio — ✅11 / 🟡4 / 🔧9 / 🧱2 (26)

*Describe path sends only the active effect's `controls` (slider/select/color/font); `fillList` + engine substrate (post-fx, projection, pan) are invisible to the agent.*

| Intent | Bucket | Reason |
|---|---|---|
| Change the font | ✅ | `font` kind AI-visible |
| Rotate 45° | ✅ | `rotateZ` slider (deg→rad friction) |
| Make text bigger / bump type size / letters too small | ✅ | `typeHeight` (cluster robust) |
| Speed it up / slow it down | ✅ | `speed` slider |
| More energetic | 🟡 | speed+amplitude, no hint to disambiguate |
| Make it warmer / cozier / too cold | 🔧 inert | primary palette is `fillList`, excluded from describe — fails across all phrasings |
| Add more ribbons | ✅ | `ribbonCount` |
| Cylinder spin faster | ✅ | `spinSpeed` |
| Tunnel deeper + more layers | ✅ | `depth` + `layers` |
| Tilt the globe axis | ✅ | `axisTilt` |
| Crank the slit-scan smear | 🟡 | `ssDelay`/`ssBands`, jargon + no hint |
| Make it pop | 🟡 | ambiguous; natural targets (bloom/contrast) unexposed |
| More chaotic | 🟡 | `snakeAmplitude`/`Frequency`, no hint |
| Flat isometric view | 🔧 inert | `setProjection` exists, not a control |
| Pan to the right | 🔧 inert | `setPan` exists, not a control |
| Soft dreamy glow + blur | 🔧 inert | bloom+blur post-fx not exposed |
| Punch up contrast + saturation | 🔧 inert | adjust post-fx not exposed |
| RGB-split / chromatic aberration | 🔧 inert | `chroma` not exposed |
| Switch to the Melt effect | 🔧 absent | effect identity not an addressable target |
| Slowly zoom the camera over the loop | 🧱 | params static across loop; no keyframe channel |
| Wrap text around a Möbius strip | 🧱 | geometry builders can't express it |

## Compositor — ✅15 / 🟡4 / 🔧3 / 🧱1 (23)

*Every edit flows through `setLocal(id, patch)` — any typed property is headlessly addressable.*

| Intent | Bucket | Reason |
|---|---|---|
| Rotate the badge 45° | ✅ | `{rotation}` |
| Nudge toward top-left | 🟡 | `{x,y}` exist; "top-left"→coords needs anchor map |
| Rect fill #FF5500 | ✅ | `{fill}` solid |
| Circle radial gradient | ✅ | `{fill}` radial |
| Heading bold + bigger | ✅ | `{fontWeight,fontSize}` |
| Change headline to "SUMMER SALE" | ✅ | `setLocal {text}` — content IS settable |
| Soft drop shadow | ✅ | `effects:[drop_shadow]` |
| Duplicate into 3×3 grid | ✅ | `{cloner:grid}` |
| Bring photo to front | ✅ | `moveStackZ` / `setStackOrder` |
| Clip to ellipse | ✅ | `{mask:ellipse}` |
| Mask with the star shape | ✅ | `maskedByKey` silhouette |
| Background solid black / dark backdrop | ✅ | `setBackground` (cluster) |
| Delete the title / get rid of the headline | ✅ | `deleteLocal` (cluster) |
| Tilt like lying on a table / subtle 3D lean | 🟡 | `cornerPin`/`skew` exist; verbal→geometry map (cluster) |
| Make the title pop | 🟡 | ambiguous over real params |
| Semi-transparent panel + centered text | ✅ | compound, all live |
| Make the poster warmer / vintage | 🔧 absent | no doc-level color grade (only per-image `tint`) |
| Replace the logo with this upload | 🔧 | image ingest needs a File + upload, no NL path |
| Switch to 16:9 widescreen | 🔧 inert | canvas aspect derived from base layer; no setter |
| Curve the headline along an arc | 🧱 | flat text block; no text-on-path |

## Smart Layout — ✅15 / 🟡3 / 🔧3 / 🧱3 (24)

*Plain-JSON doc model; pure-function engine. `section.children` exists but no add-to-existing-section command.*

| Intent | Bucket | Reason |
|---|---|---|
| Add a headline | ✅ | `addText` |
| Nudge the logo up two cells | ✅ | `nudgeSelected` |
| Switch to the square size | ✅ | `selectOutput` |
| Apply brand colors | ✅ | `setBrand` |
| Use the Editorial archetype | ✅ | `loadArchetype` |
| Group headline+CTA / combine title+button / wrap together | ✅ | `groupSelectedInto` (cluster) |
| Instagram Stories size / adapt to tall vertical | ✅ | `addOutput` + auto cross-format adapt (cluster) |
| Create a footer section at the bottom | ✅ | `addSection` + `setSectionRegion` |
| Ungroup the hero | ✅ | `ungroupSelectedSection` |
| Group + pin lockup to top on portrait | ✅ | group + `setSectionRegion` (regionByClass) |
| Editorial + brand + square + portrait | ✅ | compound |
| Export all ad sizes | ✅ | `outputs[]` matrix (render via node-run) |
| Make it bolder / more editorial | 🟡 | archetype/typeScale exist; no vibe map |
| Make this bigger | 🟡 | ambiguous target/axis |
| Move the logo up | 🟡 | ambiguous scope (master/class/override) |
| Put the product photo in the headline section | 🔧 inert | `section.children` renders but no `addChildToSection` |
| Auto-arrange to fill the space / tidy cramped spacing | 🔧 absent | internal auto-layout not built |
| Text wrap around an image | 🧱 | rectangular grid, no flow geometry |
| Animate the headline sliding in | 🧱 | static resolver; motion = separate timeline engine |
| Overlap with a multiply blend | 🧱 | no blend/compositing in schema |

## Shader + Gradient — ✅8 / 🟡6 / 🔧2 / 🧱2 (18)

| Intent | Studio | Bucket | Reason |
|---|---|---|---|
| Lens blur ~20px, focus top-left | Shader | ✅ | `post.blur` |
| Faded risograph / two-color screenprint | Shader | 🟡 | `duotone`+contrast; hint (cluster) |
| Kill the chromatic aberration | Shader | ✅ | `chromatic.enabled=false` |
| Run bloom before color adjust | Shader | 🧱 | hardcoded stage order, no order field |
| Halftone + ASCII together | Shader | 🧱 | single effect slot; picking replaces |
| Reroll with a different seed | Shader | 🔧 inert | `u_seed` is literal `42` |
| Punch contrast, mute, warm it | Shader | ✅ | `adjust.*` compound |
| Pulse exposure over 4s | Shader | ✅ | motion track |
| Radial burst layout | Gradient | ✅ | `canvas.layout='radial'` |
| Teal→coral, 3 hard steps | Gradient | ✅ | `stops` + `steps` |
| Swirling marble / liquid oil-slick | Gradient | 🟡 | `flow.veins/swirl/gloss`; hint (cluster) |
| Soften the mesh blobs | Gradient | ✅ | `mesh.softness` |
| Reroll a variation | Gradient | ✅ | `reroll` |
| Shuffle, surprise me | Gradient | 🟡 | reroll scope ambiguous |
| Make it calmer | Gradient | 🟡 | multi-lever holistic |
| Animate hue shift + film grain | Gradient | 🔧 | grain live; hue-over-time not animatable (motion only targets shape) |

## Texture — ✅6 / 🟡4 / 🔧3 / 🧱2 (15)

| Intent | Bucket | Reason |
|---|---|---|
| Arcs truchet, 16 cells | ✅ | `tileFamily`+`cells` |
| Hex, flat-top | ✅ | `shapeFamily`+`hexOrient` |
| Switch to herringbone | ✅ | `shapeFamily` |
| Classic parquet zigzag | 🟡 | synonym hint → herringbone |
| More cells, denser | ✅ | `cells` |
| Smaller tiles, repeat more | 🟡 | ambiguous by mode (cells vs rasterScale) |
| More chaotic / random | 🟡 | multi-knob (jitter/placement/coherence) |
| Bayer 4×4 dither, 4 levels, mono | ✅ | `stylize=dither` + params |
| Retro washed-out vintage | 🟡 | map vintage→posterize/duotone |
| Color the weave gaps red | 🔧 inert | per-role `Fill` built+rendered but hidden |
| Fill the fish-scales with a gradient | 🔧 inert | same hidden-fills gap |
| Animate the arcs spinning, loop | 🔧 absent | no time uniform (`_time` reserved) |
| Make just the top-left tile blue | 🧱 | hash-seamless, no per-tile identity |
| Fishscale + tighten spacing + outline + posterize | ✅ | compound |
| Realistic brushed metal | 🧱 | no PBR/material generation |

## Canvas (nodes) — ✅10 / 🟡2 / 🔧6 / 🧱1 (19)

*Discovery is strong (`searchNodes`, `buildCatalog`, `NODE_KEYWORDS`); mutation functions exist but lack an NL entry point.*

| Intent | Bucket | Reason |
|---|---|---|
| Upscale / make it higher res / 4k it | ✅ | `searchNodes` → UpscaleImageNode (cluster) |
| Remove the background / cut it out transparent | ✅ | `canonicalNodeForIntent` (only boosted node) (cluster) |
| Knock out the backdrop | 🟡 | missing synonym in `NODE_KEYWORDS` |
| Blur the background / shallow depth of field | ✅ | `searchNodes` → LensBlur (cluster) |
| What turns this video into frames? | ✅ | `buildCatalog` port-type hop1 |
| What can I feed this into? | ✅ | `buildCatalog` from anchor |
| Turn this into a 3D model | 🟡 | port-type works; no 3D keywords |
| Add an upscaler then save it | ✅ | multi-step AI path (`buildCatalog` + validate) |
| Set the steps to 30 | 🔧 inert | `setNamedWidget` exists, no NL route |
| Lock the seed | 🔧 inert | SEED_CONTROL + setNamedWidget exist, no NL route |
| Drop a bg remover between these nodes | 🔧 inert | `spliceIntoEdge` exists, no NL route |
| Delete this node | 🔧 inert | `removeNodes` exists, no NL route |
| Replace the sampler with a different one | 🔧 absent | no replace-node fn + ambiguous |
| Fix it | 🔧 absent | no clarify/disambiguation loop |
| Make it pop | 🧱 | no node op for an aesthetic vibe |

---

## Cross-cutting & adversarial (the harder class — Phases 3–4 territory)

These don't belong to a single surface; they skew toward BUILD/CEILING, confirming that cross-surface, holistic, and campaign intents are the genuine frontier.

| Intent | Bucket | Reason |
|---|---|---|
| Apply my brand kit across all the studios | 🔧 inert | brand exists per-surface; no cross-surface broadcast |
| Match the poster's colors to the gradient I made | 🔧 absent | no cross-surface color-borrow primitive |
| Export everything as PNGs | 🟡 | render exists; download UI-coupled; needs export command |
| Undo that | 🔧 inert | per-surface undo exists; no NL undo route |
| Give me three variations of this | 🔧 absent | branching not built (Phase 3) |
| What can you change here? | ✅ | this *is* `describe()` — free once F1 lands |
| Generate one for each product in my list | 🔧 absent | data-merge parked (Phase 4) |
| Make it match our other campaigns | 🧱 | holistic brand-consistency, no target |
| Make it pop (universal) | 🧱 | no universal target; per-surface hint at best |
| Translate the headline to French | 🔧 absent | text settable, but translation is a gen step |

---

## What this reorders (cheapest, highest-frequency wins first)

1. **Widen the describe surface (F1) — biggest unlock.** Expose Type Studio's `fills` + post-fx + projection/pan; add the NL→command router for the Canvas's existing `setNamedWidget`/`removeNodes`/`spliceIntoEdge`. Pure expose-what-exists.
2. **Author F3 hints** — ~18% of intents for metadata only; prioritize the qualitative studios + the spatial/anchor and magnitude maps ("top-left", "subtle", "pop").
3. **The cheap per-surface exposes** — Texture fills (already a task), Smart Layout `addChildToSection`, Shader seed/reroll, Compositor canvas-format setter.
4. **Genuinely new (defer / Phase 3–4):** internal auto-layout, gradient color/flow animation, doc-level color grade, node replace + clarify-loop, branching, data-merge.
5. **Don't chase (ceiling):** shader stage-reorder/stacking, per-tile addressing, PBR materials, text-on-path/flow, blend compositing, in-engine animation that belongs to the timeline.

## Next step

Expand toward ~200 intents if a firmer number is wanted, but the signal is already stable: **F1 + F3 alone unlock ~84% of single-surface intents.** Convert this to the live harness the moment F1's `describe()` exists.
