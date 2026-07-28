# The node capsule — design

**Date:** 2026-07-27
**Status:** Design for review — not yet planned
**Framing:** A collapsed resting state for canvas nodes. This is one move out of a six-move canvas redesign; the other five are explicitly parked (see *Out of scope*).

## The idea in one line

A node that isn't being worked on collapses to a **40px capsule** — icon, name, one line of read-out, and a run button — and expands back to its full card in place when you reach for it.

## Why this, and why now

The design north star in [VISION.md](../../VISION.md) says the canvas should be *"a journey, not machinery"*. Today it is machinery, and the loudest reason is that **everything on it has the same visual weight**. `ComfyNode` is `w-[260px]`, studio nodes are `w-[220px]`, `ArtifactImageNode` is `w-[240px]`. A KSampler and a finished hero image occupy the same real estate, so nothing on the canvas is more important than anything else.

The capsule fixes that by making size encode importance. But the reason it works rather than just hiding things is the **run button**: most of what you do to a finished step is re-run it, not re-edit it. A capsule that can be fired without opening covers the common case, which is what makes collapse-by-default defensible instead of a compromise.

Decided across four rounds of mockups (artifacts published 2026-07-27):

- Treatment **D** — two lines, not a one-line pill. A bare label read as too thin.
- Plus an **identity icon** and an **action button**.
- Running keeps the **existing** border sweep and flowing-wire animations, in their **existing type-colour gradients**.
- The action button is **action blue to run, coral square to stop**.

## What this is not

The read-out line is a **summary, never a control**. No sliders, no inputs, no editable fields on a capsule. That single rule is what keeps this a capsule and not a small card — the moment you can change a value without expanding, the capsule grows back into the thing it replaced.

## Out of scope

Parked from the wider canvas redesign, to be taken separately if at all:

- Replacing the 24px dot lattice / 16px snap grid
- Retiring the minimap
- Neutralising wires and hiding ports at rest
- Rewriting machine copy (`Run` / `Idle` / `0 running` / `Empty Latent Image`)
- Turning prompt nodes into plain canvas text

The capsule does not depend on any of them and they do not depend on it.

## Anatomy

```
┌──────────────────────────────────────────┐
│  [icon]   Flux Dev                  [▶]  │   ~44px tall
│           28 steps · guidance 3.5        │   260px — the card's width
└──────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Shell | 260px wide &mdash; the same as the card it stands in for (208px recessive), so expanding changes height only. `border-radius: 13px` (concentric: 7px inner + 6px padding), `background: #1f1f1f`, `border: 1px solid rgba(255,255,255,.13)`, `box-shadow: 0 3px 12px rgba(0,0,0,.4)`, padding `6px 7px`, gap `9px` |
| Icon tile | 26px, `border-radius: 7px`, `background: rgba(255,255,255,.07)`, glyph `rgba(255,255,255,.72)` at 15px. **Neutral — no type tint.** |
| Name | 12.5px / `rgba(255,255,255,.88)`, single line, truncates |
| Read-out | 10.5px / `rgba(255,255,255,.4)`, `font-variant-numeric: tabular-nums`, single line, ellipsis |
| Action | 26px visible, `border-radius: 7px`, 40×40 hit area via `::after`, `scale(0.96)` on press. Idle `background: color-mix(in oklab, var(--action) 20%, transparent)`, glyph `color-mix(in oklab, var(--action) 58%, white)`, `opacity: .62`. Hover → `background: var(--action)`, glyph `#fff`, full opacity. |
| Ports | Hidden at rest, centred on each edge, revealed with the action button on hover |

Roughly a seventh the area of a 200×150 card, and legible down to ~50% canvas zoom — the point where a card's parameter rows have already turned to mush.

## Colour rule

**Colour on a capsule means state, never type — with one bounded exception.**

| Meaning | Token |
|---|---|
| Run / running / re-run | `--action` = `oklch(0.574 0.234 260.696)` ([main.css:201](../../../frontend/app/assets/css/main.css)) |
| Stop, and failure | `--palette-coral` = `oklch(0.697 0.193 26.566)` |
| Everything else | neutral white-alpha |

Coral is a **filled glyph on a neutral chip**, never a solid red button — matching the existing toolbar stop at [default.vue:4224-4228](../../../frontend/app/layouts/default.vue).

The icon tile is deliberately neutral. Tinting it by output type rebuilds the 12-colour schematic legend this design is trying to retire.

