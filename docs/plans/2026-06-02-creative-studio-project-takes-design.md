# Creative production studio — projects, versions & takes — design

The strategic goal: make ComfyNext feel like a creative *production studio* that
happens to run on ComfyUI, not a node tool with a nicer skin. The single
principle behind everything here: **the more a user thinks in projects, takes
and scenes — and the less in nodes, wires and samplers — the stronger that
claim.** Make the creative artifact the noun and the graph an implementation
detail.

This doc specifies the keystone of that shift — a durable **Project** model,
named **Versions** (whole-project snapshots) and per-node **Takes** (the
non-destructive variation loop) — and sequences the rest of the studio roadmap
behind it.

## Where we are today (foundation)

The plumbing is closer than it looks. What exists:

- **Project grouping (partial):** every run stamps `workflow.extra.projectUuid`
  ([default.vue](../../frontend/app/layouts/default.vue) ~line 379); the home
  page groups ComfyUI `/history` by that UUID
  ([useRecentProjects.ts](../../frontend/app/composables/useRecentProjects.ts:58)).
- **Workflow persistence (session-only):** active graphs live in `sessionStorage`
  under `comfynext:workflows`; tab metadata in `comfynext:tabs`
  ([useTabs.ts](../../frontend/app/composables/useTabs.ts:25)); project names
  in `localStorage` `comfynext:project-names`.
- **Extension namespace:** `workflow.extra.comfynext` round-trips groups +
  annotations ([useVueNodes.ts](../../frontend/app/composables/useVueNodes.ts:248)).
- **Artifact state persists in node props:** Frame layers in
  `properties.comfynext_localLayers`
  ([useCompositorLayers.ts](../../frontend/app/composables/useCompositorLayers.ts)),
  Timeline in the `edit_state` widget
  ([shared/timeline/types.ts](../../frontend/shared/timeline/types.ts:6)).
- **Server-side `/comfynext/*` endpoints already exist** (assets), so we have a
  precedent for persisting our own data to the ComfyUI user dir.

What's **missing** for a studio:

- No durable Project entity — close the tab, lose the working state (only
  `/history` survives, keyed by promptId).
- **Node outputs are latest-only.** On `executed`, `node.data.images` is
  *overwritten* ([VueNodeCanvas.vue](../../frontend/app/components/vue-canvas/VueNodeCanvas.vue:984)).
  There is no history, no variations, no "compare two results."
