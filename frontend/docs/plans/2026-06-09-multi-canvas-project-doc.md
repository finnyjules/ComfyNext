# Multi-canvas projects + whole-project versions (ProjectDoc)

**Status: shipped** (2026-06-09)

## What

A project tab no longer holds a single workflow but a **ProjectDoc**: an
ordered list of named canvases, each with its own workflow, plus which one is
on screen. A floating chip at the top-left of the canvas ("Project / Canvas ▾",
`components/vue-canvas/ProjectMenu.vue`) opens a dropdown with the project
name (rename), the canvas list (switch / double-click rename / two-step delete
/ add), and the named-version snapshots that used to live in the left-side
VersionsPanel (now deleted, along with its toolbar icon).

```ts
// lib/projectDoc.ts
interface ProjectCanvas { id: string; name: string; workflow: any }
interface ProjectDoc { canvases: ProjectCanvas[]; activeCanvasId: string }
```

## Why frontend-only

The projects backend (`comfy_extras/nodes_sailor_projects.py`) stores
version bodies as opaque JSON — it never inspects the `workflow` field. So the
doc is simply what we now put in that field: the rolling `current` autosave,
named versions, and sessionStorage all persist the **whole doc**, which is
what makes "restore a version = restore every canvas" free. Zero backend
changes.

## Migration

Everything that can hand us a bare workflow (old sessionStorage, old durable
versions, `/history`, community templates, `/api/workflows`) is wrapped at the
entry point via `toProjectDoc()` — a one-canvas doc named "Canvas 1". The rest
of the code only ever sees docs. Old named versions restore fine for the same
reason.

## The switch guard (the part that must not break)

Canvas switching = serialize the outgoing canvas into its doc slot, then swap
`activeCanvasId` (the `activeTabWorkflow` computed changes reference → the
canvas's `:workflow` prop watch rebuilds the graph). All serialization funnels
through `snapshotActiveCanvasIntoDoc()` in `layouts/default.vue`, which:

- passes `reroll: false` so serializing never mutates live seed widgets
  (a re-roll would re-trip live-run watchers);
- refuses to write while `VueNodeCanvas.isApplyingWorkflow()` is true — during
  a prop-watch rebuild, `getWorkflow()` still returns the *previous* graph and
  would clobber the wrong slot (this also hardens plain tab switching);
- refuses empty snapshots (canvas mid-unmount), same trade-off as tabs: an
  intentionally-emptied canvas reverts on switch-back;
- writes via `toRaw` so saving the *active* canvas doesn't swap the prop
  reference and trigger a pointless rebuild.

A `canvasSwitching` flag blocks re-entrant switches; runs in progress behave
exactly like tab switches today (queued server-side, results land when you
return).

## Run scoping (animations + results across canvas switches)

Bridge events locate nodes **by id in whatever graph is displayed**, and node
ids collide across a project's canvases (template workflows use small
sequential ints). So a run is scoped to the canvas it was queued from:
`default.vue` records `runningCanvasByWorker[workerIdx]` at queue time and
passes `displayed-canvas-id` / `running-canvas-id` props to `VueNodeCanvas`.
When they mismatch, run events are kept off the displayed graph — no false
glow on a same-id node, and (crucially) no `executed` result delivered to the
wrong canvas. Off-screen results are buffered in `pendingTakesByCanvas` and
applied when the run's canvas is shown again; the running glow is re-applied
after every workflow prop rebuild via `applyRunningForActiveWorker`, so
switching away and back mid-run keeps the animation. Null scope on either
side (legacy paths) degrades to the old behavior.

## Deliberately out of scope (v1)

Canvas reorder/drag, duplicate canvas, per-canvas thumbnails in the menu.
All additive.