**The exception:** the running border sweep keeps its `input-type → output-type` gradient. While data is actually moving, the type map is telling you something real — direction of flow — so it earns colour for the length of the run and gives it back afterwards. The cost, stated plainly: `LATENT #a78bfa` and `MODEL #c084fc` ([useVueNodes.ts:35-65](../../../frontend/app/composables/useVueNodes.ts)) mean purple appears on sampler and loader sweeps mid-run, which `main.css:222` otherwise forbids. Purple bounded to a run is a different thing from purple sitting on a static header.

## The four states

| State | Border | Read-out | Action |
|---|---|---|---|
| **Ready** | default | settings summary | play, action blue |
| **Running** | transparent + border sweep | `rendering · 12s` | coral stop square |
| **Done** | default | settings summary | re-roll glyph, action blue |
| **Failed** | `color-mix(in oklab, var(--coral) 45%, transparent)` | the error message | alert glyph, coral |

The read-out doing double duty — settings when idle, status when not — is what buys the capsule the right to stay closed through an entire run–fail–retry cycle. Without it you'd have to expand to find out what happened after pressing play, which defeats the whole thing.

## Animations — reuse, with two fixes

Both animations are reused verbatim. No new animation code.

**Border sweep** — `@property --sweep-angle` + `@keyframes border-sweep` at [main.css:126-135](../../../frontend/app/assets/css/main.css), applied as at [ComfyNode.vue:1927-1950](../../../frontend/app/components/vue-canvas/ComfyNode.vue): a three-layer mask (conic sweep ∩ border ring) over `linear-gradient(to right, var(--border-left), var(--border-right))`.

**Flowing wire** — [ComfyEdge.vue:60-91](../../../frontend/app/components/vue-canvas/ComfyEdge.vue): five `<stop>`s with animated `offset`, white centre pulse, 1.5s, over an 8px `stroke-opacity="0.3"` glow underlay. Unchanged — wire length didn't change.

Two things must change to port the sweep:

1. **`isolation: isolate` on the capsule.** The sweep's `z-index: -1` pseudo-element only works today because vue-flow's transformed node wrapper creates a stacking context around it. Standing alone, the pseudo paints behind the canvas background and vanishes entirely. Verified in the mockup — a blank border until the isolation was added.
2. **Duration `2s` → `2.4s`.** A capsule's perimeter is roughly a third of a card's, so at 2s the beam laps three times as fast and reads as a strobe.

**Signal count.** With the sweep and wire both running, the capsule must not also pulse the button. Running signals are the sweep and the wire; the button reverts to a plain control. Specifically: no spinner glyph, and no solid blue fill while running.

## The read-out — the substantial piece

Every node type needs an answer to *"what one fact belongs beside my name?"* There is no single existing registry to hang that on. What exists is three disjoint ones:

- `ToolboxItem` — `{ nodeType, label, description, icon }` at [toolbox-items.ts:78-88](../../../frontend/app/data/toolbox-items.ts), covering toolbox nodes but not studios
- `AgentCapability` — `{ nodeType, kind, title, summary, … }` at [capabilities.ts:24-49](../../../frontend/app/lib/agent/capabilities.ts), which has a one-line `summary` but no icon
- `GENERATOR_NODE_ICONS` at [generator-icons.ts](../../../frontend/app/data/generator-icons.ts)

### Two families, two sources — deliberately

The 28 registered node types split cleanly, and forcing them through one mechanism would be worse than acknowledging the split.

**Studio nodes get it free from the control schema.** `ControlMeta` at [effect.ts:14-30](../../../frontend/app/lib/spacetype/effect.ts) already carries exactly this opt-in pattern — `agent?: boolean` withholds a control from the agent vocabulary, `animatable?` from motion tracks. Add one field alongside them:

```ts
/** Rank in the capsule read-out. Lowest two ranks render. Absent = never shown. */
summary?: number
```

That is **one declaration per surface**, consistent with the Act 1 factory bet in [ROADMAP.md](../../ROADMAP.md), and it composes with the existing per-consumer opt-in so declaring it can never silently widen another capability.

The read seam already exists: `STUDIO_TUNERS` at [studioTune.ts:267,444-452](../../../frontend/app/lib/agent/studioTune.ts) exposes `read(node) → { config, controls: ControlSpec[] }` for Compositor, Texture, SmartLayout, Gradient, Shader, Shape and VectorType. Given config + controls, the read-out is a filter and a join.