- No whole-project snapshots / restore / branch.
- Assets are a flat global list with no provenance (no "this asset came from
  this run") and no per-project scoping
  ([useAssetLibrary.ts](../../frontend/app/composables/useAssetLibrary.ts)).

## Data model

Three nouns, three granularities. **Take** ⊂ node, **Version** ⊂ project,
**Project** is the durable root.

```typescript
// A single result of a single node run — the unit of iteration.
interface Take {
  id: string                 // stable, client-generated
  createdAt: number
  promptId: string           // ComfyUI execution this came from
  label?: string             // optional user name ("the warm one")
  pinned?: boolean           // promoted to the asset library
  // outputs (URLs into ComfyUI /view, same shape node.data uses today)
  images?: string[]
  audios?: string[]
  text?: string
  animated?: boolean
  // provenance — what produced it, so a take is reproducible/explainable
  params?: { seed?: number; prompt?: string; model?: string; [k: string]: any }
}

// Per-node take history. Replaces today's latest-only node.data.images/etc.
interface NodeTakes {
  takes: Take[]
  activeTakeId: string | null   // which take the node body / downstream use
}

// A named snapshot of the WHOLE project: the graph + the chosen take per node
// + canvas extras. This is what makes iteration non-destructive at the project
// level — branch from any version without fear.
interface ProjectVersion {
  id: string
  name: string                  // "v3 — tighter crop", auto-named if blank
  createdAt: number
  parentId: string | null       // branch lineage (linear list renders first)
  workflow: LiteGraphWorkflow   // full serialized graph (existing format)
  activeTakes: Record<string, string>  // nodeId -> takeId chosen in this version
  cover?: string                // thumbnail URL
}

// The durable root. Persisted server-side (see below).
interface Project {
  uuid: string                  // reuse the existing workflow.extra.projectUuid
  name: string
  cover?: string
  createdAt: number
  updatedAt: number
  currentVersionId: string
  versions: ProjectVersion[]    // newest last; tree via parentId
}
```

Takes live on the node so the canvas can render them with zero extra fetches;
the active take per version is captured at snapshot time. `Project` /
`ProjectVersion` are the only things that need durable storage — takes ride
inside the version's `activeTakes` + the node data embedded in `workflow`.

## Persistence — promote Project to a server entity

Follow the existing `/comfynext/*` precedent rather than inventing a new
transport. New ComfyUI endpoints, writing JSON under the user dir
(`user/comfynext/projects/<uuid>/project.json`):

| Endpoint | Verb | Purpose |
|---|---|---|
| `/comfynext/projects` | GET | list projects (id, name, cover, updatedAt) for Home |
| `/comfynext/projects/{uuid}` | GET / PUT | load / save a full Project |
| `/comfynext/projects/{uuid}` | DELETE | remove |
| `/comfynext/projects/{uuid}/version` | POST | append a ProjectVersion (snapshot) |

Migration is gentle because the UUID already exists: the first time a tab with a
`projectUuid` is saved, we write a `Project` seeded from the current graph and
the existing `/history` runs (back-fill versions from past promptIds). Home's
`useRecentProjects` switches its source from "`/history` grouped by UUID" to
"`/comfynext/projects`", falling back to history for un-migrated work.

Output *files* still live in ComfyUI's `output/` and are addressable via
`/view`; we persist their URLs + params in the take, not the bytes.

## Takes — the non-destructive iteration loop

This is the highest-impact change and the one that most makes it feel like a
studio. Today's overwrite becomes an append.

**The one behavioral change at the core** — in the `executed` handler
([VueNodeCanvas.vue:984](../../frontend/app/components/vue-canvas/VueNodeCanvas.vue:984)):

```typescript
// BEFORE: latest-only, destroys prior result
next.images = output.images.map(toUrl)

// AFTER: append a take, keep history, make it active
const take = buildTake(promptId, output)      // {id, images, audios, params...}
next.takes = [...(target.data.takes ?? []), take]
next.activeTakeId = take.id
// node body / downstream resolve outputs from the ACTIVE take
```

UI on the node body ([ComfyNode.vue](../../frontend/app/components/vue-canvas/ComfyNode.vue)):

- Active take rendered as today (no visual regression for single-run users).
- A **takes strip** (thumbnail row) appears once `takes.length > 1` — click to
  switch active, ⌫ to discard, ☆ to pin.
- A **"Generate variations"** action (×N with seed deltas) that re-queues the
  node and appends takes as they finish — the try→compare→pick loop, native.
- A lightweight **A/B compare** for two selected takes (esp. for edits like
  Kontext restyle: before/after).

## Render sites — the architecture point

"Active take" must be the single source of truth everywhere a node's output is
consumed. These are the sites that read outputs today and must switch from
`data.images` to `resolveActiveTake(data)`:

| Site | File | Reads output for |
|---|---|---|
| Node body preview | `ComfyNode.vue` | the card image/video/audio |
| Downstream resolution | `VueNodeCanvas.vue` (edge/output resolve) | feeding the next node |
| Frame (Compositor) wired layer | `useCompositorLayers.ts` | the layer's source pixels |
| Timeline clip source | `usePlaybackEngine.ts` / `nodes_timeline.py` | clip frames |
| Version snapshot | new `useProjects` | `activeTakes[nodeId]` |
| Delivery / export | export path | the rendered deliverable |

A single `resolveActiveTake(nodeData): { images?, audios?, ... }` helper keeps
this honest — one function, six callers, no drift (the same discipline the
Timeline doc applied to `interpolateClipAt`).

## Versions — whole-project snapshots

A **Version** = the graph + `activeTakes` per node + `workflow.extra.comfynext`
(groups/annotations) + Frame/Timeline state (already in node props). Snapshot on
demand ("Save version") and auto on meaningful checkpoints (first run of a
session, before a destructive graph edit). Restore loads the workflow and
re-points each node's `activeTakeId`. Branching is just a new version with
`parentId` set — render a **linear list v1**, a tree later.

## Asset library — provenance + pinning

Close the "where did this come from" gap and make the library a real media bin.
Pinning a take writes it to the asset library with provenance, and the library
gains light scoping/search.

```typescript
interface Asset {            // extends today's interface
  // ...existing fields...
  tags?: string[]
  projectUuid?: string       // per-project scoping (still browsable globally)
  source?: { nodeId: string; promptId: string; takeId: string; params?: any }
}
```

Drag-from-library-onto-Frame/Timeline already works for the Timeline's asset
pool; extend it to the Frame and make pinned takes first-class library items.

## Delivery — ship deliverables

Studios don't stop at "preview." Add an **export surface** with presets (social
aspect ratios, video formats/resolutions), batch export of selected takes, and a
**render queue** (the natural home for "generate 8 variations"). The Timeline
already exports video via FFmpeg ([nodes_timeline.py](../../comfy_api_nodes));
generalize that into a delivery panel rather than a per-node afterthought.

## Scope cuts (v1)

**In:**
- Durable server-side Projects + back-fill migration from `projectUuid`/history.
- Per-node Takes (auto-append on run) + takes strip + Generate Variations + A/B.
- Manual "Save version" + restore; linear version list.
- Pin-take-to-asset with provenance.

