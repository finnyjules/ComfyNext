# Node anatomy & hierarchy — design

**Date:** 2026-07-18
**Status:** approved, ready to implement

## Problem

Canvas nodes read as visually inconsistent ("all over the place"). Two distinct
causes, confirmed by reading the code:

1. **Two unrelated port paradigms.** Graph nodes (`ComfyNode`, `ComfyGateNode`,
   `SubgraphIONode`, `ShaderEffectNode`) render labeled, type-coloured pill rows
   in a recessed band under the title bar. The ~15 artifact/studio nodes render
   bare `<Handle>` dots absolutely positioned with an inline `top`.

2. **Hand-tuned port offsets.** Across the artifact family the offsets are magic
   numbers: `50%` on most, `62%` on `ArtifactTimelineNode`, mixed `50%`/`72%` on
   `PoseMannequinNode`, `38px` on `CharacterSheetNode`, `22px` on
   `Scene3DStudioNode`, and no override at all on `CollectionNode`. Seven
   different vertical positions, several silently coupled to header height.

Underneath both sits a hierarchy failure: **every node carries the same visual
weight.** A Reroute reads as loudly as a KSampler, and on every graph node the
highest-chroma element is the port band — so the eye lands on plumbing rather
than on the work.

## Non-goals

- Moving ports to the bottom of the node. Considered and rejected: it puts wire
  endpoints below every collapsible region (widget groups, advanced fold, result
  preview, dynamic port growth), so expanding a preview would drag every
  connected edge downward.
- Removing prompts from generator nodes. Inline prompts are a deliberate
  beginner-ergonomics win and are preserved.
- Reworking agent graph layout/spatial organisation. Real, but a separate spec.

## Design

### 1. Ports leave the vertical stack (B′)

Ports become **edge-anchored dots on every node**, outside the content flow, with
labels revealed on hover. No node has a port band.

**Placement rule** (replaces all seven magic offsets): inputs stack down the left
edge, outputs down the right edge, both starting at a fixed offset below the
node's top edge, at a fixed pitch. Identical maths for every node type — nothing
coupled to header height, nothing tuned per node.

```
PORT_TOP_START = 46px   // first port centre, below the node's top edge
PORT_PITCH     = 20px   // centre-to-centre spacing
top(i) = PORT_TOP_START + i * PORT_PITCH
```

Recessive nodes (below) use a smaller start offset to match their shorter header.

**Labels on hover, plus wire-drag state.** Hovering a dot reveals its label.
While the user is dragging a wire, every type-compatible port lights up and
self-labels while incompatible ports dim. This is a deliberate trade: always-on
labels shout full-time for a task done occasionally; contextual labels appear
exactly when wiring.

**Wire geometry is safe.** Vue Flow measures handle DOM rects itself and passes
resolved coordinates to `ComfyEdge.vue`; nothing in the app computes endpoints
from `node.y + HEADER_HEIGHT`. Ports stay above all collapsible regions, so
endpoints remain stable when previews and widget groups toggle.

### 2. Two tiers, decided by content

The tier test is: **does this node carry content you author or read?**

- **Dominant** — generators, artifacts, studios, and composition surfaces. Larger,
  stronger border and shadow, media edge-to-edge, full opacity.
- **Recessive** — config-only utilities with nothing to show. Narrower, reduced
  opacity, compact header, no preview.

**Sorting** (settled with the user):

| Tier | Nodes |
|---|---|
| Dominant | All generators; all `Artifact*` nodes; `Character`, `CharacterSheet`, `Scene3DStudio`, `ShaderStudio`, `ShapeStudio`, `TextureStudio`, `SpaceType`, `ShotDirector`, `Gradient`, `Reference`, **`Compositor`, `SmartLayout`, `PoseMannequin`, `Collection`** |
| Recessive | `ComfyGateNode`, `SubgraphIONode`, reroutes, `Upscale`, `BgRemove`, `FaceRestore`, `ObjectRemove`, `LensReframe`, `Crossfade`, `ShaderEffect`, and other pass-through utilities |

Rationale for the four contested cases: Compositor, SmartLayout, PoseMannequin
and Collection are destinations you compose *in*, not steps you pass through.

Most of the perceived gain comes from the **recessive** tier getting out of the
way, not from the dominant tier growing louder.

### 3. The image must shine

The dominant tier exists to make generated media the most important thing on the
canvas. Concretely, for artifact image/video nodes:

- Media renders **edge-to-edge** — no header bar above it. Identity is a light
  overlay on the media itself.
- Dominant artifact nodes get a **larger default width** than today's 240px.
- All chrome that is not state or content is **hover-revealed**, so at rest the
  node is essentially just the image.
- Visual weight (border, shadow) is stronger than any operator, so a graph reads
  as "images, connected by machinery" rather than "boxes, some of which contain
  images".

### 4. Artifact action consolidation

`ArtifactImageNode` currently has **three** action zones: a hover-revealed
Edit/Next row at top-right, a persistent footer bar with six icon buttons
(replace, download, lock, re-render, save-as-character, @-name), and a
sketch-only Keep / Develop row.

Consolidate to the **top hover row**, with three carve-outs:

1. **State stays visible.** Lock carries state (renders amber when locked) and
   changes what happens on Run. It gets a small persistent badge when locked;
   the toggle itself may live in the hover row. Dimensions stay persistently
   readable.
2. **Sketch Keep / Develop stays persistent.** For a sketch-option card those two
   buttons *are* the point of the card; hiding them behind hover reintroduces the
   discoverability problem inline prompts were kept to avoid.
3. **One shared button style.** Edit currently uses a bespoke pastel gradient
   while the footer six are plain white/45 icon buttons. Placing them adjacent
   makes the mismatch louder. One primary-action style is chosen and applied
   across node types.

### 5. Shared implementation, not copy-paste

The port band markup is currently duplicated verbatim between `ComfyNode.vue` and
`ComfyGateNode.vue`. The replacement ships as **one shared port component plus
one placement module**, consumed by every node type. Tier styling likewise lives
in a single module rather than per-component classes.

## Risks

- **Losing always-on port labels** is a real regression for high-input nodes such
  as Compositor when *not* dragging. Mitigation is the wire-drag lighting state.
  If it proves insufficient in use, the fallback is labels-always-on for
  high-input nodes and hover-only elsewhere.
- **Hover-only actions are invisible on touch input.** Acceptable for a
  desktop-first canvas; noted rather than solved.
- **`updateNodeInternals` is never called anywhere in the app.** Handle positions
  rely entirely on Vue Flow's ResizeObserver. Moving to edge-anchored dots does
  not worsen this, but conditional handles that mount/unmount already depend on
  that implicit refresh and should be watched during rollout.

## Implementation order

1. Shared port component + placement module; migrate the four graph-node types.
2. Migrate the artifact/studio family off inline `top` offsets.
3. Tier module + styling; apply the sorting above.
4. Artifact action consolidation and the image-forward treatment.

Each phase is independently verifiable on the canvas.