**Comfy nodes have no schema, so they get a data table.** Their values live as a **positional array** — `node.data.widgetsValues[]` index-aligned with `node.data.widgetDefs[]` ([useVueNodes.ts:441-443](../../../frontend/app/composables/useVueNodes.ts)), with a hidden `<name>_control` placeholder injected at `:139-141` specifically to keep the two aligned. Resolution is by widget *name* → index; the precedent for zipping them is [WorkflowOverview.vue:117-130](../../../frontend/app/components/vue-canvas/WorkflowOverview.vue).

So Comfy types declare widget names, in one table in one file:

```ts
type ReadoutRule =
  | { from: 'widgets'; names: string[] }              // comfy, resolved by name → index
  | { from: 'controls' }                              // studio, uses ControlSpec.summary
  | { from: 'text'; property: string; max: number }   // prompts, truncated
  | { from: 'none' }
```

This is the honest middle. It is *not* 27 strings scattered across 27 components — it is one table plus one schema field.

### Resolution order

```
1. data.errorMessage        → failed
2. data.running             → "rendering · <elapsed>"
3. declared ReadoutRule     → the summary
4. nothing                  → name only
```

**Degrade to silence.** A node with no declared rule shows its name and nothing else. Never guess, never render a raw widget dump. This means coverage can land incrementally without ever shipping a wrong-looking capsule.

### What has to be built that doesn't exist

**Per-node elapsed time.** There is none. Timing is per-*run* only: `RunEntry.startedAt` at [runRegistry.ts:17](../../../frontend/app/lib/graph/runRegistry.ts), and the only elapsed clock is `elapsedSec` + `fmtSec` in [CanvasStatusBar.vue:59-69](../../../frontend/app/components/CanvasStatusBar.vue) (1s interval, formats `8.4s` / `42s` / `1m 12s`).

The hook is the `executing` branch at [VueNodeCanvas.vue:2683-2687](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue) — stamp `runningSince: Date.now()` beside the existing `running: true`, and clear it wherever `running: false` is set (`:2831`, `:2786`). Reuse `fmtSec` rather than writing a second formatter.

Everything else already exists on `node.data`: `running`, `error`, `progress`, `errorMessage` ([ComfyNode.vue:38-43](../../../frontend/app/components/vue-canvas/ComfyNode.vue)), with per-node error text already surfaced at `:1386-1392` and populated from `summarizeNodeErrors(...).perNode` at `VueNodeCanvas.vue:2565-2573`.

## Interaction model

**Hover reveals. Click expands.** Not hover-expands.

The action button forces this: if hover expands the card, you have to chase the play button across an animation to click the thing that caused the expansion. So hover brings up the action button and the ports; a click on the capsule *body* (not the button) opens the full card, pinned until you click away.

This also disposes of the "chips pop open every time you cross the canvas" problem without needing a hover delay.

**Hover state does not exist today.** There is no `@node-mouse-enter` on the canvas — `hoverNodeIds` at `VueNodeCanvas.vue:651` is the agent proposal highlight, not user hover, and all node hover is currently pure CSS inside components. Two options, to settle in planning:

- Pure CSS `:hover` inside the capsule component — simplest, but cannot raise the vue-flow wrapper's `z-index`, so an expanded card would be overlapped by neighbours. Workaround: `.vue-flow__node:has(.capsule:hover) { z-index: … }`.
- A real `@node-mouse-enter` / `@node-mouse-leave` handler feeding node state.

**Selection comes free** if the capsule root keeps the `.comfy-node` or `.studio-node` class — selection is styled purely in CSS against vue-flow's `.selected` wrapper at [VueNodeCanvas.vue:7706-7732](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue). `ComfyNode` never receives a `selected` prop.

## Which nodes collapse

Collapse is a **per-node state**, not a per-type rule — but the default is set per type. Three tiers:

**Always a capsule** — no visual output of their own: `comfy` (non-generator), `gate`, `subgraph-io`.

**Capsule once it has run** — produces something visible downstream, so the capsule is the record of how it got there: `comfy` generators, `pose-mannequin`, `lip-sync`, `shot-director`. The last two are summary cards with an open-editor button; they render nothing live themselves. Freshly added, they open; after a successful run and no further edits, they settle.

**Never a capsule** — `artifact-image`, `artifact-text`, `artifact-audio`, `artifact-video`, `artifact-frame`, `artifact-timeline`, `artifact-3d`, `character-sheet`, `collection`, `batch-grid`, `sketch-pile`, `note`. These *are* the content.

That accounts for all 28 registered types.