**Deferred:**
- Branch *tree* visualization (linear list first).
- Collaboration / share / review links (annotations already seed this).
- Rich asset tagging UI (store provenance + tags first, UI later).
- Cross-device sync (server JSON makes it possible; not a v1 promise).
- Auto-variation strategies beyond seed delta (prompt-wiggle, model-swap).

## Roadmap (sequenced, effort × impact)

Effort: **S** ≈ days, **M** ≈ 1–2 wks, **L** ≈ 3+ wks. Impact is on the
"production studio" claim.

| # | Phase | Effort | Impact | Depends on |
|---|---|---|---|---|
| 0 | Durable Projects (server endpoints + migrate `projectUuid`) | M | High (foundation) | — |
| 1 | **Takes model + variations loop** (append, strip, Generate Variations, A/B) | M–L | **Very high** (the identity feature) | 0 (persist takes) |
| 2 | Versions: save / restore / linear list | M | High | 0, 1 |
| 3 | Asset library: provenance + pin-take + per-project scope | M | Med–High | 1 |
| 4 | Delivery: export presets + render queue | S–M | Med–High | 1 |
| 5 | Inline manipulation + unified artifact polish + lead-with-creative-vocab | L | Med (ongoing) | — |
| 6 | Collaboration / share / review | L | Med (later-stage signal) | 0, 2 |

**If only one thing:** do **0 + 1 together**. They convert the mental model from
"build a graph and run it" to "work on a project and iterate toward a result" —
that's the identity shift; 2–6 are high-value features on top of it.

## Known limitations of the Phase 1 prototype (from stress-test)

The flag-gated prototype stores takes on the deep-watched, serialized
`node.data`. That keeps it tiny and additive, but two consequences surfaced in
review and are accepted for the prototype:

1. **Takes are session-only.** `convertToLiteGraph` stashes only the *active*
   take's image into `comfynext_preview`, not the `takes` array — so a tab
   switch or reload keeps the last image but drops the take history. The
   settings copy says so. Real persistence arrives with Phase 0/2 (takes ride
   inside a `ProjectVersion.activeTakes`).
2. **Undo/redo is entangled with takes.** The canvas history deep-watches
   `node.data`, so select/pin/discard can create undo steps and an undo can
   resurrect a discarded take. Bounded (no crash/corruption; off by default),
   but real.

**The clean graduation fix for both:** move takes off `node.data` into a
separate reactive store keyed by `nodeId` (in `useTakes`), projecting only the
active take's `images/audios/text` back onto `node.data` for display. That takes
the array out of both history snapshots and graph serialization in one move —
then persistence is handled deliberately via project versions, not as a
serialization side effect. Do this when takes graduate from the flag.

## Why this is the right direction (moat)

Every step widens the gap only ComfyNext occupies. ComfyUI **won't** build a
project/takes/delivery studio — it's an engine and a community, not a creative
app. The AI-canvas startups **can't** match the depth — they have no engine and
lag the model frontier. Projects, takes and delivery are exactly the ground
where "a creative production studio that happens to run on ComfyUI" stops being
a tagline and becomes the product.

## Files

**New**
- `frontend/app/composables/useProjects.ts` — Project/Version CRUD, snapshot, restore, migration.
- `frontend/app/composables/useTakes.ts` — `buildTake`, `resolveActiveTake`, append/switch/pin/discard, variation queueing.
- `frontend/app/components/vue-canvas/TakesStrip.vue` — node-body thumbnail strip + A/B compare.
- `frontend/app/components/DeliveryPanel.vue` — export presets + render queue (Phase 4).
- `custom_nodes/comfynext_bridge/.../projects endpoints` (or a Nitro `server/api/projects/*`) — `/comfynext/projects` persistence.

**Modified**
- `VueNodeCanvas.vue` — `executed` handler appends takes; output/edge resolution via `resolveActiveTake`.
- `ComfyNode.vue` — render active take + mount `TakesStrip`.
- `useRecentProjects.ts` — source from `/comfynext/projects`, fall back to history.
- `useTabs.ts` / `default.vue` — bind tabs to durable Projects; snapshot hooks.
- `useAssetLibrary.ts` + asset endpoints — provenance + tags + project scope.
- `useCompositorLayers.ts`, `usePlaybackEngine.ts`, `nodes_timeline.py` — resolve wired sources via active take.

## Open decision

**Where do project endpoints live** — a ComfyUI custom-node route under
`/comfynext/*` (consistent with assets, shared by any frontend, survives a
frontend-only reload) vs a Nuxt Nitro `server/api/projects/*` (closer to the
frontend, but split-brain from the assets endpoints). Leaning ComfyUI-side for
consistency and durability, but Nitro is faster to prototype.