**Anything with a live preview is the judgement call.** `gradient-studio`, `shader-studio`, `texture-studio`, `shape-studio`, `space-type`, `vector-type`, `scene3d-studio` and `shader-effect` render a live canvas preview, which is most of their value. `reference` and `character` join them: both show the picked asset's thumbnail, and collapsing them unconditionally would start a freshly added node closed with its picker behind an extra click. They **do not** collapse by default, but get a manual collapse toggle — a busy canvas with six studios is exactly when you'd want them small.

*Corrected during implementation (2026-07-27): `shader-effect`, `reference` and `character` were originally assigned by type name and moved here after reading the components; `shot-director` moved the other way.*

The collapsed/expanded flag persists with the project.

*Scope note added during implementation (2026-07-27): in v1 only `comfy` nodes render a capsule — `ComfyNode.vue` is the sole component wired to `NodeCapsule`. The tier table classifies all 28 node types and the `{from:'controls'}` read-out path is implemented and tested, but both are groundwork: no studio or artifact component consumes them yet, and the `manual`-tier collapse toggle does not exist. Persistence stores `collapsed` and `hasRun` and deliberately excludes `runningSince` — a saved wall clock would reload as a forever-ticking counter.*

## Plumbing summary

| Need | Seam |
|---|---|
| Register the component | `nodeTypes` at `VueNodeCanvas.vue:244-263` — **must stay `markRaw`'d and hoisted**; a new object reference remounts every node (`:239-243`) |
| Route type → component | `getVueFlowType()` at `useVueNodes.ts:238-241` |
| Icon | Extract the three computeds at `ComfyNode.vue:85,91,96`. Note `getPartnerIcon` ([partnerIcons.ts:36](../../../frontend/app/lib/partnerIcons.ts)) returns a **URL string** while the other two return Components — the capsule needs both an `<img>` and a `<component :is>` branch. Studio nodes bypass this entirely today (`GradientStudioNode.vue:139` hardcodes `<Sparkles>`). |
| Studio controls + values | `STUDIO_TUNERS.read(node)` at `studioTune.ts:267`; live per-type lists via [collection/studioControls.ts](../../../frontend/app/lib/collection/studioControls.ts) |
| Comfy values | `node.data.widgetsValues` ↔ `node.data.widgetDefs`, by name → index |
| Run state | `node.data.{running,error,errorMessage,progress}` |

**Do not touch** the `GRADIENT_CONTROLS` keys — [controls.ts:5-24](../../../frontend/app/lib/gradientfx/controls.ts) states they are frozen because persisted Collection bindings are `params.<key>`.

## Risks

- **The capsule becomes a small card.** Every future request will be to put one more thing on it. The read-out-is-never-a-control rule is the only defence, and it has to be held.
- **Studios collapsing badly.** A gradient with no preview is just the word "Gradient". Hence default-expanded with a manual toggle, not the reverse.
- **Read-out coverage stalls at the interesting nodes.** Mitigated by degrade-to-silence: partial coverage looks intentional rather than broken.
- **`isolation: isolate` interacting with the expanded card's z-index.** Both touch stacking; they need testing together, not separately.
- **Purple returns mid-run.** Accepted, bounded to the run. If it reads as noise in practice, the fallback is the action-blue directional sweep (variant C in the mockup) — a one-line change to `--border-left` / `--border-right`.

## Testing

**Unit** — read-out resolution: precedence order (error > running > rule > silence); `{from:'widgets'}` name→index against a `widgetDefs` array containing the hidden `_control` placeholder; `{from:'controls'}` ranking and the two-item cap; `{from:'text'}` truncation; unknown node type → name only, no throw.

**Unit** — elapsed formatting reuses `fmtSec` and clears on `running: false`.

**E2E** — add a node, confirm it opens; run it, confirm it settles to a capsule; hover, confirm ports and action button appear and the card does *not*; click the body, confirm it expands in place with no reflow of neighbours; click the action button while running, confirm it stops; force a failure, confirm the message reaches the read-out.

**Visual** — the sweep is actually visible on a capsule (this is the `isolation` regression, and it fails silently — a blank border, not an error). Assert a non-background pixel on the capsule's border box mid-animation rather than asserting the class is present.

## Open questions for review

1. Hover via CSS `:has()` or a real `@node-mouse-enter` handler?
2. Does the capsule ever show cost? The card carries `$0.03`; on the capsule it would compete with the read-out. Likeliest answer is on the action button's own hover, where the money gets spent.
3. Do studio capsules keep a thumbnail of their last render in the icon tile, instead of a glyph? Rejected for v1 as it reintroduces per-type variance, but it is the strongest argument against the neutral tile.
